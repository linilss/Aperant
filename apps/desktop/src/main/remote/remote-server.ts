/**
 * Remote access server: serves the web build of the renderer over HTTP and
 * bridges IPC over a WebSocket on the same port.
 *
 * This module is intentionally free of Electron imports so it can be unit
 * tested; Electron wiring lives in remote-access.ts.
 *
 * Protocol (JSON, see shared/remote/protocol.ts):
 *   client → { kind:'auth', token }                     (first message, required)
 *   server → { kind:'hello', platform }                 (auth accepted)
 *   client → { kind:'invoke', id, channel, args }       → registered ipcMain.handle handler
 *   server → { kind:'result', id, ok, value | error }
 *   client → { kind:'send', channel, args }             → registered ipcMain.on listeners
 *   server → { kind:'event', channel, args }            (mirrors webContents.send)
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream, promises as fsp } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { type RawData, WebSocket, WebSocketServer } from 'ws';
import { decodeRemoteMessage, encodeRemoteMessage } from '../../shared/remote/codec';
import {
  REMOTE_CLOSE_CODES,
  REMOTE_NOT_AVAILABLE_ERROR,
  REMOTE_WS_PATH,
  type RemoteClientMessage,
  type RemoteServerMessage,
} from '../../shared/remote/protocol';
import type { RemotePlatformInfo } from '../../shared/types/remote-access';
import type { IpcRegistry } from './ipc-registry';

/** Minimal shape of webContents that handlers use via `event.sender`. */
export interface RemoteSender {
  send(channel: string, ...args: unknown[]): void;
  isDestroyed?(): boolean;
}

export interface RemoteServerLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface RemoteServerOptions {
  registry: Pick<IpcRegistry, 'getHandler' | 'getListeners'>;
  /** Returns the current pairing token (read on every auth attempt). */
  getToken: () => string;
  /** Directory containing the web build (index.html + assets). */
  staticDir: string;
  /** Used as `event.sender` for handlers; null when the desktop window is closed. */
  getSender: () => RemoteSender | null;
  platform: RemotePlatformInfo;
  isChannelDenied: (channel: string) => boolean;
  logger: RemoteServerLogger;
  /** Called when the number of authenticated clients changes. */
  onClientCountChange?: (count: number) => void;
  /** Time a client has to authenticate after connecting (ms). */
  authTimeoutMs?: number;
  /** Failed auth attempts per address before it is blocked. */
  maxAuthFailures?: number;
  /** How long an address stays blocked after too many failures (ms). */
  authBlockMs?: number;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

/** Max size of a single client message (attachments/images can be large). */
const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;
/** Drop a client whose unsent buffer grows beyond this (it will reconnect). */
const MAX_BUFFERED_BYTES = 64 * 1024 * 1024;

interface ClientState {
  authed: boolean;
  address: string;
}

function hashToken(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Constant-time token comparison (hashing equalizes lengths). */
export function tokensMatch(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string' || provided.length === 0 || expected.length === 0) {
    return false;
  }
  return timingSafeEqual(hashToken(provided), hashToken(expected));
}

/**
 * Resolve a request path inside `root`. Returns null for anything that would
 * escape the root (traversal, NUL bytes, malformed encoding).
 */
export function resolveStaticPath(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const normalizedRoot = path.resolve(root);
  const resolved = path.resolve(normalizedRoot, `.${path.posix.normalize(`/${decoded}`)}`);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    return null;
  }
  return resolved;
}

export class RemoteServer {
  private readonly opts: Required<
    Pick<RemoteServerOptions, 'authTimeoutMs' | 'maxAuthFailures' | 'authBlockMs'>
  > &
    RemoteServerOptions;
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly clients = new Map<WebSocket, ClientState>();
  private readonly authFailures = new Map<string, { count: number; blockedUntil: number }>();
  private authedCount = 0;
  private boundPort: number | null = null;

  constructor(options: RemoteServerOptions) {
    this.opts = {
      authTimeoutMs: 10_000,
      maxAuthFailures: 5,
      authBlockMs: 5 * 60_000,
      ...options,
    };
  }

  get isRunning(): boolean {
    return this.httpServer?.listening ?? false;
  }

  get clientCount(): number {
    return this.authedCount;
  }

  /** Port the server is listening on, or null when stopped. */
  get port(): number | null {
    return this.boundPort;
  }

  /** Start listening. Resolves with the bound port (useful with port 0). */
  async start(port: number, host = '0.0.0.0'): Promise<number> {
    if (this.httpServer) {
      throw new Error('Remote server already running');
    }

    const httpServer = http.createServer((req, res) => {
      this.handleHttp(req, res).catch((error: unknown) => {
        this.opts.logger.error('[RemoteServer] HTTP handler failed:', error);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

    httpServer.on('upgrade', (req, socket, head) => {
      const pathname = (req.url ?? '').split('?')[0];
      if (pathname !== REMOTE_WS_PATH) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => this.handleConnection(ws, req));
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        httpServer.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        httpServer.off('error', onError);
        resolve();
      };
      httpServer.once('error', onError);
      httpServer.once('listening', onListening);
      httpServer.listen(port, host);
    });

    httpServer.on('error', (error) => {
      this.opts.logger.error('[RemoteServer] Server error:', error);
    });

    this.httpServer = httpServer;
    this.wss = wss;
    this.boundPort = (httpServer.address() as AddressInfo).port;
    this.opts.logger.info(`[RemoteServer] Listening on ${host}:${this.boundPort}`);
    return this.boundPort;
  }

  async stop(): Promise<void> {
    const httpServer = this.httpServer;
    const wss = this.wss;
    this.httpServer = null;
    this.wss = null;
    this.boundPort = null;
    if (!httpServer) return;

    this.disconnectAll(REMOTE_CLOSE_CODES.SERVER_STOPPING, 'Server stopping');
    wss?.close();
    await new Promise<void>((resolve) => {
      // Give clients a moment to receive the close frame, then force-close.
      const forceTimer = setTimeout(() => {
        for (const ws of this.clients.keys()) ws.terminate();
        httpServer.closeAllConnections?.();
      }, 1000);
      httpServer.close(() => {
        clearTimeout(forceTimer);
        resolve();
      });
      httpServer.closeIdleConnections?.();
    });
    this.opts.logger.info('[RemoteServer] Stopped');
  }

  /** Close every client (used when the token is rotated). */
  disconnectAll(code: number = REMOTE_CLOSE_CODES.UNAUTHORIZED, reason = 'Token revoked'): void {
    for (const ws of this.clients.keys()) {
      ws.close(code, reason);
    }
  }

  /** Forward a renderer event to every authenticated client. */
  broadcast(channel: string, args: unknown[]): void {
    if (this.authedCount === 0) return;
    let payload: string;
    try {
      payload = encodeRemoteMessage({ kind: 'event', channel, args } satisfies RemoteServerMessage);
    } catch (error) {
      // Non-serializable args (circular, etc.) — skip rather than break the desktop send.
      this.opts.logger.warn(`[RemoteServer] Skipping non-serializable event on ${channel}:`, error);
      return;
    }
    for (const [ws, state] of this.clients) {
      if (!state.authed || ws.readyState !== WebSocket.OPEN) continue;
      if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
        ws.close(REMOTE_CLOSE_CODES.BACKPRESSURE, 'Client too slow');
        continue;
      }
      ws.send(payload);
    }
  }

  // ---------------------------------------------------------------------------
  // WebSocket
  // ---------------------------------------------------------------------------

  private isBlocked(address: string): boolean {
    const entry = this.authFailures.get(address);
    if (!entry) return false;
    if (entry.blockedUntil > Date.now()) return true;
    if (entry.blockedUntil !== 0) this.authFailures.delete(address);
    return false;
  }

  private recordAuthFailure(address: string): void {
    const entry = this.authFailures.get(address) ?? { count: 0, blockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= this.opts.maxAuthFailures) {
      entry.blockedUntil = Date.now() + this.opts.authBlockMs;
      this.opts.logger.warn(`[RemoteServer] Blocking ${address} after ${entry.count} failed auth attempts`);
    }
    this.authFailures.set(address, entry);
  }

  private handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const address = req.socket.remoteAddress ?? 'unknown';
    if (this.isBlocked(address)) {
      ws.close(REMOTE_CLOSE_CODES.RATE_LIMITED, 'Too many failed attempts');
      return;
    }

    const state: ClientState = { authed: false, address };
    this.clients.set(ws, state);

    const authTimer = setTimeout(() => {
      if (!state.authed) ws.close(REMOTE_CLOSE_CODES.UNAUTHORIZED, 'Authentication timeout');
    }, this.opts.authTimeoutMs);

    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) return;
      let message: RemoteClientMessage;
      try {
        message = decodeRemoteMessage<RemoteClientMessage>(data.toString());
      } catch {
        if (!state.authed) ws.close(REMOTE_CLOSE_CODES.UNAUTHORIZED, 'Invalid message');
        return;
      }
      if (!message || typeof message !== 'object') return;

      if (!state.authed) {
        clearTimeout(authTimer);
        if (message.kind === 'auth' && tokensMatch(message.token, this.opts.getToken())) {
          state.authed = true;
          this.authFailures.delete(address);
          this.setAuthedCount(this.authedCount + 1);
          this.sendTo(ws, { kind: 'hello', platform: this.opts.platform });
        } else {
          this.recordAuthFailure(address);
          ws.close(REMOTE_CLOSE_CODES.UNAUTHORIZED, 'Unauthorized');
        }
        return;
      }

      if (message.kind === 'invoke') {
        void this.handleInvoke(ws, message);
      } else if (message.kind === 'send') {
        this.handleSend(message);
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      this.clients.delete(ws);
      if (state.authed) this.setAuthedCount(this.authedCount - 1);
    });

    ws.on('error', (error) => {
      this.opts.logger.warn('[RemoteServer] Client socket error:', error);
    });
  }

  private setAuthedCount(count: number): void {
    this.authedCount = Math.max(0, count);
    this.opts.onClientCountChange?.(this.authedCount);
  }

  private sendTo(ws: WebSocket, message: RemoteServerMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    let payload: string;
    try {
      payload = encodeRemoteMessage(message);
    } catch (error) {
      if (message.kind !== 'result') return;
      payload = encodeRemoteMessage({
        kind: 'result',
        id: message.id,
        ok: false,
        error: `Result could not be serialized: ${error instanceof Error ? error.message : String(error)}`,
      } satisfies RemoteServerMessage);
    }
    ws.send(payload);
  }

  /** Synthetic IpcMainInvokeEvent / IpcMainEvent for remote calls. */
  private createEvent(): Record<string, unknown> {
    const sender: RemoteSender = this.opts.getSender() ?? {
      // Desktop window closed: deliver handler-initiated sends to remote clients only.
      send: (channel: string, ...args: unknown[]) => this.broadcast(channel, args),
      isDestroyed: () => false,
    };
    return {
      sender,
      senderFrame: null,
      frameId: -1,
      processId: -1,
      ports: [],
      returnValue: undefined,
      reply: (channel: string, ...args: unknown[]) => sender.send(channel, ...args),
      remote: true,
    };
  }

  private async handleInvoke(
    ws: WebSocket,
    message: Extract<RemoteClientMessage, { kind: 'invoke' }>
  ): Promise<void> {
    const { id, channel } = message;
    if (typeof id !== 'number' || typeof channel !== 'string') return;
    const args = Array.isArray(message.args) ? message.args : [];

    if (this.opts.isChannelDenied(channel)) {
      this.sendTo(ws, { kind: 'result', id, ok: false, error: REMOTE_NOT_AVAILABLE_ERROR });
      return;
    }
    const handler = this.opts.registry.getHandler(channel);
    if (!handler) {
      this.sendTo(ws, { kind: 'result', id, ok: false, error: `No handler registered for '${channel}'` });
      return;
    }
    try {
      const value = await handler(this.createEvent(), ...args);
      this.sendTo(ws, { kind: 'result', id, ok: true, value });
    } catch (error) {
      this.sendTo(ws, {
        kind: 'result',
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private handleSend(message: Extract<RemoteClientMessage, { kind: 'send' }>): void {
    const { channel } = message;
    if (typeof channel !== 'string' || this.opts.isChannelDenied(channel)) return;
    const args = Array.isArray(message.args) ? message.args : [];
    for (const listener of this.opts.registry.getListeners(channel)) {
      try {
        listener(this.createEvent(), ...args);
      } catch (error) {
        this.opts.logger.error(`[RemoteServer] Listener for ${channel} threw:`, error);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // HTTP (static web build)
  // ---------------------------------------------------------------------------

  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const baseHeaders = {
      'X-Content-Type-Options': 'nosniff',
      // The pairing URL carries the token; never leak it via Referer.
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...baseHeaders, Allow: 'GET, HEAD' });
      res.end();
      return;
    }

    const urlPath = (req.url ?? '/').split('?')[0].split('#')[0] || '/';
    const resolved = resolveStaticPath(this.opts.staticDir, urlPath);
    if (!resolved) {
      res.writeHead(400, baseHeaders);
      res.end();
      return;
    }

    let filePath = resolved;
    let stat = await fsp.stat(filePath).catch(() => null);
    if (stat?.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stat = await fsp.stat(filePath).catch(() => null);
    }
    if (!stat?.isFile()) {
      // SPA fallback for client-side routes; real asset misses stay 404.
      if (path.extname(resolved)) {
        res.writeHead(404, baseHeaders);
        res.end();
        return;
      }
      filePath = path.join(this.opts.staticDir, 'index.html');
      stat = await fsp.stat(filePath).catch(() => null);
      if (!stat?.isFile()) {
        res.writeHead(503, { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Malvy web UI is not built. Run `npm run build:web` in apps/desktop.');
        return;
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    // Vite emits content-hashed files under /assets/; everything else must stay fresh.
    const isHashedAsset = filePath.startsWith(path.join(path.resolve(this.opts.staticDir), 'assets') + path.sep);
    res.writeHead(200, {
      ...baseHeaders,
      'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-store',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(filePath)
      .on('error', () => res.destroy())
      .pipe(res);
  }
}

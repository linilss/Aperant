import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { decodeRemoteMessage, encodeRemoteMessage } from '../../../shared/remote/codec';
import {
  REMOTE_CLOSE_CODES,
  REMOTE_NOT_AVAILABLE_ERROR,
  type RemoteServerMessage,
} from '../../../shared/remote/protocol';
import type { IpcInvokeHandler, IpcListener } from '../ipc-registry';
import { RemoteServer, resolveStaticPath, tokensMatch } from '../remote-server';

const TOKEN = 'a'.repeat(64);
const PLATFORM = { isWindows: false, isMacOS: true, isLinux: false, isUnix: true };

interface Client {
  ws: WebSocket;
  messages: RemoteServerMessage[];
  closed: Promise<number>;
  next(predicate: (m: RemoteServerMessage) => boolean): Promise<RemoteServerMessage>;
}

function connect(port: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: RemoteServerMessage[] = [];
    const waiters: { predicate: (m: RemoteServerMessage) => boolean; resolve: (m: RemoteServerMessage) => void }[] = [];
    const closed = new Promise<number>((res) => ws.on('close', (code) => res(code)));
    ws.on('message', (data) => {
      const message = decodeRemoteMessage<RemoteServerMessage>(data.toString());
      messages.push(message);
      for (const waiter of [...waiters]) {
        if (waiter.predicate(message)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(message);
        }
      }
    });
    ws.on('open', () =>
      resolve({
        ws,
        messages,
        closed,
        next: (predicate) =>
          new Promise((res) => {
            const found = messages.find(predicate);
            if (found) res(found);
            else waiters.push({ predicate, resolve: res });
          }),
      })
    );
    ws.on('error', reject);
  });
}

async function connectAuthed(port: number, token = TOKEN): Promise<Client> {
  const client = await connect(port);
  client.ws.send(encodeRemoteMessage({ kind: 'auth', token }));
  await client.next((m) => m.kind === 'hello');
  return client;
}

function httpGet(port: number, urlPath: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    // Raw path (no URL normalization) so traversal attempts reach the server as-is.
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('RemoteServer', () => {
  let tmp: string;
  let staticDir: string;
  let handlers: Map<string, IpcInvokeHandler>;
  let listeners: Map<string, IpcListener[]>;
  let server: RemoteServer;
  let port: number;
  let sender: { send: (channel: string, ...args: unknown[]) => void };
  const clients: Client[] = [];

  beforeEach(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'malvy-remote-'));
    staticDir = path.join(tmp, 'web');
    mkdirSync(path.join(staticDir, 'assets'), { recursive: true });
    writeFileSync(path.join(staticDir, 'index.html'), '<html>malvy</html>');
    writeFileSync(path.join(staticDir, 'assets', 'app.js'), 'console.info(1)');
    writeFileSync(path.join(tmp, 'secret.txt'), 'top secret');

    handlers = new Map();
    listeners = new Map();
    sender = { send: vi.fn<(channel: string, ...args: unknown[]) => void>() };
    server = new RemoteServer({
      registry: {
        getHandler: (channel) => handlers.get(channel),
        getListeners: (channel) => listeners.get(channel) ?? [],
      },
      getToken: () => TOKEN,
      staticDir,
      getSender: () => sender,
      platform: PLATFORM,
      isChannelDenied: (channel) => channel === 'dialog:selectDirectory',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      maxAuthFailures: 3,
    });
    port = await server.start(0, '127.0.0.1');
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) client.ws.terminate();
    await server.stop();
    rmSync(tmp, { recursive: true, force: true });
  });

  async function track(promise: Promise<Client>): Promise<Client> {
    const client = await promise;
    clients.push(client);
    return client;
  }

  it('rejects a wrong token with the unauthorized close code', async () => {
    const client = await track(connect(port));
    client.ws.send(encodeRemoteMessage({ kind: 'auth', token: 'wrong' }));
    expect(await client.closed).toBe(REMOTE_CLOSE_CODES.UNAUTHORIZED);
    expect(server.clientCount).toBe(0);
  });

  it('rejects invoke before auth', async () => {
    handlers.set('task:list', vi.fn(() => []));
    const client = await track(connect(port));
    client.ws.send(encodeRemoteMessage({ kind: 'invoke', id: 1, channel: 'task:list', args: [] }));
    expect(await client.closed).toBe(REMOTE_CLOSE_CODES.UNAUTHORIZED);
    expect(handlers.get('task:list')).not.toHaveBeenCalled();
  });

  it('rate-limits an address after repeated bad tokens', async () => {
    for (let i = 0; i < 3; i++) {
      const bad = await track(connect(port));
      bad.ws.send(encodeRemoteMessage({ kind: 'auth', token: `bad-${i}` }));
      await bad.closed;
    }
    // Even the right token is refused while blocked.
    const blocked = await track(connect(port));
    expect(await blocked.closed).toBe(REMOTE_CLOSE_CODES.RATE_LIMITED);
  });

  it('sends hello with platform info and round-trips invoke', async () => {
    const handler = vi.fn(async (event: Record<string, unknown>, projectId: string, when: Date) => ({
      projectId,
      year: when.getFullYear(),
      remote: event.remote,
      hasSender: event.sender === sender,
      at: new Date('2026-01-02T03:04:05.000Z'),
    }));
    handlers.set('project:get', handler as unknown as IpcInvokeHandler);

    const client = await track(connectAuthed(port));
    expect(client.messages[0]).toEqual({ kind: 'hello', platform: PLATFORM });
    expect(server.clientCount).toBe(1);

    client.ws.send(
      encodeRemoteMessage({ kind: 'invoke', id: 7, channel: 'project:get', args: ['p1', new Date('2025-06-01')] })
    );
    const result = await client.next((m) => m.kind === 'result' && m.id === 7);

    expect(result).toMatchObject({ kind: 'result', id: 7, ok: true });
    const value = (result as { value: { at: Date } }).value;
    expect(value).toMatchObject({ projectId: 'p1', year: 2025, remote: true, hasSender: true });
    expect(value.at).toBeInstanceOf(Date);
  });

  it('returns handler errors and unknown channels as failed results', async () => {
    handlers.set('boom', () => {
      throw new Error('kaboom');
    });
    const client = await track(connectAuthed(port));

    client.ws.send(encodeRemoteMessage({ kind: 'invoke', id: 1, channel: 'boom', args: [] }));
    client.ws.send(encodeRemoteMessage({ kind: 'invoke', id: 2, channel: 'nope', args: [] }));

    expect(await client.next((m) => m.kind === 'result' && m.id === 1)).toMatchObject({ ok: false, error: 'kaboom' });
    expect(await client.next((m) => m.kind === 'result' && m.id === 2)).toMatchObject({
      ok: false,
      error: expect.stringContaining('nope'),
    });
  });

  it('refuses denylisted channels without calling the handler', async () => {
    const handler = vi.fn();
    handlers.set('dialog:selectDirectory', handler);
    const listener = vi.fn();
    listeners.set('dialog:selectDirectory', [listener]);
    const client = await track(connectAuthed(port));

    client.ws.send(encodeRemoteMessage({ kind: 'send', channel: 'dialog:selectDirectory', args: [] }));
    client.ws.send(encodeRemoteMessage({ kind: 'invoke', id: 3, channel: 'dialog:selectDirectory', args: [] }));

    expect(await client.next((m) => m.kind === 'result' && m.id === 3)).toMatchObject({
      ok: false,
      error: REMOTE_NOT_AVAILABLE_ERROR,
    });
    expect(handler).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('dispatches send messages to on() listeners', async () => {
    const received = new Promise<unknown[]>((resolve) => {
      listeners.set('terminal:input', [(event, ...args) => resolve([event.remote, ...args])]);
    });
    const client = await track(connectAuthed(port));

    client.ws.send(encodeRemoteMessage({ kind: 'send', channel: 'terminal:input', args: ['t1', 'ls\n'] }));

    expect(await received).toEqual([true, 't1', 'ls\n']);
  });

  it('broadcasts events to authenticated clients only', async () => {
    const authed = await track(connectAuthed(port));
    const pending = await track(connect(port)); // connected but never authenticated

    server.broadcast('task:progress', ['t1', { pct: 50 }]);

    expect(await authed.next((m) => m.kind === 'event')).toEqual({
      kind: 'event',
      channel: 'task:progress',
      args: ['t1', { pct: 50 }],
    });
    // Give the unauthenticated socket a chance to (wrongly) receive something.
    await new Promise((r) => setTimeout(r, 50));
    expect(pending.messages).toHaveLength(0);
  });

  it('skips non-serializable broadcast args without throwing', async () => {
    const client = await track(connectAuthed(port));
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => server.broadcast('bad', [circular])).not.toThrow();
    server.broadcast('good', [1]);

    expect(await client.next((m) => m.kind === 'event')).toMatchObject({ channel: 'good' });
  });

  it('disconnectAll closes clients with the unauthorized code (token rotation)', async () => {
    const client = await track(connectAuthed(port));
    server.disconnectAll();
    expect(await client.closed).toBe(REMOTE_CLOSE_CODES.UNAUTHORIZED);
  });

  it('serves static files, SPA fallback, and blocks traversal', async () => {
    const index = await httpGet(port, '/');
    expect(index.status).toBe(200);
    expect(index.body).toContain('malvy');
    expect(index.headers['content-type']).toContain('text/html');
    expect(index.headers['referrer-policy']).toBe('no-referrer');

    const asset = await httpGet(port, '/assets/app.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['content-type']).toContain('javascript');

    const route = await httpGet(port, '/projects/abc');
    expect(route.status).toBe(200);
    expect(route.body).toContain('malvy');

    expect((await httpGet(port, '/assets/missing.js')).status).toBe(404);

    for (const attempt of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt', '/..%5csecret.txt']) {
      const res = await httpGet(port, attempt);
      expect(res.body).not.toContain('top secret');
    }
  });
});

describe('resolveStaticPath', () => {
  const root = path.resolve('/srv/web');

  it('keeps paths inside the root', () => {
    expect(resolveStaticPath(root, '/assets/a.js')).toBe(path.join(root, 'assets', 'a.js'));
    expect(resolveStaticPath(root, '/')).toBe(root);
  });

  it('rejects traversal, NUL bytes and malformed encoding', () => {
    expect(resolveStaticPath(root, '/%00')).toBeNull();
    expect(resolveStaticPath(root, '/%E0%A4%A')).toBeNull();
    const escaped = resolveStaticPath(root, '/../../etc/passwd');
    expect(escaped === null || escaped.startsWith(root)).toBe(true);
  });
});

describe('tokensMatch', () => {
  it('compares tokens of any length safely', () => {
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true);
    expect(tokensMatch('short', TOKEN)).toBe(false);
    expect(tokensMatch(undefined, TOKEN)).toBe(false);
    expect(tokensMatch('', '')).toBe(false);
  });
});

/**
 * WebSocket transport for the LAN web UI.
 *
 * Authenticates with the pairing token, correlates invoke requests with
 * results, delivers server events, and reconnects with exponential backoff.
 * A close with REMOTE_CLOSE_CODES.UNAUTHORIZED / RATE_LIMITED stops
 * reconnecting and reports status 'unauthorized'.
 */

import { decodeRemoteMessage, encodeRemoteMessage } from '../../shared/remote/codec';
import {
  REMOTE_CLOSE_CODES,
  type RemoteClientMessage,
  type RemoteServerMessage,
} from '../../shared/remote/protocol';
import type { RemotePlatformInfo } from '../../shared/types/remote-access';

export type RemoteTransportStatus = 'connecting' | 'connected' | 'reconnecting' | 'unauthorized';

type WebSocketLike = Pick<WebSocket, 'send' | 'close' | 'readyState'> & {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
};

export interface RemoteTransportOptions {
  url: string;
  token: string;
  createSocket?: (url: string) => WebSocketLike;
  minBackoffMs?: number;
  maxBackoffMs?: number;
}

interface PendingInvoke {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

const OPEN = 1;

export class RemoteTransport {
  private socket: WebSocketLike | null = null;
  private ready = false;
  private nextId = 1;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private status: RemoteTransportStatus = 'connecting';
  private readonly pending = new Map<number, PendingInvoke>();
  /** Messages produced while disconnected; flushed after the next successful auth. */
  private readonly outbox: { payload: string; invokeId?: number }[] = [];
  /** Invokes written to a socket and awaiting a result. */
  private readonly inFlight = new Set<number>();
  private readonly eventListeners = new Set<(channel: string, args: unknown[]) => void>();
  private readonly statusListeners = new Set<(status: RemoteTransportStatus) => void>();
  private readonly helloListeners = new Set<(platform: RemotePlatformInfo) => void>();
  private readonly createSocket: (url: string) => WebSocketLike;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(private readonly options: RemoteTransportOptions) {
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.minBackoffMs = options.minBackoffMs ?? 500;
    this.maxBackoffMs = options.maxBackoffMs ?? 10_000;
  }

  getStatus(): RemoteTransportStatus {
    return this.status;
  }

  connect(): void {
    this.stopped = false;
    this.open();
  }

  close(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }

  invoke(channel: string, args: unknown[]): Promise<unknown> {
    if (this.status === 'unauthorized') {
      return Promise.reject(new Error('Not paired with Malvy'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ kind: 'invoke', id, channel, args });
    });
  }

  send(channel: string, args: unknown[]): void {
    if (this.status === 'unauthorized') return;
    this.post({ kind: 'send', channel, args });
  }

  onEvent(listener: (channel: string, args: unknown[]) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStatus(listener: (status: RemoteTransportStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onHello(listener: (platform: RemotePlatformInfo) => void): () => void {
    this.helloListeners.add(listener);
    return () => this.helloListeners.delete(listener);
  }

  private setStatus(status: RemoteTransportStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private post(message: RemoteClientMessage): void {
    let payload: string;
    try {
      payload = encodeRemoteMessage(message);
    } catch (error) {
      if (message.kind === 'invoke') {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        entry?.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return;
    }
    const invokeId = message.kind === 'invoke' ? message.id : undefined;
    if (this.ready && this.socket?.readyState === OPEN) {
      this.socket.send(payload);
      if (invokeId !== undefined) this.inFlight.add(invokeId);
    } else {
      this.outbox.push({ payload, invokeId });
    }
  }

  private open(): void {
    if (this.stopped) return;
    const socket = this.createSocket(this.options.url);
    this.socket = socket;
    this.ready = false;

    socket.onopen = () => {
      socket.send(encodeRemoteMessage({ kind: 'auth', token: this.options.token } satisfies RemoteClientMessage));
    };

    socket.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let message: RemoteServerMessage;
      try {
        message = decodeRemoteMessage<RemoteServerMessage>(ev.data);
      } catch {
        return;
      }
      this.handleMessage(socket, message);
    };

    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.ready = false;
      // In-flight invokes may or may not have run; fail them rather than replaying.
      for (const id of this.inFlight) {
        const entry = this.pending.get(id);
        this.pending.delete(id);
        entry?.reject(new Error('Connection to Malvy lost'));
      }
      this.inFlight.clear();
      if (ev.code === REMOTE_CLOSE_CODES.UNAUTHORIZED || ev.code === REMOTE_CLOSE_CODES.RATE_LIMITED) {
        this.stopped = true;
        this.outbox.length = 0;
        for (const entry of this.pending.values()) entry.reject(new Error('Not paired with Malvy'));
        this.pending.clear();
        this.setStatus('unauthorized');
        return;
      }
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose follows and handles reconnecting.
    };
  }

  private handleMessage(socket: WebSocketLike, message: RemoteServerMessage): void {
    switch (message.kind) {
      case 'hello': {
        this.ready = true;
        this.attempt = 0;
        for (const { payload, invokeId } of this.outbox.splice(0)) {
          socket.send(payload);
          if (invokeId !== undefined) this.inFlight.add(invokeId);
        }
        this.setStatus('connected');
        for (const listener of this.helloListeners) listener(message.platform);
        break;
      }
      case 'result': {
        const entry = this.pending.get(message.id);
        this.inFlight.delete(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        if (message.ok) entry.resolve(message.value);
        else entry.reject(new Error(message.error ?? 'Unknown error'));
        break;
      }
      case 'event': {
        for (const listener of this.eventListeners) listener(message.channel, message.args);
        break;
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.setStatus('reconnecting');
    const delay = Math.min(this.maxBackoffMs, this.minBackoffMs * 2 ** this.attempt);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }
}

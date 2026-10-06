import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeRemoteMessage, encodeRemoteMessage } from '../../../shared/remote/codec';
import { REMOTE_CLOSE_CODES, type RemoteClientMessage } from '../../../shared/remote/protocol';
import { RemoteTransport } from '../remote-transport';

class FakeSocket {
  readyState = 0;
  sent: RemoteClientMessage[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  send(data: string): void {
    this.sent.push(decodeRemoteMessage<RemoteClientMessage>(data));
  }
  close(): void {
    // Server-driven closes are simulated via serverClose().
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(message: unknown): void {
    this.onmessage?.({ data: encodeRemoteMessage(message) });
  }
  serverClose(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const PLATFORM = { isWindows: false, isMacOS: true, isLinux: false, isUnix: true };

describe('RemoteTransport', () => {
  let sockets: FakeSocket[];
  let transport: RemoteTransport;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    transport = new RemoteTransport({
      url: 'ws://host/ws',
      token: 'tok',
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as never;
      },
    });
  });

  afterEach(() => {
    transport.close();
    vi.useRealTimers();
  });

  it('authenticates first and flushes queued invokes after hello', async () => {
    const hello = vi.fn();
    transport.onHello(hello);
    transport.connect();
    const result = transport.invoke('project:list', [1]);

    sockets[0].open();
    expect(sockets[0].sent).toEqual([{ kind: 'auth', token: 'tok' }]);

    sockets[0].receive({ kind: 'hello', platform: PLATFORM });
    expect(hello).toHaveBeenCalledWith(PLATFORM);
    expect(transport.getStatus()).toBe('connected');
    expect(sockets[0].sent[1]).toMatchObject({ kind: 'invoke', channel: 'project:list', args: [1] });

    const { id } = sockets[0].sent[1] as { id: number };
    sockets[0].receive({ kind: 'result', id, ok: true, value: ['p'] });
    await expect(result).resolves.toEqual(['p']);
  });

  it('delivers events and rejects failed results', async () => {
    const events = vi.fn();
    transport.onEvent(events);
    transport.connect();
    sockets[0].open();
    sockets[0].receive({ kind: 'hello', platform: PLATFORM });

    sockets[0].receive({ kind: 'event', channel: 'task:log', args: ['t1', 'line'] });
    expect(events).toHaveBeenCalledWith('task:log', ['t1', 'line']);

    const call = transport.invoke('x', []);
    const { id } = sockets[0].sent.at(-1) as { id: number };
    sockets[0].receive({ kind: 'result', id, ok: false, error: 'nope' });
    await expect(call).rejects.toThrow('nope');
  });

  it('reconnects with backoff and fails in-flight invokes on disconnect', async () => {
    const statuses: string[] = [];
    transport.onStatus((s) => statuses.push(s));
    transport.connect();
    sockets[0].open();
    sockets[0].receive({ kind: 'hello', platform: PLATFORM });
    const inFlight = transport.invoke('slow', []);

    sockets[0].serverClose(1006);
    await expect(inFlight).rejects.toThrow(/lost/);
    expect(statuses).toContain('reconnecting');

    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    sockets[1].receive({ kind: 'hello', platform: PLATFORM });
    expect(transport.getStatus()).toBe('connected');
  });

  it('stops and reports unauthorized on 4401', async () => {
    transport.connect();
    sockets[0].open();
    sockets[0].serverClose(REMOTE_CLOSE_CODES.UNAUTHORIZED);

    expect(transport.getStatus()).toBe('unauthorized');
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    await expect(transport.invoke('x', [])).rejects.toThrow(/Not paired/);
  });
});

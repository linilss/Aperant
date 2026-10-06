import { afterEach, describe, expect, it, vi } from 'vitest';
import { ipcRenderer, type RemoteIpcTransport, resetElectronShim, setRemoteTransport } from '../electron-shim';

function createFakeTransport() {
  const noop = (): void => undefined;
  let emit: (channel: string, args: unknown[]) => void = noop;
  const transport: RemoteIpcTransport & { emit: (channel: string, ...args: unknown[]) => void } = {
    invoke: vi.fn(async (_channel: string, args: unknown[]) => args),
    send: vi.fn(),
    onEvent: (listener) => {
      emit = listener;
      return () => {
        emit = noop;
      };
    },
    emit: (channel, ...args) => emit(channel, args),
  };
  return transport;
}

describe('electron shim ipcRenderer', () => {
  afterEach(() => resetElectronShim());

  it('calls listeners with Electron signature (event, ...args)', () => {
    const transport = createFakeTransport();
    setRemoteTransport(transport);
    const listener = vi.fn();
    ipcRenderer.on('task:progress', listener);

    transport.emit('task:progress', 't1', { pct: 10 });

    expect(listener).toHaveBeenCalledTimes(1);
    const [event, ...args] = listener.mock.calls[0];
    expect(event).toHaveProperty('sender');
    expect(args).toEqual(['t1', { pct: 10 }]);
  });

  it('removeListener / off stop delivery for that listener only', () => {
    const transport = createFakeTransport();
    setRemoteTransport(transport);
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    ipcRenderer.on('evt', a);
    ipcRenderer.on('evt', b);
    ipcRenderer.on('evt', c);

    ipcRenderer.removeListener('evt', a);
    ipcRenderer.off('evt', b);
    transport.emit('evt', 1);

    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    expect(c).toHaveBeenCalledWith(expect.anything(), 1);
    expect(ipcRenderer.listenerCount('evt')).toBe(1);
  });

  it('once listeners fire a single time', () => {
    const transport = createFakeTransport();
    setRemoteTransport(transport);
    const listener = vi.fn();
    ipcRenderer.once('evt', listener);

    transport.emit('evt', 1);
    transport.emit('evt', 2);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('removeAllListeners clears one channel or all', () => {
    const transport = createFakeTransport();
    setRemoteTransport(transport);
    const a = vi.fn();
    const b = vi.fn();
    ipcRenderer.on('a', a);
    ipcRenderer.on('b', b);

    ipcRenderer.removeAllListeners('a');
    transport.emit('a');
    transport.emit('b');
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);

    ipcRenderer.removeAllListeners();
    transport.emit('b');
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('forwards invoke and send to the transport', async () => {
    const transport = createFakeTransport();
    setRemoteTransport(transport);

    await expect(ipcRenderer.invoke('project:list', 1, 'x')).resolves.toEqual([1, 'x']);
    ipcRenderer.send('terminal:input', 't1', 'ls');

    expect(transport.invoke).toHaveBeenCalledWith('project:list', [1, 'x']);
    expect(transport.send).toHaveBeenCalledWith('terminal:input', ['t1', 'ls']);
  });

  it('wraps invoke errors like Electron does', async () => {
    const transport = createFakeTransport();
    transport.invoke = vi.fn(async () => {
      throw new Error('Not available from remote devices');
    });
    setRemoteTransport(transport);

    await expect(ipcRenderer.invoke('dialog:selectDirectory')).rejects.toThrow(
      "Error invoking remote method 'dialog:selectDirectory': Error: Not available from remote devices"
    );
  });

  it('rejects invoke when no transport is connected', async () => {
    await expect(ipcRenderer.invoke('x')).rejects.toThrow(/not connected/);
  });
});

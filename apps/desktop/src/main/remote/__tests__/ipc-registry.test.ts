import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installIpcRegistry, type IpcInvokeHandler } from '../ipc-registry';

/** Minimal ipcMain stand-in that behaves like Electron's (throws on duplicate handle). */
class FakeIpcMain extends EventEmitter {
  readonly invokeHandlers = new Map<string, IpcInvokeHandler>();

  handle(channel: string, handler: IpcInvokeHandler): void {
    if (this.invokeHandlers.has(channel)) {
      throw new Error(`Attempted to register a second handler for '${channel}'`);
    }
    this.invokeHandlers.set(channel, handler);
  }

  handleOnce(channel: string, handler: IpcInvokeHandler): void {
    this.handle(channel, (event, ...args) => {
      this.invokeHandlers.delete(channel);
      return handler(event, ...args);
    });
  }

  removeHandler(channel: string): void {
    this.invokeHandlers.delete(channel);
  }

  /** What Electron does when the desktop renderer calls ipcRenderer.invoke. */
  desktopInvoke(channel: string, ...args: unknown[]): unknown {
    const handler = this.invokeHandlers.get(channel);
    if (!handler) throw new Error(`No handler for ${channel}`);
    return handler({ sender: 'desktop' }, ...args);
  }
}

describe('installIpcRegistry', () => {
  it('records handle() registrations while keeping desktop behaviour', async () => {
    const ipc = new FakeIpcMain();
    const registry = installIpcRegistry(ipc);
    const handler = vi.fn((_event: unknown, a: number, b: number) => a + b);

    ipc.handle('math:add', handler);

    expect(await ipc.desktopInvoke('math:add', 2, 3)).toBe(5);
    expect(registry.getHandler('math:add')).toBe(handler);
    expect(registry.getHandledChannels()).toEqual(['math:add']);
  });

  it('does not record a handler that Electron rejected', () => {
    const ipc = new FakeIpcMain();
    const registry = installIpcRegistry(ipc);
    const first = vi.fn();
    const second = vi.fn();
    ipc.handle('dup', first);

    expect(() => ipc.handle('dup', second)).toThrow(/second handler/);
    expect(registry.getHandler('dup')).toBe(first);
  });

  it('forgets handlers on removeHandler()', () => {
    const ipc = new FakeIpcMain();
    const registry = installIpcRegistry(ipc);
    ipc.handle('gone', vi.fn());

    ipc.removeHandler('gone');

    expect(registry.getHandler('gone')).toBeUndefined();
    expect(ipc.invokeHandlers.has('gone')).toBe(false);
  });

  it('removes handleOnce() handlers after the first call from either side', async () => {
    const ipc = new FakeIpcMain();
    const registry = installIpcRegistry(ipc);
    const handler = vi.fn(() => 'once');
    ipc.handleOnce('one-shot', handler);

    const recorded = registry.getHandler('one-shot');
    expect(recorded).toBeDefined();
    expect(await recorded?.({ remote: true })).toBe('once');

    expect(registry.getHandler('one-shot')).toBeUndefined();
    expect(ipc.invokeHandlers.has('one-shot')).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('exposes on()/once() listeners and reflects removal', () => {
    const ipc = new FakeIpcMain();
    const registry = installIpcRegistry(ipc);
    const persistent = vi.fn();
    const single = vi.fn();
    ipc.on('ping', persistent);
    ipc.once('ping', single);

    for (const listener of registry.getListeners('ping')) listener({ remote: true }, 'x');
    expect(persistent).toHaveBeenCalledWith({ remote: true }, 'x');
    expect(single).toHaveBeenCalledTimes(1);
    // once-listener removed itself, exactly like a desktop emit
    expect(registry.getListeners('ping')).toHaveLength(1);

    ipc.removeListener('ping', persistent);
    expect(registry.getListeners('ping')).toHaveLength(0);
  });

  it('keeps desktop on() delivery intact', () => {
    const ipc = new FakeIpcMain();
    installIpcRegistry(ipc);
    const listener = vi.fn();
    ipc.on('evt', listener);

    ipc.emit('evt', { sender: 'desktop' }, 1);

    expect(listener).toHaveBeenCalledWith({ sender: 'desktop' }, 1);
  });

  it('is idempotent per target', () => {
    const ipc = new FakeIpcMain();
    const first = installIpcRegistry(ipc);
    const second = installIpcRegistry(ipc);
    const handler = vi.fn();
    ipc.handle('x', handler);

    expect(second).toBe(first);
    expect(first.getHandler('x')).toBe(handler);
  });
});

/**
 * IPC handler registry for remote access.
 *
 * Electron does not expose the handlers registered with `ipcMain.handle()`,
 * so we wrap `handle` / `handleOnce` / `removeHandler` to keep a copy of every
 * invoke handler. `ipcMain.on()` listeners need no wrapping: ipcMain is an
 * EventEmitter, so `rawListeners(channel)` already returns exactly what the
 * desktop renderer would trigger (including `once` wrappers that remove
 * themselves).
 *
 * Install this before any handler is registered. Desktop behaviour is
 * unchanged: every call is forwarded to the original Electron method first.
 */

import { ipcMain } from 'electron';

// biome-ignore lint/suspicious/noExplicitAny: mirrors Electron's handler signature
export type IpcInvokeHandler = (event: any, ...args: any[]) => unknown;
// biome-ignore lint/suspicious/noExplicitAny: mirrors Electron's listener signature
export type IpcListener = (event: any, ...args: any[]) => void;

/** The subset of ipcMain the registry needs. */
export interface IpcMainLike {
  handle(channel: string, handler: IpcInvokeHandler): void;
  handleOnce(channel: string, handler: IpcInvokeHandler): void;
  removeHandler(channel: string): void;
  rawListeners(channel: string): unknown[];
}

export interface IpcRegistry {
  /** The invoke handler registered for a channel, if any. */
  getHandler(channel: string): IpcInvokeHandler | undefined;
  /** Listeners registered with ipcMain.on/once for a channel (snapshot). */
  getListeners(channel: string): IpcListener[];
  /** Channels with a registered invoke handler. */
  getHandledChannels(): string[];
}

const registries = new WeakMap<object, IpcRegistry>();

/**
 * Wrap `target` (ipcMain by default) so invoke handlers are recorded.
 * Idempotent: installing twice on the same target returns the same registry.
 */
export function installIpcRegistry(target: IpcMainLike = ipcMain as unknown as IpcMainLike): IpcRegistry {
  const existing = registries.get(target);
  if (existing) return existing;

  const handlers = new Map<string, IpcInvokeHandler>();

  const originalHandle = target.handle.bind(target);
  const originalHandleOnce = target.handleOnce.bind(target);
  const originalRemoveHandler = target.removeHandler.bind(target);

  target.handle = (channel: string, handler: IpcInvokeHandler): void => {
    // Electron throws if a handler already exists; only record on success.
    originalHandle(channel, handler);
    handlers.set(channel, handler);
  };

  target.handleOnce = (channel: string, handler: IpcInvokeHandler): void => {
    // Route through handle() so the registry can enforce once-semantics for
    // both desktop and remote invocations.
    const onceHandler: IpcInvokeHandler = (event, ...args) => {
      target.removeHandler(channel);
      return handler(event, ...args);
    };
    originalHandleOnce(channel, onceHandler);
    handlers.set(channel, onceHandler);
  };

  target.removeHandler = (channel: string): void => {
    originalRemoveHandler(channel);
    handlers.delete(channel);
  };

  const registry: IpcRegistry = {
    getHandler: (channel) => handlers.get(channel),
    getListeners: (channel) => target.rawListeners(channel) as IpcListener[],
    getHandledChannels: () => Array.from(handlers.keys()),
  };

  registries.set(target, registry);
  return registry;
}

/** Registry for the real ipcMain (installs it on first use). */
export function getIpcRegistry(): IpcRegistry {
  return installIpcRegistry();
}

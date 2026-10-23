/**
 * Browser stand-in for the `electron` module, used by the LAN web build.
 *
 * vite.web.config.ts aliases `electron` to this file so the real preload API
 * (src/preload/api/**) can be reused unchanged: its `ipcRenderer` calls go
 * over the RemoteTransport WebSocket instead of Electron IPC.
 *
 * Listener signature matches Electron: `(event, ...args)`.
 */

import { IPC_CHANNELS } from '../../shared/constants/ipc';

export interface RemoteIpcTransport {
  invoke(channel: string, args: unknown[]): Promise<unknown>;
  send(channel: string, args: unknown[]): void;
  onEvent(listener: (channel: string, args: unknown[]) => void): () => void;
}

// biome-ignore lint/suspicious/noExplicitAny: mirrors Electron's listener signature
type Listener = (event: any, ...args: any[]) => void;

interface Registration {
  listener: Listener;
  once: boolean;
}

let transport: RemoteIpcTransport | null = null;
let detachTransport: (() => void) | null = null;
const listeners = new Map<string, Registration[]>();

/** Channels answered in the browser instead of on the desktop. */
const localInvokeHandlers: Record<string, (...args: unknown[]) => Promise<unknown>> = {
  // Open links on the phone, not on the desktop machine.
  [IPC_CHANNELS.SHELL_OPEN_EXTERNAL]: async (url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  },
};

function dispatch(channel: string, args: unknown[]): void {
  const registrations = listeners.get(channel);
  if (!registrations || registrations.length === 0) return;
  const event = { sender: ipcRenderer, senderId: 0, ports: [] };
  for (const registration of [...registrations]) {
    if (registration.once) removeRegistration(channel, registration.listener);
    try {
      registration.listener(event, ...args);
    } catch (error) {
      // Mirror Electron: a throwing listener must not stop the others.
      setTimeout(() => {
        throw error;
      });
    }
  }
}

function removeRegistration(channel: string, listener: Listener): void {
  const registrations = listeners.get(channel);
  if (!registrations) return;
  const index = registrations.findIndex((r) => r.listener === listener);
  if (index !== -1) registrations.splice(index, 1);
  if (registrations.length === 0) listeners.delete(channel);
}

function addRegistration(channel: string, listener: Listener, once: boolean): void {
  const registrations = listeners.get(channel) ?? [];
  registrations.push({ listener, once });
  listeners.set(channel, registrations);
}

/** Connect the shim to a transport (replaces any previous one). */
export function setRemoteTransport(next: RemoteIpcTransport | null): void {
  detachTransport?.();
  transport = next;
  detachTransport = next ? next.onEvent(dispatch) : null;
}

/** Test helper: drop all listeners and the transport. */
export function resetElectronShim(): void {
  setRemoteTransport(null);
  listeners.clear();
}

export const ipcRenderer = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const local = localInvokeHandlers[channel];
    if (local) return local(...args);
    if (!transport) {
      return Promise.reject(new Error(`Error invoking remote method '${channel}': not connected`));
    }
    return transport.invoke(channel, args).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Error invoking remote method '${channel}': Error: ${message}`);
    });
  },

  send(channel: string, ...args: unknown[]): void {
    transport?.send(channel, args);
  },

  on(channel: string, listener: Listener) {
    addRegistration(channel, listener, false);
    return ipcRenderer;
  },

  addListener(channel: string, listener: Listener) {
    return ipcRenderer.on(channel, listener);
  },

  once(channel: string, listener: Listener) {
    addRegistration(channel, listener, true);
    return ipcRenderer;
  },

  removeListener(channel: string, listener: Listener) {
    removeRegistration(channel, listener);
    return ipcRenderer;
  },

  off(channel: string, listener: Listener) {
    return ipcRenderer.removeListener(channel, listener);
  },

  removeAllListeners(channel?: string) {
    if (channel === undefined) listeners.clear();
    else listeners.delete(channel);
    return ipcRenderer;
  },

  listenerCount(channel: string): number {
    return listeners.get(channel)?.length ?? 0;
  },

  setMaxListeners(_n: number) {
    return ipcRenderer;
  },
};

export const contextBridge = {
  exposeInMainWorld(key: string, api: unknown): void {
    (window as unknown as Record<string, unknown>)[key] = api;
  },
};

export const webUtils = {
  /** Browser File objects have no filesystem path on the desktop machine. */
  getPathForFile(_file: File): string {
    return '';
  },
};

export default { ipcRenderer, contextBridge, webUtils };

/**
 * Remote access (LAN web UI) — Electron wiring.
 *
 * - Persists `{ enabled, port, token }` under `remoteAccess` in settings.json.
 * - Starts/stops the RemoteServer (bound to 0.0.0.0 only while enabled).
 * - Mirrors main-window events to remote clients (attachRemoteEventFanout).
 * - Registers the desktop-only REMOTE_ACCESS_* IPC handlers.
 */

import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { app, type BrowserWindow, ipcMain } from 'electron';
import QRCode from 'qrcode';
import { IPC_CHANNELS } from '../../shared/constants/ipc';
import { DEFAULT_REMOTE_ACCESS_PORT } from '../../shared/remote/protocol';
import type {
  RemoteAccessSettings,
  RemoteAccessStatus,
  RemoteAccessStatusChange,
} from '../../shared/types/remote-access';
import { appLog } from '../app-logger';
import { isLinux, isMacOS, isUnix, isWindows } from '../platform';
import { readSettingsFile, writeSettingsFile } from '../settings-utils';
import { getIpcRegistry } from './ipc-registry';
import { isRemoteChannelDenied } from './remote-denylist';
import { RemoteServer } from './remote-server';

let server: RemoteServer | null = null;
let lastError: string | undefined;
let getMainWindowRef: () => BrowserWindow | null = () => null;
/** Serializes start/stop so rapid toggles cannot race. */
let lifecycle: Promise<void> = Promise.resolve();

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

function isValidPort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1024 && port <= 65535;
}

/** Read the remote access config, creating and persisting a token if missing. */
function readConfig(): Required<RemoteAccessSettings> {
  const settings = readSettingsFile() ?? {};
  const stored = (settings.remoteAccess ?? {}) as Partial<RemoteAccessSettings>;
  const config: Required<RemoteAccessSettings> = {
    enabled: stored.enabled === true,
    port: isValidPort(stored.port) ? stored.port : DEFAULT_REMOTE_ACCESS_PORT,
    token: typeof stored.token === 'string' && stored.token.length >= 32 ? stored.token : generateToken(),
  };
  if (config.token !== stored.token) {
    writeConfig(config);
  }
  return config;
}

function writeConfig(config: Required<RemoteAccessSettings>): void {
  const settings = readSettingsFile() ?? {};
  writeSettingsFile({ ...settings, remoteAccess: config });
}

/** Non-internal IPv4 addresses of this machine (what a phone on the LAN can reach). */
export function getLanAddresses(): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      const isV4 = entry.family === 'IPv4' || (entry.family as unknown) === 4;
      if (isV4 && !entry.internal && !entry.address.startsWith('169.254.')) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses;
}

function getStaticDir(): string {
  // app.getAppPath() is apps/desktop in dev and app.asar when packaged; out/web ships in both.
  return path.join(app.getAppPath(), 'out', 'web');
}

function notifyStatusChanged(): void {
  const win = getMainWindowRef();
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  const payload: RemoteAccessStatusChange = {
    running: server?.isRunning ?? false,
    clientCount: server?.clientCount ?? 0,
  };
  win.webContents.send(IPC_CHANNELS.REMOTE_ACCESS_STATUS_CHANGED, payload);
}

async function startServer(port: number): Promise<void> {
  if (server) return;
  const instance = new RemoteServer({
    registry: getIpcRegistry(),
    getToken: () => readConfig().token,
    staticDir: getStaticDir(),
    getSender: () => {
      const win = getMainWindowRef();
      if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return null;
      return win.webContents;
    },
    platform: { isWindows: isWindows(), isMacOS: isMacOS(), isLinux: isLinux(), isUnix: isUnix() },
    isChannelDenied: isRemoteChannelDenied,
    logger: appLog,
    onClientCountChange: () => notifyStatusChanged(),
  });
  try {
    await instance.start(port, '0.0.0.0');
    server = instance;
    lastError = undefined;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    appLog.error('[RemoteAccess] Failed to start server:', error);
  }
  notifyStatusChanged();
}

async function stopServer(): Promise<void> {
  const instance = server;
  server = null;
  if (instance) {
    await instance.stop();
  }
  notifyStatusChanged();
}

/** Apply the persisted config: start, stop or restart the server as needed. */
function applyConfig(): Promise<void> {
  lifecycle = lifecycle.catch(() => undefined).then(async () => {
    const config = readConfig();
    if (!config.enabled) {
      lastError = undefined;
      await stopServer();
      return;
    }
    if (server) {
      // Restart only if the port changed.
      if (server.port === config.port) return;
      await stopServer();
    }
    await startServer(config.port);
  });
  return lifecycle;
}

async function getStatus(): Promise<RemoteAccessStatus> {
  const config = readConfig();
  const running = server?.isRunning ?? false;
  const urls = getLanAddresses().map((ip) => `http://${ip}:${config.port}/`);
  const pairingUrl = running && urls.length > 0 ? `${urls[0]}?token=${config.token}` : null;
  let qrDataUrl: string | null = null;
  if (pairingUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(pairingUrl, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
    } catch (error) {
      appLog.warn('[RemoteAccess] Failed to generate QR code:', error);
    }
  }
  return {
    enabled: config.enabled,
    port: config.port,
    running,
    error: lastError,
    urls,
    pairingUrl,
    qrDataUrl,
    clientCount: server?.clientCount ?? 0,
  };
}

/**
 * Mirror every event sent to the desktop renderer to authenticated remote clients.
 * Call once per main window right after it is created.
 */
export function attachRemoteEventFanout(win: BrowserWindow): void {
  const webContents = win.webContents;
  const originalSend = webContents.send.bind(webContents);
  webContents.send = (channel: string, ...args: unknown[]): void => {
    try {
      originalSend(channel, ...args);
    } finally {
      server?.broadcast(channel, args);
    }
  };
}

/** Register REMOTE_ACCESS_* IPC handlers and start the server if enabled. */
export function initRemoteAccess(getMainWindow: () => BrowserWindow | null): void {
  getMainWindowRef = getMainWindow;

  ipcMain.handle(IPC_CHANNELS.REMOTE_ACCESS_GET_STATUS, () => getStatus());

  ipcMain.handle(
    IPC_CHANNELS.REMOTE_ACCESS_SET_CONFIG,
    async (_event, update: { enabled?: boolean; port?: number }): Promise<RemoteAccessStatus> => {
      const config = readConfig();
      if (typeof update?.enabled === 'boolean') config.enabled = update.enabled;
      if (update?.port !== undefined) {
        if (!isValidPort(update.port)) {
          throw new Error('Port must be an integer between 1024 and 65535');
        }
        config.port = update.port;
      }
      writeConfig(config);
      await applyConfig();
      return getStatus();
    }
  );

  ipcMain.handle(IPC_CHANNELS.REMOTE_ACCESS_ROTATE_TOKEN, async (): Promise<RemoteAccessStatus> => {
    const config = readConfig();
    config.token = generateToken();
    writeConfig(config);
    server?.disconnectAll();
    return getStatus();
  });

  applyConfig().catch((error) => {
    appLog.error('[RemoteAccess] Failed to apply config on startup:', error);
  });
}

/** Stop the server (app quitting). */
export async function shutdownRemoteAccess(): Promise<void> {
  lifecycle = lifecycle.catch(() => undefined).then(() => stopServer());
  await lifecycle;
}

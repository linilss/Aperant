/**
 * Remote access (LAN web UI) wire protocol.
 *
 * The desktop main process exposes its IPC handlers over a WebSocket so a
 * browser on the local network can run the same renderer. Messages are JSON
 * strings encoded with `encodeRemoteMessage` (see codec.ts) so Dates, binary
 * data, Maps and Sets survive the trip the way Electron's structured clone does.
 */

import type { RemotePlatformInfo } from '../types/remote-access';

/** Client → server: authenticate the connection (must be the first message). */
export interface RemoteAuthMessage {
  kind: 'auth';
  token: string;
}

/** Client → server: equivalent of ipcRenderer.invoke. */
export interface RemoteInvokeMessage {
  kind: 'invoke';
  id: number;
  channel: string;
  args: unknown[];
}

/** Client → server: equivalent of ipcRenderer.send. */
export interface RemoteSendMessage {
  kind: 'send';
  channel: string;
  args: unknown[];
}

/** Server → client: sent once after successful authentication. */
export interface RemoteHelloMessage {
  kind: 'hello';
  platform: RemotePlatformInfo;
}

/** Server → client: reply to an invoke. */
export interface RemoteResultMessage {
  kind: 'result';
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** Server → client: equivalent of webContents.send. */
export interface RemoteEventMessage {
  kind: 'event';
  channel: string;
  args: unknown[];
}

export type RemoteClientMessage = RemoteAuthMessage | RemoteInvokeMessage | RemoteSendMessage;
export type RemoteServerMessage = RemoteHelloMessage | RemoteResultMessage | RemoteEventMessage;

/** WebSocket close codes used by the remote server. */
export const REMOTE_CLOSE_CODES = {
  /** Missing, wrong or revoked token. The client should forget its token. */
  UNAUTHORIZED: 4401,
  /** Too many failed auth attempts from this address. */
  RATE_LIMITED: 4429,
  /** Server is shutting down (remote access disabled or app quitting). */
  SERVER_STOPPING: 4001,
  /** Client could not keep up with the event stream. */
  BACKPRESSURE: 4008,
} as const;

/** Error string returned for channels that are not exposed remotely. */
export const REMOTE_NOT_AVAILABLE_ERROR = 'Not available from remote devices';

/** Default port for the remote access server. */
export const DEFAULT_REMOTE_ACCESS_PORT = 4848;

/** Path of the WebSocket endpoint on the remote server. */
export const REMOTE_WS_PATH = '/ws';

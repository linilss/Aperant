/**
 * Remote access (LAN web UI) API — desktop settings only.
 * These channels are denylisted for remote clients.
 */

import { IPC_CHANNELS } from '../../../shared/constants';
import type { RemoteAccessStatus, RemoteAccessStatusChange } from '../../../shared/types/remote-access';
import { createIpcListener, invokeIpc, type IpcListenerCleanup } from './ipc-utils';

export interface RemoteAccessAPI {
  getRemoteAccessStatus: () => Promise<RemoteAccessStatus>;
  setRemoteAccessConfig: (update: { enabled?: boolean; port?: number }) => Promise<RemoteAccessStatus>;
  rotateRemoteAccessToken: () => Promise<RemoteAccessStatus>;
  onRemoteAccessStatusChanged: (callback: (change: RemoteAccessStatusChange) => void) => IpcListenerCleanup;
}

export const createRemoteAccessAPI = (): RemoteAccessAPI => ({
  getRemoteAccessStatus: () => invokeIpc<RemoteAccessStatus>(IPC_CHANNELS.REMOTE_ACCESS_GET_STATUS),
  setRemoteAccessConfig: (update) => invokeIpc<RemoteAccessStatus>(IPC_CHANNELS.REMOTE_ACCESS_SET_CONFIG, update),
  rotateRemoteAccessToken: () => invokeIpc<RemoteAccessStatus>(IPC_CHANNELS.REMOTE_ACCESS_ROTATE_TOKEN),
  onRemoteAccessStatusChanged: (callback) =>
    createIpcListener<[RemoteAccessStatusChange]>(IPC_CHANNELS.REMOTE_ACCESS_STATUS_CHANGED, callback),
});

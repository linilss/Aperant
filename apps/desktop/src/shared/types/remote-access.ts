/**
 * Remote access (LAN web UI) types.
 */

/** Persisted under `AppSettings.remoteAccess`. Managed only via the REMOTE_ACCESS_* IPC channels. */
export interface RemoteAccessSettings {
  enabled: boolean;
  port: number;
  /** Hex-encoded 32-byte pairing token. Rotating it disconnects every paired device. */
  token?: string;
}

/** Host platform info sent to remote clients (replaces the preload `platform` global). */
export interface RemotePlatformInfo {
  isWindows: boolean;
  isMacOS: boolean;
  isLinux: boolean;
  isUnix: boolean;
}

/** Snapshot shown in the desktop settings UI. */
export interface RemoteAccessStatus {
  enabled: boolean;
  port: number;
  running: boolean;
  /** Last start error (e.g. port in use), if any. */
  error?: string;
  /** http://<lan-ip>:<port>/ for every non-internal IPv4 interface. */
  urls: string[];
  /** Pairing URL (first LAN URL + token) encoded in the QR code. */
  pairingUrl: string | null;
  /** QR code PNG as a data URL, or null when not running. */
  qrDataUrl: string | null;
  clientCount: number;
}

/** Pushed to the desktop renderer when the server state or client count changes. */
export interface RemoteAccessStatusChange {
  running: boolean;
  clientCount: number;
}

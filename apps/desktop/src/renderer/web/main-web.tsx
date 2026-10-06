/**
 * Entry point of the LAN web UI (built by vite.web.config.ts into out/web).
 *
 * Builds `window.electronAPI` from the real preload API on top of a WebSocket
 * transport (the `electron` import is aliased to ./electron-shim), then loads
 * the normal renderer App.
 */

import '../../shared/i18n';
import '../styles/globals.css';

import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { REMOTE_WS_PATH } from '../../shared/remote/protocol';
import { ConnectingScreen, NotPairedScreen, ReconnectingBanner } from './RemoteScreens';
import { setRemoteTransport } from './electron-shim';
import { RemoteTransport } from './remote-transport';

const TOKEN_STORAGE_KEY = 'malvy.remoteToken';

function safeStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode / storage disabled: token lives only for this page load.
  }
}

/** Take `?token=` from the URL (then strip it), else fall back to the stored token. */
function readPairingToken(): string | null {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('token');
  if (fromUrl) {
    safeStorageSet(TOKEN_STORAGE_KEY, fromUrl);
    url.searchParams.delete('token');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    return fromUrl;
  }
  return safeStorageGet(TOKEN_STORAGE_KEY);
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element missing');
const root = ReactDOM.createRoot(rootElement);

const token = readPairingToken();

if (!token) {
  root.render(<NotPairedScreen />);
} else {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const transport = new RemoteTransport({ url: `${wsProtocol}//${window.location.host}${REMOTE_WS_PATH}`, token });
  setRemoteTransport(transport);

  let appLoaded = false;

  transport.onStatus((status) => {
    if (status === 'unauthorized') {
      safeStorageSet(TOKEN_STORAGE_KEY, null);
      root.render(<NotPairedScreen />);
    }
  });

  transport.onHello(async (platform) => {
    if (appLoaded) return;
    appLoaded = true;

    window.platform = platform;
    window.DEBUG = false;
    window.isRemote = true;
    const { createElectronAPI } = await import('../../preload/api');
    window.electronAPI = createElectronAPI();

    const { App } = await import('../App');
    root.render(
      <StrictMode>
        <ReconnectingBanner transport={transport} />
        <App />
      </StrictMode>
    );
  });

  root.render(<ConnectingScreen />);
  transport.connect();
}

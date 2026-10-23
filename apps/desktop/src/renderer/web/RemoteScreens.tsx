/**
 * Full-screen states and the reconnect banner for the LAN web UI.
 */

import { Loader2, Smartphone, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RemoteTransport, RemoteTransportStatus } from './remote-transport';

export function NotPairedScreen() {
  const { t } = useTranslation('common');
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="max-w-sm space-y-4 text-center">
        <Smartphone className="mx-auto h-12 w-12 text-muted-foreground" />
        <h1 className="text-xl font-semibold">{t('remote.notPaired.title')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('remote.notPaired.description')}
        </p>
      </div>
    </div>
  );
}

export function ConnectingScreen() {
  const { t } = useTranslation('common');
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        {t('remote.connecting')}
      </div>
    </div>
  );
}

/** Small fixed banner shown while the WebSocket is reconnecting. */
export function ReconnectingBanner({ transport }: { transport: RemoteTransport }) {
  const { t } = useTranslation('common');
  const [status, setStatus] = useState<RemoteTransportStatus>(transport.getStatus());

  useEffect(() => transport.onStatus(setStatus), [transport]);

  if (status !== 'reconnecting') return null;
  return (
    <div
      role="status"
      className="fixed left-1/2 top-2 z-[9999] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs text-foreground shadow-lg"
    >
      <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />
      {t('remote.reconnecting')}
    </div>
  );
}

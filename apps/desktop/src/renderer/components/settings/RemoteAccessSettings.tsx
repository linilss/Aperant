import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, AlertTriangle, Loader2, RefreshCw, Smartphone } from 'lucide-react';
import type { RemoteAccessStatus } from '../../../shared/types/remote-access';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { SettingsSection } from './SettingsSection';

/**
 * LAN web access: lets a phone on the same network open Malvy in a browser.
 * Desktop only (hidden in the remote web UI).
 */
export function RemoteAccessSettings() {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
  const [portInput, setPortInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyStatus = useCallback((next: RemoteAccessStatus) => {
    setStatus(next);
    setPortInput(String(next.port));
  }, []);

  const refresh = useCallback(async () => {
    try {
      applyStatus(await window.electronAPI.getRemoteAccessStatus());
    } catch {
      setError(t('remoteAccess.loadFailed'));
    }
  }, [applyStatus, t]);

  useEffect(() => {
    void refresh();
    return window.electronAPI.onRemoteAccessStatusChanged((change) => {
      setStatus((prev) => {
        if (!prev) return prev;
        // Server started/stopped: QR and URLs need a fresh fetch.
        if (prev.running !== change.running) void refresh();
        return { ...prev, clientCount: change.clientCount, running: change.running };
      });
    });
  }, [refresh]);

  const run = async (action: () => Promise<RemoteAccessStatus>) => {
    setBusy(true);
    setError(null);
    try {
      applyStatus(await action());
    } catch (err) {
      setError(t('remoteAccess.saveFailed', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  };

  const parsedPort = Number(portInput);
  const portValid = Number.isInteger(parsedPort) && parsedPort >= 1024 && parsedPort <= 65535;

  return (
    <SettingsSection title={t('remoteAccess.title')} description={t('remoteAccess.description')}>
      <div className="space-y-6">
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="space-y-1">
            <p className="font-medium text-foreground">{t('remoteAccess.warningTitle')}</p>
            <p className="text-muted-foreground">{t('remoteAccess.warning')}</p>
            <p className="text-muted-foreground">{t('remoteAccess.outsideHome')}</p>
          </div>
        </div>

        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Smartphone className="h-5 w-5 text-muted-foreground" />
              <div>
                <Label htmlFor="remote-access-toggle" className="cursor-pointer text-sm font-medium text-foreground">
                  {t('remoteAccess.enable')}
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('remoteAccess.enableDescription')}</p>
              </div>
            </div>
            <Switch
              id="remote-access-toggle"
              checked={status?.enabled ?? false}
              disabled={!status || busy}
              onCheckedChange={(enabled) => run(() => window.electronAPI.setRemoteAccessConfig({ enabled }))}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="remote-access-port" className="text-sm font-medium text-foreground">
            {t('remoteAccess.port')}
          </Label>
          <p className="text-xs text-muted-foreground">{t('remoteAccess.portDescription')}</p>
          <div className="flex max-w-xs items-center gap-2">
            <Input
              id="remote-access-port"
              inputMode="numeric"
              value={portInput}
              disabled={!status || busy}
              onChange={(e) => setPortInput(e.target.value.trim())}
            />
            <Button
              variant="outline"
              disabled={!status || busy || !portValid || parsedPort === status?.port}
              onClick={() => run(() => window.electronAPI.setRemoteAccessConfig({ port: parsedPort }))}
            >
              {t('remoteAccess.applyPort')}
            </Button>
          </div>
          {portInput !== '' && !portValid && (
            <p className="text-xs text-destructive">{t('remoteAccess.portInvalid')}</p>
          )}
        </div>

        {status?.enabled && (
          <div className="space-y-4 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t('remoteAccess.status')}</span>
              <span className={status.running ? 'text-green-500' : 'text-muted-foreground'}>
                {status.running ? t('remoteAccess.running') : t('remoteAccess.stopped')}
              </span>
            </div>
            {status.error && (
              <p className="text-xs text-destructive">{t('remoteAccess.startFailed', { error: status.error })}</p>
            )}
            <div className="text-sm text-muted-foreground">
              {t('remoteAccess.connectedClients', { count: status.clientCount })}
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{t('remoteAccess.addresses')}</p>
              {status.urls.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('remoteAccess.noAddresses')}</p>
              ) : (
                status.urls.map((url) => (
                  <code key={url} className="block rounded bg-muted/50 px-2 py-1 font-mono text-xs">
                    {url}
                  </code>
                ))
              )}
            </div>

            {status.qrDataUrl && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">{t('remoteAccess.scanToPair')}</p>
                <img
                  src={status.qrDataUrl}
                  alt={t('remoteAccess.scanToPair')}
                  className="h-60 w-60 rounded-md bg-white p-2"
                />
              </div>
            )}

            <div className="space-y-1">
              <Button
                variant="outline"
                className="flex items-center gap-2"
                disabled={busy}
                onClick={() => run(() => window.electronAPI.rotateRemoteAccessToken())}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {t('remoteAccess.rotateToken')}
              </Button>
              <p className="text-xs text-muted-foreground">{t('remoteAccess.rotateTokenDescription')}</p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}

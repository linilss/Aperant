import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Rocket, RefreshCw, Play, AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import { escapeShellPath } from '../../../shared/utils/shell-escape';
import type { DeployScript } from '../../../shared/types';

interface DeployProps {
  projectId: string;
  /** Opens an agent terminal in the project and runs the command; returns false if no terminal could be opened */
  onRunInTerminal: (command: string, title: string) => boolean;
}

export function Deploy({ projectId, onRunInTerminal }: DeployProps) {
  const { t } = useTranslation('deploy');
  const [scripts, setScripts] = useState<DeployScript[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const result = await window.electronAPI.listDeployScripts(projectId);
    if (result.success) {
      setScripts(result.data ?? []);
    } else {
      setError(result.error ?? t('loadFailed'));
    }
    setIsLoading(false);
  }, [projectId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const run = (script: DeployScript, args: string) => {
    const command = `bash ${escapeShellPath(`./${script.relativePath}`)}${args.trim() ? ` ${args.trim()}` : ''}`;
    if (!onRunInTerminal(command, `${t('title')}: ${script.name}`)) {
      setError(t('terminalLimit'));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Rocket className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-foreground">{t('title')}</h2>
            <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={isLoading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          {t('refresh')}
        </Button>
      </div>

      {error && (
        <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {!isLoading && scripts.length === 0 && !error ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Rocket className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">{t('empty.title')}</h3>
          <p className="max-w-md text-sm text-muted-foreground">{t('empty.description')}</p>
          <p className="max-w-md text-xs text-muted-foreground">{t('empty.hint')}</p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="space-y-3 p-6">
            {scripts.map((script) => (
              <DeployScriptCard key={script.relativePath} script={script} onRun={run} />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function DeployScriptCard({
  script,
  onRun
}: {
  script: DeployScript;
  onRun: (script: DeployScript, args: string) => void;
}) {
  const { t } = useTranslation('deploy');
  const [args, setArgs] = useState('');
  // Deploys are outward-facing: first click arms, second click runs
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);

  const handleClick = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    onRun(script, args);
  };

  const folder = script.relativePath.includes('/')
    ? script.relativePath.slice(0, script.relativePath.lastIndexOf('/') + 1)
    : '';

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm">
            <span className="text-muted-foreground">{folder}</span>
            <span className="font-semibold text-foreground">{script.name}</span>
          </p>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground" title={script.description}>
            {script.description || t('noDescription')}
          </p>
          {script.usage && (
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              {t('usage')}: {script.usage}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {script.usage && (
            <Input
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder={t('argsPlaceholder')}
              className="h-8 w-44 font-mono text-xs"
            />
          )}
          <Button size="sm" variant={armed ? 'destructive' : 'default'} onClick={handleClick}>
            <Play className="mr-2 h-4 w-4" />
            {armed ? t('confirm', { name: script.name }) : t('run')}
          </Button>
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Rocket, RefreshCw, Play, AlertCircle, FileText, Save, Square, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import { PageHeader, PAGE_BODY, PAGE_ROOT } from '../ui/page-header';
import { cn } from '../../lib/utils';
import { useProjectStore } from '../../stores/project-store';
import { buildDeployCommand } from './deploy-command';
import type { DeployRunRecord, DeployScript } from '../../../shared/types';
import { Textarea } from '../ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { formatRelativeTime } from '../../lib/utils';
import { useDeployDialogStore } from '../../stores/deploy-dialog-store';

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
  const settings = useProjectStore((s) => s.projects.find((p) => p.id === projectId)?.settings);
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
    const command = buildDeployCommand(script, args);
    if (!onRunInTerminal(command, `${t('title')}: ${script.name}`)) {
      setError(t('terminalLimit'));
    }
  };

  return (
    <div className={PAGE_ROOT}>
      <PageHeader
        icon={Rocket}
        title={t('title')}
        subtitle={t('subtitle')}
        actions={[
          {
            id: 'refresh',
            label: t('refresh'),
            icon: RefreshCw,
            onClick: load,
            disabled: isLoading,
            busy: isLoading,
            primary: true,
            variant: 'outline',
          },
        ]}
      />

      {error && (
        <div className="mx-6 mt-4 flex shrink-0 items-center gap-2 rounded-lg max-md:mx-3 max-md:mt-3 border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}

      {!isLoading && scripts.length === 0 && !error ? (
        <div className={cn(PAGE_BODY, 'flex flex-col items-center justify-center gap-4 p-8 text-center max-md:p-4')}>
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Rocket className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">{t('empty.title')}</h3>
          <p className="max-w-md text-sm text-muted-foreground">{t('empty.description')}</p>
          <p className="max-w-md text-xs text-muted-foreground">{t('empty.hint')}</p>
        </div>
      ) : (
        <ScrollArea className={PAGE_BODY}>
          <div className="space-y-3 p-6 max-md:p-3">
            <RunbookPanel projectId={projectId} />
            <DeployRunsPanel projectId={projectId} />
            <h3 className="pt-2 text-sm font-semibold text-muted-foreground">{t('scripts.title')}</h3>
            {scripts.map((script) => (
              <DeployScriptCard
                key={script.relativePath}
                script={script}
                defaultArgs={script.relativePath === settings?.deployScript ? settings?.deployArgs : undefined}
                onRun={run}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function DeployScriptCard({
  script,
  defaultArgs,
  onRun
}: {
  script: DeployScript;
  defaultArgs?: string;
  onRun: (script: DeployScript, args: string) => void;
}) {
  const { t } = useTranslation('deploy');
  const [args, setArgs] = useState(defaultArgs ?? '');
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
      <div className="flex items-start justify-between gap-4 max-md:flex-col max-md:items-stretch max-md:gap-3">
        <div className="min-w-0 flex-1">
          <p className="break-all font-mono text-sm">
            <span className="text-muted-foreground">{folder}</span>
            <span className="font-semibold text-foreground">{script.name}</span>

          </p>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground" title={script.description}>
            {script.description || t('noDescription')}
          </p>
          {script.usage && (
            <p className="mt-2 break-words font-mono text-xs text-muted-foreground">
              {t('usage')}: {script.usage}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 max-md:flex-col max-md:items-stretch">
          {script.usage && (
            <Input
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder={t('argsPlaceholder')}
              className="h-8 w-44 font-mono text-xs max-md:h-10 max-md:w-full"
            />
          )}
          <Button
            size="sm"
            variant={armed ? 'destructive' : 'default'}
            onClick={handleClick}
            className="max-md:h-10 max-md:w-full"
          >
            <Play className="mr-2 h-4 w-4" />
            {armed ? t('confirm', { name: script.name }) : t('run')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The project's deploy runbook (.malvy/deploy.md): what the Kanban Deploy button follows. */
function RunbookPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation('deploy');
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const [exists, setExists] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.getDeployRunbook(projectId).then((result) => {
      if (cancelled || !result.success || !result.data) return;
      setContent(result.data.content);
      setSaved(result.data.exists ? result.data.content : '');
      setExists(result.data.exists);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const save = async () => {
    setSaving(true);
    const result = await window.electronAPI.saveDeployRunbook(projectId, content);
    setSaving(false);
    if (result.success) {
      setSaved(content);
      setExists(true);
    }
  };
  const dirty = !exists || content !== saved;

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <FileText className="h-4 w-4 text-primary" />
          {t('runbook.title')}
          <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal">.malvy/deploy.md</code>
        </h3>
        <Button size="sm" onClick={save} disabled={!dirty || saving} className="h-8">
          <Save className="mr-2 h-4 w-4" />
          {exists ? t('runbook.save') : t('runbook.saveGenerated')}
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t('runbook.description')}</p>
      {!exists && <p className="mt-2 text-xs font-medium text-warning">{t('runbook.generated')}</p>}
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
        className="mt-3 min-h-64 font-mono text-xs"
      />
    </div>
  );
}

/** Recent runbook deploys with status, versions and their log; cancel a running one. */
function DeployRunsPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation('deploy');
  const [history, setHistory] = useState<DeployRunRecord[]>([]);
  const activeRun = useDeployDialogStore((s) => s.runs[projectId]);
  const [logFor, setLogFor] = useState<string | null>(null);

  // Reload when a run starts or ends (activeRun id changes)
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeRun?.id is the trigger
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const result = await window.electronAPI.getDeployStatus(projectId).catch(() => null);
      if (cancelled || !result?.success || !result.data) return;
      setHistory(result.data.history);
      useDeployDialogStore.getState().setRun(projectId, result.data.active);
      if (result.data.active) timer = setTimeout(load, 5000);
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectId, activeRun?.id]);

  if (history.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">{t('runs.title')}</h3>
      <ul className="mt-2 divide-y divide-border">
        {history.map((run) => {
          const live = activeRun?.id === run.id ? activeRun : run;
          const ran = live.steps?.filter((s) => s.run).map((s) => s.name) ?? [];
          return (
            <li key={run.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              {live.status === 'running' ? (
                <Loader2 className="h-4 w-4 animate-spin text-info" />
              ) : live.status === 'succeeded' ? (
                <CheckCircle2 className="h-4 w-4 text-success" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
              <span className="text-muted-foreground">{formatRelativeTime(new Date(run.startedAt))}</span>
              <span className="min-w-0 flex-1 truncate">
                {live.status === 'running'
                  ? t(`runs.phase.${live.phase ?? 'running'}`, { step: live.currentStep ?? '' })
                  : live.status === 'failed'
                    ? live.reason
                    : [ran.join(' → '), live.version && `${live.version}${live.build ? ` (${live.build})` : ''}`]
                        .filter(Boolean)
                        .join(' · ')}
              </span>
              {live.status === 'running' && (
                <Button size="sm" variant="ghost" className="h-7" onClick={() => window.electronAPI.cancelDeploy(projectId)}>
                  <Square className="mr-1.5 h-3 w-3" />
                  {t('runs.cancel')}
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-7" onClick={() => setLogFor(run.id)}>
                {t('runs.log')}
              </Button>
            </li>
          );
        })}
      </ul>
      <DeployLogDialog projectId={projectId} deployId={logFor} onClose={() => setLogFor(null)} />
    </div>
  );
}

/** The log of one deploy run; refreshes while it is running. */
export function DeployLogDialog({ projectId, deployId, onClose }: { projectId: string; deployId: string | null; onClose: () => void }) {
  const { t } = useTranslation('deploy');
  const [text, setText] = useState('');
  const running = useDeployDialogStore((s) => s.runs[projectId]?.id === deployId);

  useEffect(() => {
    if (!deployId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const result = await window.electronAPI.getDeployLog(projectId, deployId).catch(() => null);
      if (!cancelled && result?.success) setText(result.data ?? '');
      if (!cancelled && running) timer = setTimeout(load, 3000);
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectId, deployId, running]);

  return (
    <Dialog open={!!deployId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('runs.logTitle')}</DialogTitle>
        </DialogHeader>
        <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed">
          {text || t('runs.logEmpty')}
        </pre>
      </DialogContent>
    </Dialog>
  );
}

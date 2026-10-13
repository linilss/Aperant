import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Rocket, RefreshCw, Play, AlertCircle, Check, Plus, X, ArrowRight } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import { PageHeader, PAGE_BODY, PAGE_ROOT } from '../ui/page-header';
import { cn } from '../../lib/utils';
import { useProjectStore, updateProjectSettings } from '../../stores/project-store';
import { buildDeployCommand } from './deploy-command';
import type { DeployPlan, DeployScript } from '../../../shared/types';

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
  const [plan, setPlan] = useState<DeployPlan | null>(null);
  const chain = plan?.steps.map((step) => step.script) ?? [];

  const loadPlan = useCallback(async () => {
    const result = await window.electronAPI.getDeployPlan(projectId);
    setPlan(result.success && result.data ? result.data : null);
  }, [projectId]);

  // Re-plan whenever the chain setting changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: settings.deployChain is the trigger
  useEffect(() => {
    void loadPlan();
  }, [loadPlan, settings?.deployChain]);

  const saveChain = (next: string[]) =>
    updateProjectSettings(projectId, { deployChain: next.length > 0 ? next : undefined });
  const toggleInChain = (script: string) =>
    saveChain(chain.includes(script) ? chain.filter((s) => s !== script) : [...chain, script]);

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
            <DeployChainPanel
              plan={plan}
              custom={!!settings?.deployChain?.length}
              onRemove={(script) => saveChain(chain.filter((s) => s !== script))}
              onAdd={(script) => saveChain(chain.includes(script) ? chain : [...chain, script])}
              onReset={() => saveChain([])}
            />
            {scripts.map((script) => (
              <DeployScriptCard
                key={script.relativePath}
                script={script}
                inChain={chain.includes(script.relativePath)}
                defaultArgs={script.relativePath === settings?.deployScript ? settings?.deployArgs : undefined}
                onToggleChain={() => toggleInChain(script.relativePath)}
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
  inChain,
  defaultArgs,
  onToggleChain,
  onRun
}: {
  script: DeployScript;
  inChain: boolean;
  defaultArgs?: string;
  onToggleChain: () => void;
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
            variant={inChain ? 'secondary' : 'ghost'}
            onClick={onToggleChain}
            aria-pressed={inChain}
            className="max-md:h-10 max-md:w-full"
          >
            {inChain ? <Check className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
            {t('chain.include')}
          </Button>
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

/** What the Kanban Deploy button runs, in order; steps can be removed, added or reset. */
function DeployChainPanel({
  plan,
  custom,
  onRemove,
  onAdd,
  onReset
}: {
  plan: DeployPlan | null;
  custom: boolean;
  onRemove: (script: string) => void;
  onAdd: (script: string) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation('deploy');
  const [draft, setDraft] = useState('');
  const steps = plan?.steps ?? [];
  const add = () => {
    const value = draft.trim().replace(/^\.\//, '');
    if (!value) return;
    onAdd(value);
    setDraft('');
  };

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Rocket className="h-4 w-4 text-primary" />
          {t('chain.title')}
        </h3>
        {custom && (
          <Button size="sm" variant="ghost" onClick={onReset} className="h-7 text-xs">
            {t('chain.reset')}
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t('chain.description')}</p>
      {steps.length === 0 ? (
        <p className="mt-3 text-sm text-warning">{t('chain.ask')}</p>
      ) : (
        <ol className="mt-3 flex flex-wrap items-center gap-1.5">
          {steps.map((step, i) => (
            <li key={step.script} className="flex items-center gap-1.5">
              {i > 0 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
              <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 font-mono text-xs">
                {step.script}
                {step.folder && (
                  <span className="font-sans text-[10px] text-muted-foreground">
                    ({t('chain.watches', { folder: step.folder })})
                  </span>
                )}
                {custom && (
                  <button
                    type="button"
                    onClick={() => onRemove(step.script)}
                    aria-label={t('chain.remove', { script: step.script })}
                    className="ml-0.5 rounded text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
      {!custom && steps.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{t('chain.auto')}</p>}
      <div className="mt-3 flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
          placeholder={t('chain.addPlaceholder')}
          className="h-8 font-mono text-xs max-md:h-10"
        />
        <Button size="sm" variant="outline" onClick={add} disabled={!draft.trim()} className="max-md:h-10">
          {t('chain.add')}
        </Button>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, AlertTriangle, Loader2, Rocket } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { cn, formatRelativeTime } from '../../lib/utils';
import { useDeployDialogStore } from '../../stores/deploy-dialog-store';
import { useTaskStore } from '../../stores/task-store';
import { useProjectStore, updateProjectSettings } from '../../stores/project-store';
import { toast } from '../../hooks/use-toast';
import { getLastDeployment, resolveProjectDeployScript } from '../../../shared/utils/task-deployments';
import { buildCleanCheckoutDeployCommand, buildDeployCommand } from './deploy-command';
import type { DeployPreflight, DeployScript, Task } from '../../../shared/types';

interface TaskDeployDialogProps {
  /** Opens an agent terminal in the project root and runs the command; false if no terminal could be opened */
  onRunInTerminal: (command: string, title: string) => boolean;
  /** Navigates to the Ship → Deploy view */
  onOpenDeployView: () => void;
}

/** Saves a started deploy on the task (task_metadata.json) and in the task store. */
async function recordDeployment(task: Task, script: string, args: string): Promise<void> {
  const result = await window.electronAPI.recordTaskDeployment(task.projectId, task.id, { script, args });
  if (result.success && result.data) {
    const current = useTaskStore.getState().tasks.find((x) => x.id === task.id);
    useTaskStore.getState().updateTask(task.id, {
      metadata: { ...(current?.metadata ?? task.metadata), deployments: result.data }
    });
  }
}

function isOffMainBranch(preflight: DeployPreflight | null | undefined): boolean {
  return !!(preflight?.currentBranch && preflight.mainBranch && preflight.currentBranch !== preflight.mainBranch);
}

/**
 * The terminal command for a deploy. With uncommitted changes in the project checkout the
 * script runs in a clean checkout of HEAD instead, so that work doesn't ship.
 */
async function buildTaskDeployCommand(
  projectId: string,
  script: DeployScript,
  args: string,
  preflight: DeployPreflight | null | undefined
): Promise<string> {
  if (!preflight?.hasUncommittedChanges) return buildDeployCommand(script, args);
  const projectPath = useProjectStore.getState().projects.find((p) => p.id === projectId)?.path;
  const checkout = await window.electronAPI.prepareDeployCheckout(projectId);
  if (!projectPath || !checkout.success || !checkout.data) {
    throw new Error(checkout.error || 'Could not prepare a clean checkout to deploy from');
  }
  return buildCleanCheckoutDeployCommand(script, args, checkout.data, projectPath);
}

/**
 * Deploy a merged task: pick one of the project's deploy*.sh scripts, see branch /
 * uncommitted-changes warnings, confirm, then run it in an agent terminal and record it.
 * Mounted once in App; opened via useDeployDialogStore().openForTask(task).
 *
 * Also runs one-click deploys (useDeployDialogStore().deployTask): quick-merge an unmerged
 * task, then run the project's deploy script. Without a resolvable script, or with branch /
 * uncommitted-changes warnings, it opens this dialog instead.
 */
export function TaskDeployDialog({ onRunInTerminal, onOpenDeployView }: TaskDeployDialogProps) {
  const { t } = useTranslation('deploy');
  const task = useDeployDialogStore((s) => s.task);
  const close = useDeployDialogStore((s) => s.close);
  const runInTerminal = useRef(onRunInTerminal);
  runInTerminal.current = onRunInTerminal;

  const deployOneClick = useCallback(
    async (task: Task) => {
      const { setStage, openForTask } = useDeployDialogStore.getState();
      try {
        if (task.status !== 'done') {
          setStage(task.id, 'merging');
          const merge = await window.electronAPI.mergeWorktree(task.id, { quickMerge: true });
          if (!(merge.success && merge.data?.success)) {
            toast({
              title: t('task.mergeFailed'),
              description: merge.data?.message || merge.error,
              variant: 'destructive'
            });
            return;
          }
        }
        setStage(task.id, 'deploying');
        const [scriptsResult, preflightResult] = await Promise.all([
          window.electronAPI.listDeployScripts(task.projectId),
          window.electronAPI.getDeployPreflight(task.projectId)
        ]);
        const current = useTaskStore.getState().tasks.find((x) => x.id === task.id) ?? task;
        const settings = useProjectStore.getState().projects.find((p) => p.id === task.projectId)?.settings;
        const script = scriptsResult.success ? resolveProjectDeployScript(scriptsResult.data ?? [], settings) : null;
        const preflight = preflightResult.success ? preflightResult.data : null;
        if (!script || isOffMainBranch(preflight)) {
          openForTask(current);
          return;
        }
        const args = settings?.deployArgs ?? '';
        const command = await buildTaskDeployCommand(task.projectId, script, args, preflight);
        if (!runInTerminal.current(command, `${t('title')}: ${script.name}`)) {
          toast({ title: t('terminalLimit'), variant: 'destructive' });
          return;
        }
        await recordDeployment(current, script.relativePath, args);
        toast({ title: t('task.started', { script: script.name }) });
      } catch (err) {
        toast({
          title: t('task.failed'),
          description: err instanceof Error ? err.message : String(err),
          variant: 'destructive'
        });
      } finally {
        setStage(task.id, null);
      }
    },
    [t]
  );

  useEffect(() => {
    useDeployDialogStore.getState().setRunner(deployOneClick);
    return () => useDeployDialogStore.getState().setRunner(null);
  }, [deployOneClick]);

  return (
    <Dialog open={!!task} onOpenChange={(open) => !open && close()}>
      {task && (
        <TaskDeployDialogBody
          key={task.id}
          task={task}
          onClose={close}
          onRunInTerminal={onRunInTerminal}
          onOpenDeployView={onOpenDeployView}
        />
      )}
    </Dialog>
  );
}

function TaskDeployDialogBody({
  task,
  onClose,
  onRunInTerminal,
  onOpenDeployView
}: TaskDeployDialogProps & { task: Task; onClose: () => void }) {
  const { t } = useTranslation('deploy');
  const [scripts, setScripts] = useState<DeployScript[] | null>(null);
  const [preflight, setPreflight] = useState<DeployPreflight | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [args, setArgs] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settings = useProjectStore((s) => s.projects.find((p) => p.id === task.projectId)?.settings);
  // Remember the choice so the card's Deploy button runs it next time without asking
  const [makeDefault, setMakeDefault] = useState(!settings?.deployScript);

  // biome-ignore lint/correctness/useExhaustiveDependencies: project settings only seed the initial selection
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      window.electronAPI.listDeployScripts(task.projectId),
      window.electronAPI.getDeployPreflight(task.projectId)
    ]).then(([scriptsResult, preflightResult]) => {
      if (cancelled) return;
      if (scriptsResult.success) {
        const found = scriptsResult.data ?? [];
        setScripts(found);
        // Preselect the project's deploy script, else the one used last time, else the first one
        const preferred = resolveProjectDeployScript(found, settings)?.relativePath ?? getLastDeployment(task)?.script;
        setSelectedPath(found.find((s) => s.relativePath === preferred)?.relativePath ?? found[0]?.relativePath ?? null);
        if (settings?.deployScript && preferred === settings.deployScript) setArgs(settings.deployArgs ?? '');
      } else {
        setScripts([]);
        setError(scriptsResult.error ?? t('loadFailed'));
      }
      if (preflightResult.success && preflightResult.data) setPreflight(preflightResult.data);
    });
    return () => {
      cancelled = true;
    };
  }, [task, t]);

  const selected = scripts?.find((s) => s.relativePath === selectedPath) ?? null;
  const mainBranch = preflight?.mainBranch ?? 'main';
  const lastDeployment = getLastDeployment(task);

  const warnings: string[] = [];
  if (preflight?.currentBranch && preflight.mainBranch && preflight.currentBranch !== preflight.mainBranch) {
    warnings.push(t('task.warnings.notOnMain', { current: preflight.currentBranch, main: preflight.mainBranch }));
  }
  const cleanCheckoutNote = preflight?.hasUncommittedChanges ? t('task.cleanCheckout') : null;

  const handleDeploy = async () => {
    if (!selected) return;
    let command: string;
    try {
      command = await buildTaskDeployCommand(task.projectId, selected, args, preflight);
    } catch (err) {
      setConfirming(false);
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!onRunInTerminal(command, `${t('title')}: ${selected.name}`)) {
      setConfirming(false);
      setError(t('terminalLimit'));
      return;
    }
    if (makeDefault) {
      await updateProjectSettings(task.projectId, { deployScript: selected.relativePath, deployArgs: args.trim() });
    }
    await recordDeployment(task, selected.relativePath, args);
    onClose();
  };

  return (
    <DialogContent className="max-w-xl" onClick={(e) => e.stopPropagation()}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-primary" />
          {t('task.title')}
        </DialogTitle>
        <DialogDescription className="line-clamp-2">{task.title}</DialogDescription>
      </DialogHeader>

      {lastDeployment && (
        <p className="text-xs text-muted-foreground">
          {t('task.lastDeployed', {
            time: formatRelativeTime(new Date(lastDeployment.at)),
            script: lastDeployment.script
          })}
        </p>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {scripts === null ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : scripts.length === 0 ? (
        <div className="space-y-2 rounded-lg border border-dashed border-border p-4 text-sm">
          <p className="font-medium text-foreground">{t('empty.title')}</p>
          <p className="text-muted-foreground">{t('empty.description')}</p>
          <p className="text-xs text-muted-foreground">{t('empty.hint')}</p>
        </div>
      ) : (
        <div className="max-h-[45vh] space-y-2 overflow-y-auto max-md:max-h-none">
          {scripts.map((script) => {
            const isSelected = script.relativePath === selectedPath;
            const folder = script.relativePath.includes('/')
              ? script.relativePath.slice(0, script.relativePath.lastIndexOf('/') + 1)
              : '';
            return (
              <div
                key={script.relativePath}
                className={cn(
                  'rounded-lg border bg-card p-3 transition-colors',
                  isSelected ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/50'
                )}
              >
                <button
                  type="button"
                  aria-pressed={isSelected}
                  className="w-full text-left"
                  onClick={() => {
                    setSelectedPath(script.relativePath);
                    setConfirming(false);
                  }}
                >
                  <p className="break-all font-mono text-sm">
                    <span className="text-muted-foreground">{folder}</span>
                    <span className="font-semibold text-foreground">{script.name}</span>
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={script.description}>
                    {script.description || t('noDescription')}
                  </p>
                  {script.usage && (
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                      {t('usage')}: {script.usage}
                    </p>
                  )}
                </button>
                {isSelected && (
                  <Input
                    value={args}
                    onChange={(e) => {
                      setArgs(e.target.value);
                      setConfirming(false);
                    }}
                    placeholder={t('argsPlaceholder')}
                    aria-label={t('argsPlaceholder')}
                    className="mt-2 h-8 font-mono text-xs max-md:h-10"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {selected && warnings.length > 0 && (
        <div className="space-y-1 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          {warnings.map((warning) => (
            <p key={warning} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {warning}
            </p>
          ))}
        </div>
      )}

      {selected && scripts && scripts.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            id="deploy-make-default"
            checked={makeDefault}
            onCheckedChange={(v) => setMakeDefault(v === true)}
          />
          <label htmlFor="deploy-make-default" className="cursor-pointer">
            {t('task.makeDefault')}
          </label>
        </div>
      )}

      {selected && cleanCheckoutNote && (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          {cleanCheckoutNote}
        </p>
      )}

      {confirming && selected && (
        <p className="text-sm font-medium text-foreground">
          {t('task.confirm', { script: selected.name, branch: mainBranch })}
        </p>
      )}

      <DialogFooter className="max-md:flex-col-reverse">
        {scripts !== null && scripts.length === 0 ? (
          <Button
            variant="outline"
            onClick={() => {
              onClose();
              onOpenDeployView();
            }}
          >
            {t('task.openDeployView')}
          </Button>
        ) : null}
        <Button variant="outline" onClick={confirming ? () => setConfirming(false) : onClose}>
          {t('task.cancel')}
        </Button>
        {scripts && scripts.length > 0 && (
          <Button
            variant={confirming ? 'destructive' : 'default'}
            disabled={!selected}
            onClick={confirming ? handleDeploy : () => setConfirming(true)}
          >
            <Rocket className="mr-2 h-4 w-4" />
            {confirming
              ? warnings.length > 0
                ? t('task.deployAnyway')
                : t('task.deployNow')
              : t('task.review')}
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}

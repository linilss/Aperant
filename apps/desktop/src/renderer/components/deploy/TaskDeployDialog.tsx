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
import { buildChainCommand, buildCleanCheckoutDeployCommand, newDeployLogPath, withDeployLog } from './deploy-command';
import type { DeployPreflight, DeployScript, Task } from '../../../shared/types';

interface TaskDeployDialogProps {
  /** Opens an agent terminal in the project root and runs the command; false if no terminal could be opened */
  onRunInTerminal: (command: string, title: string) => boolean;
  /** Navigates to the Ship → Deploy view */
  onOpenDeployView: () => void;
}

/** Saves a started deploy on the task (task_metadata.json) and in the task store. */
async function recordDeployment(
  task: Task,
  script: string,
  args: string,
  log: string,
  commit?: string,
  steps?: string[]
): Promise<void> {
  const result = await window.electronAPI.recordTaskDeployment(task.projectId, task.id, { script, args, log, commit, steps });
  if (result.success && result.data) {
    const current = useTaskStore.getState().tasks.find((x) => x.id === task.id);
    useTaskStore.getState().updateTask(task.id, {
      metadata: { ...(current?.metadata ?? task.metadata), deployments: result.data }
    });
  }
}

const DEPLOY_POLL_MS = 10_000;
const DEPLOY_POLL_MAX_MS = 3 * 60 * 60 * 1000;

/**
 * Poll the deploy log until the run finishes, then put its outcome (status, version,
 * build) on the tasks. Runs in the background; harmless if the window reloads.
 */
function watchDeployments(projectId: string, taskIds: string[]): void {
  const started = Date.now();
  const tick = async () => {
    const result = await window.electronAPI.resolveTaskDeployments(projectId, taskIds).catch(() => null);
    let running = false;
    if (result?.success && result.data) {
      for (const [taskId, deployments] of Object.entries(result.data)) {
        const current = useTaskStore.getState().tasks.find((x) => x.id === taskId);
        if (current) useTaskStore.getState().updateTask(taskId, { metadata: { ...current.metadata, deployments } });
        if (deployments[deployments.length - 1]?.status === 'running') running = true;
      }
    }
    if (running && Date.now() - started < DEPLOY_POLL_MAX_MS) setTimeout(tick, DEPLOY_POLL_MS);
  };
  setTimeout(tick, DEPLOY_POLL_MS);
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
  deployCommand: string,
  preflight: DeployPreflight | null | undefined
): Promise<{ command: string; log: string }> {
  const projectPath = useProjectStore.getState().projects.find((p) => p.id === projectId)?.path;
  if (!projectPath) throw new Error('Project not found');
  const log = newDeployLogPath();
  if (!preflight?.hasUncommittedChanges) {
    return { command: withDeployLog(deployCommand, projectPath, log), log };
  }
  const checkout = await window.electronAPI.prepareDeployCheckout(projectId);
  if (!checkout.success || !checkout.data) {
    throw new Error(checkout.error || 'Could not prepare a clean checkout to deploy from');
  }
  return {
    command: withDeployLog(buildCleanCheckoutDeployCommand(deployCommand, checkout.data, projectPath), projectPath, log),
    log
  };
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

  /**
   * Deploy step shared by one-click and batch deploys: run the project's deploy script
   * and record it on every task. Falls back to the dialog (for the last task) without a
   * resolvable script or when the checkout is on the wrong branch.
   */
  const deployMerged = useCallback(
    async (tasks: Task[]) => {
      const last = tasks[tasks.length - 1];
      const projectId = last.projectId;
      const [planResult, preflightResult] = await Promise.all([
        window.electronAPI.getDeployPlan(projectId),
        window.electronAPI.getDeployPreflight(projectId)
      ]);
      const fresh = (task: Task) => useTaskStore.getState().tasks.find((x) => x.id === task.id) ?? task;
      const settings = useProjectStore.getState().projects.find((p) => p.id === projectId)?.settings;
      const plan = planResult.success ? planResult.data : undefined;
      const preflight = preflightResult.success ? preflightResult.data : null;
      if (!plan || plan.steps.length === 0 || isOffMainBranch(preflight)) {
        useDeployDialogStore.getState().openForTask(fresh(last));
        return;
      }
      const steps = plan.steps.filter((s) => s.run).map((s) => s.script);
      const skipped = plan.steps.filter((s) => !s.run).map((s) => s.script);
      if (steps.length === 0) {
        toast({ title: t('chain.nothingChanged', { skipped: skipped.join(', ') }) });
        return;
      }
      const args = settings?.deployArgs ?? '';
      const label = steps.join(' → ');
      const { command, log } = await buildTaskDeployCommand(projectId, buildChainCommand(steps, args), preflight);
      if (!runInTerminal.current(command, `${t('title')}: ${label}`)) {
        toast({ title: t('terminalLimit'), variant: 'destructive' });
        return;
      }
      for (const task of tasks) {
        await recordDeployment(fresh(task), label, steps.length === 1 ? args : '', log, plan.commit, steps);
      }
      watchDeployments(projectId, tasks.map((task) => task.id));
      toast({
        title: t('task.started', { script: label }),
        ...(skipped.length > 0 ? { description: t('chain.skipped', { skipped: skipped.join(', ') }) } : {})
      });
    },
    [t]
  );

  const quickMerge = useCallback(
    async (task: Task): Promise<boolean> => {
      const merge = await window.electronAPI.mergeWorktree(task.id, { quickMerge: true });
      if (merge.success && merge.data?.success) return true;
      toast({
        title: t('batch.mergeFailed', { title: task.title }),
        description: merge.data?.message || merge.error,
        variant: 'destructive'
      });
      return false;
    },
    [t]
  );

  const deployOneClick = useCallback(
    async (task: Task) => {
      const { setStage } = useDeployDialogStore.getState();
      try {
        if (task.status !== 'done') {
          setStage(task.id, 'merging');
          if (!(await quickMerge(task))) return;
        }
        setStage(task.id, 'deploying');
        await deployMerged([task]);
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
    [t, quickMerge, deployMerged]
  );

  /** Merge every task oldest first (AI resolves conflicts), verify + fix collisions, deploy once. */
  const deployBatch = useCallback(
    async (tasks: Task[]) => {
      if (tasks.length === 0) return;
      const { setStage, setBatch } = useDeployDialogStore.getState();
      const projectId = tasks[0].projectId;
      const ordered = [...tasks].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const merged: Task[] = [];
      try {
        for (const [index, task] of ordered.entries()) {
          setBatch(projectId, { step: 'merging', index: index + 1, total: ordered.length });
          setStage(task.id, 'merging');
          const ok = await quickMerge(task);
          setStage(task.id, null);
          if (!ok) {
            if (merged.length > 0) toast({ title: t('batch.stopped', { merged: merged.length, total: ordered.length }) });
            return;
          }
          merged.push(task);
        }

        setBatch(projectId, { step: 'verifying', index: ordered.length, total: ordered.length });
        const verify = await window.electronAPI.verifyBeforeDeploy(
          projectId,
          merged.map((task) => task.title)
        );
        if (!verify.success || !verify.data?.ok) {
          toast({
            title:
              verify.data?.reason === 'uncommitted' ? t('batch.verifyFailedUncommitted') : t('batch.verifyFailed'),
            description: verify.data?.output?.split('\n').slice(-6).join('\n') || verify.error,
            variant: 'destructive'
          });
          return;
        }
        if (verify.data.fixed) toast({ title: t('batch.fixed') });

        setBatch(projectId, { step: 'deploying', index: ordered.length, total: ordered.length });
        await deployMerged(merged);
      } catch (err) {
        toast({
          title: t('task.failed'),
          description: err instanceof Error ? err.message : String(err),
          variant: 'destructive'
        });
      } finally {
        for (const task of ordered) setStage(task.id, null);
        setBatch(projectId, null);
      }
    },
    [t, quickMerge, deployMerged]
  );

  useEffect(() => {
    const store = useDeployDialogStore.getState();
    store.setRunner(deployOneClick);
    store.setBatchRunner(deployBatch);
    return () => {
      store.setRunner(null);
      store.setBatchRunner(null);
    };
  }, [deployOneClick, deployBatch]);

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
    let log: string;
    try {
      ({ command, log } = await buildTaskDeployCommand(task.projectId, buildChainCommand([selected.relativePath], args), preflight));
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
    const plan = await window.electronAPI.getDeployPlan(task.projectId).catch(() => null);
    await recordDeployment(task, selected.relativePath, args, log, plan?.data?.commit, [selected.relativePath]);
    watchDeployments(task.projectId, [task.id]);
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

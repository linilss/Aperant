import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, AlertTriangle, Loader2, Rocket } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { cn, formatRelativeTime } from '../../lib/utils';
import { useDeployDialogStore } from '../../stores/deploy-dialog-store';
import { useTaskStore } from '../../stores/task-store';
import { getLastDeployment } from '../../../shared/utils/task-deployments';
import { buildDeployCommand } from './deploy-command';
import type { DeployPreflight, DeployScript, Task } from '../../../shared/types';

interface TaskDeployDialogProps {
  /** Opens an agent terminal in the project root and runs the command; false if no terminal could be opened */
  onRunInTerminal: (command: string, title: string) => boolean;
  /** Navigates to the Ship → Deploy view */
  onOpenDeployView: () => void;
}

/**
 * Deploy a merged task: pick one of the project's deploy*.sh scripts, see branch /
 * uncommitted-changes warnings, confirm, then run it in an agent terminal and record it.
 * Mounted once in App; opened via useDeployDialogStore().openForTask(task).
 */
export function TaskDeployDialog({ onRunInTerminal, onOpenDeployView }: TaskDeployDialogProps) {
  const task = useDeployDialogStore((s) => s.task);
  const close = useDeployDialogStore((s) => s.close);

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
        // Preselect the script used last time, else the first one
        const last = getLastDeployment(task)?.script;
        setSelectedPath(found.find((s) => s.relativePath === last)?.relativePath ?? found[0]?.relativePath ?? null);
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
  if (preflight?.hasUncommittedChanges) {
    warnings.push(t('task.warnings.uncommitted'));
  }

  const handleDeploy = async () => {
    if (!selected) return;
    if (!onRunInTerminal(buildDeployCommand(selected, args), `${t('title')}: ${selected.name}`)) {
      setConfirming(false);
      setError(t('terminalLimit'));
      return;
    }
    const result = await window.electronAPI.recordTaskDeployment(task.projectId, task.id, {
      script: selected.relativePath,
      args
    });
    if (result.success && result.data) {
      const current = useTaskStore.getState().tasks.find((x) => x.id === task.id);
      useTaskStore.getState().updateTask(task.id, {
        metadata: { ...(current?.metadata ?? task.metadata), deployments: result.data }
      });
    }
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

/**
 * Consolidate: an agent groups the To do column's tasks that belong together;
 * the user reviews (rename, lift a task out), then each group becomes one task
 * (the originals are archived). Everything stays in To do.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Combine, Loader2, X } from 'lucide-react';

import { buildConsolidatedDescription, type TaskGroup } from '../../shared/utils/task-consolidation';
import { archiveTasks, loadTasks } from '../stores/task-store';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import type { Task } from '../../shared/types';

interface ConsolidateTasksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** The To do column's tasks */
  tasks: Task[];
  /** Called with the resulting task ids (consolidated + untouched) */
  onApplied: (taskIds: string[]) => Promise<void>;
}

type Specs = Record<string, { title: string; spec: string }>;

export function ConsolidateTasksDialog({ open, onOpenChange, projectId, tasks, onApplied }: ConsolidateTasksDialogProps) {
  const { t } = useTranslation(['tasks']);
  const [groups, setGroups] = useState<TaskGroup[] | null>(null);
  const [specs, setSpecs] = useState<Specs>({});
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setGroups(null);
    setError(null);
    void window.electronAPI
      .consolidateTasksPreview(projectId, tasks.map((task) => ({ specId: task.specId, title: task.title })))
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.data) {
          setGroups(result.data.groups);
          setSpecs(result.data.specs);
        } else {
          setError(result.error ?? 'Consolidation failed');
        }
      });
    return () => {
      cancelled = true;
    };
    // Re-run only when the dialog opens; the task list is read at that moment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  const taskBySpec = new Map(tasks.map((task) => [task.specId, task]));
  const merged = (groups ?? []).filter((g) => g.specIds.length > 1);

  const rename = (index: number, title: string) =>
    setGroups((current) => current?.map((g, i) => (i === index ? { ...g, title } : g)) ?? null);

  // Lift one task out of its group into a group of its own
  const liftOut = (index: number, specId: string) =>
    setGroups((current) => {
      if (!current) return current;
      const next = current.map((g, i) => (i === index ? { ...g, specIds: g.specIds.filter((id) => id !== specId) } : g));
      const task = taskBySpec.get(specId);
      return [...next, { title: task?.title ?? specId, summary: '', specIds: [specId], reason: '' }];
    });

  const apply = async () => {
    if (!groups) return;
    setApplying(true);
    try {
      const toQueue: string[] = [];
      const mapping: Record<string, string> = {};
      const archived: string[] = [];
      for (const group of groups) {
        if (group.specIds.length === 1) {
          const task = taskBySpec.get(group.specIds[0]);
          if (task) toQueue.push(task.id);
          continue;
        }
        const created = await window.electronAPI.createTask(
          projectId,
          group.title.trim() || group.specIds[0],
          buildConsolidatedDescription(group, new Map(Object.entries(specs))),
          // The user approved the grouping: no second approval of the plan
          { category: 'feature', sourceType: 'manual', consolidatedFrom: group.specIds, requireReviewBeforeCoding: false }
        );
        if (!created.success || !created.data) {
          setError(created.error ?? 'Could not create the consolidated task');
          continue;
        }
        toQueue.push(created.data.id);
        for (const specId of group.specIds) {
          mapping[specId] = created.data.specId;
          const task = taskBySpec.get(specId);
          if (task) archived.push(task.id);
        }
      }
      // Roadmap features follow their task, then the merged originals are archived
      if (Object.keys(mapping).length > 0) await window.electronAPI.relinkConsolidatedSpecs(projectId, mapping);
      if (archived.length > 0) await archiveTasks(projectId, archived);
      await loadTasks(projectId, { forceRefresh: true });
      await onApplied(toQueue);
      onOpenChange(false);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !applying && onOpenChange(next)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Combine className="h-5 w-5" />
            {t('consolidate.title')}
          </DialogTitle>
          <DialogDescription>{t('consolidate.description')}</DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {!groups && !error && (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('consolidate.analyzing', { count: tasks.length })}
          </div>
        )}

        {groups && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('consolidate.result', { tasks: tasks.length, groups: groups.length, merged: merged.length })}
            </p>
            {groups.map((group, index) =>
              group.specIds.length === 0 ? null : (
                <div key={`${group.specIds[0]}-${index}`} className="rounded-lg border border-border p-3">
                  {group.specIds.length > 1 ? (
                    <Input value={group.title} onChange={(e) => rename(index, e.target.value)} className="mb-1 font-medium" />
                  ) : (
                    <div className="mb-1 text-sm font-medium">{group.title}</div>
                  )}
                  {group.reason && <p className="mb-2 text-xs text-muted-foreground">{group.reason}</p>}
                  {group.specIds.length > 1 && (
                    <ul className="space-y-1">
                      {group.specIds.map((specId) => (
                        <li key={specId} className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate">{taskBySpec.get(specId)?.title ?? specId}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            title={t('consolidate.liftOut')}
                            aria-label={t('consolidate.liftOut')}
                            onClick={() => liftOut(index, specId)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            {t('consolidate.cancel')}
          </Button>
          <Button onClick={() => void apply()} disabled={!groups || applying}>
            {applying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('consolidate.apply', { count: groups?.filter((g) => g.specIds.length > 0).length ?? 0 })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

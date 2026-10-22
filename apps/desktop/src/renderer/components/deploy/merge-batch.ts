import type { Task } from '../../../shared/types';

export type MergeOneResult = { ok: true } | { ok: false; reason: string };

export interface MergeBatchOutcome {
  merged: Task[];
  failed: { task: Task; reason: string }[];
}

export interface MergeBatchOptions {
  tasks: Task[];
  mergeOne: (task: Task) => Promise<MergeOneResult>;
  /** Called before each merge; index is 1-based over all tasks tried so far */
  onStart?: (task: Task, index: number, total: number) => void;
}

/** Oldest first, so later tasks merge on top of earlier ones. */
export function oldestFirst(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

/**
 * Merge every task, oldest first. A failed merge is aborted cleanly by the main process, so
 * the run continues with the next task and reports every failure at the end.
 */
export async function runMergeBatch({ tasks, mergeOne, onStart }: MergeBatchOptions): Promise<MergeBatchOutcome> {
  const outcome: MergeBatchOutcome = { merged: [], failed: [] };
  const queue = oldestFirst(tasks);
  for (const [i, task] of queue.entries()) {
    onStart?.(task, i + 1, queue.length);
    let result: MergeOneResult;
    try {
      result = await mergeOne(task);
    } catch (err) {
      result = { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
    if (result.ok) outcome.merged.push(task);
    else outcome.failed.push({ task, reason: result.reason });
  }
  return outcome;
}

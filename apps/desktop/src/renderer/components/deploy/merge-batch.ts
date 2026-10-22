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
  /** The project's tasks waiting to merge right now; ones that arrived during the run are merged too */
  fetchPending?: () => Task[];
  /** Upper bound on extra rounds for late arrivals */
  maxPasses?: number;
}

/** Oldest first, so later tasks merge on top of earlier ones. */
export function oldestFirst(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

/**
 * Merge every task, oldest first, then any that arrived meanwhile (up to `maxPasses` rounds).
 * A failed merge is aborted cleanly by the main process, so the run continues with the next
 * task and reports every failure at the end.
 */
export async function runMergeBatch({
  tasks,
  mergeOne,
  onStart,
  fetchPending,
  maxPasses = 3
}: MergeBatchOptions): Promise<MergeBatchOutcome> {
  const outcome: MergeBatchOutcome = { merged: [], failed: [] };
  const attempted = new Set<string>();
  let queue = oldestFirst(tasks);
  for (let pass = 0; pass < maxPasses && queue.length > 0; pass++) {
    const total = attempted.size + queue.length;
    for (const task of queue) {
      attempted.add(task.id);
      onStart?.(task, attempted.size, total);
      let result: MergeOneResult;
      try {
        result = await mergeOne(task);
      } catch (err) {
        result = { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
      if (result.ok) outcome.merged.push(task);
      else outcome.failed.push({ task, reason: result.reason });
    }
    // Tasks that reached the column while this pass ran (each task is tried once)
    queue = oldestFirst((fetchPending?.() ?? []).filter((t) => !attempted.has(t.id)));
  }
  return outcome;
}

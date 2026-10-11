import type { Task, TaskDeployment } from '../types';

/** Newest deploy recorded for the task, if any. */
export function getLastDeployment(task: Pick<Task, 'metadata'>): TaskDeployment | undefined {
  const deployments = task.metadata?.deployments;
  return deployments && deployments.length > 0 ? deployments[deployments.length - 1] : undefined;
}

/** Merged (Done, not archived) tasks that were never deployed from Malvy. */
export function countUndeployedTasks(tasks: readonly Pick<Task, 'status' | 'metadata'>[]): number {
  return tasks.filter((t) => t.status === 'done' && !t.metadata?.archivedAt && !getLastDeployment(t)).length;
}

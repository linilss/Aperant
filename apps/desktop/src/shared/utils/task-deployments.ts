import type { DeployScript, ProjectSettings, Task, TaskDeployment } from '../types';

/** Newest deploy recorded for the task, if any. */
export function getLastDeployment(task: Pick<Task, 'metadata'>): TaskDeployment | undefined {
  const deployments = task.metadata?.deployments;
  return deployments && deployments.length > 0 ? deployments[deployments.length - 1] : undefined;
}

/** Merged (Done, not archived) tasks that were never deployed from Malvy. */
export function countUndeployedTasks(tasks: readonly Pick<Task, 'status' | 'metadata'>[]): number {
  return tasks.filter((t) => t.status === 'done' && !t.metadata?.archivedAt && !getLastDeployment(t)).length;
}

/**
 * The script one-click Deploy runs for a project: the configured deployScript when it
 * still exists, else the only deploy script when there is exactly one. Null = ask.
 */
export function resolveProjectDeployScript(
  scripts: readonly DeployScript[],
  settings: Pick<ProjectSettings, 'deployScript'> | undefined
): DeployScript | null {
  const configured = settings?.deployScript;
  if (configured) return scripts.find((s) => s.relativePath === configured) ?? null;
  return scripts.length === 1 ? scripts[0] : null;
}

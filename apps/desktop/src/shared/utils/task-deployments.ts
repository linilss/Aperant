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

/**
 * What a deploy shipped, for badges: "1.0.5 (202610131402)" for an App Store build,
 * "1.0.5" or a web version otherwise; null when the log gave no version.
 */
export function formatDeployedVersion(deployment: Pick<TaskDeployment, 'version' | 'build'> | undefined): string | null {
  if (!deployment?.version && !deployment?.build) return null;
  if (deployment.version && deployment.build) return `${deployment.version} (${deployment.build})`;
  return deployment.version ?? deployment.build ?? null;
}

/** App Store / TestFlight deploy (has a build number or a TestFlight result line) */
export function isAppStoreDeployment(deployment: Pick<TaskDeployment, 'build' | 'summary' | 'script'>): boolean {
  return !!deployment.build || /testflight/i.test(deployment.summary ?? '') || /ios|apple|testflight/i.test(deployment.script);
}

/** Merged by Malvy and not covered by a verified deploy that started after the merge */
export function isTaskNotLive(task: Pick<Task, 'status' | 'metadata'>): boolean {
  const mergedAt = task.metadata?.mergedAt;
  if (task.status !== 'done' || !mergedAt || task.metadata?.archivedAt) return false;
  return !(task.metadata?.deployments ?? []).some((d) => d.status === 'succeeded' && d.at >= mergedAt);
}

/** The project's Kanban Deploy button only merges (no deploy) */
export function isMergeOnly(settings: Pick<ProjectSettings, 'kanbanDeployAction'> | undefined): boolean {
  return settings?.kanbanDeployAction === 'merge';
}

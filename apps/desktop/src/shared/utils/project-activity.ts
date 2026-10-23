import type { ProjectActivity, Task } from '../types';

/** Running / needs-you counts from a project's tasks (archived ones ignored) */
export function computeProjectActivity(
  tasks: Pick<Task, 'status' | 'metadata'>[],
  busy: { deploying?: boolean; merging?: number } = {}
): ProjectActivity {
  const live = tasks.filter((t) => !t.metadata?.archivedAt);
  const running = live.filter((t) => t.status === 'in_progress' || t.status === 'ai_review').length;
  const needsYou = live.filter((t) => t.status === 'human_review' || t.status === 'error' || t.status === 'pending_merge').length;
  return { running, needsYou, merging: busy.merging ?? 0, deploying: !!busy.deploying };
}

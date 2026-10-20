/**
 * Safe restart: tasks stopped by a safe stop just before Malvy restarted carry a
 * RESUME_AFTER_RESTART marker in their spec dir; after startup Malvy starts them
 * again (they continue with the next subtask). Leftover SAFE_STOP markers are
 * cleared at startup so no task stops by accident on its next run.
 */

import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import { SAFE_STOP_FILE } from './ai/orchestration/pause-handler';

export const RESUME_AFTER_RESTART_FILE = 'RESUME_AFTER_RESTART';

export interface ResumeCandidate {
  projectId: string;
  specId: string;
}

const remove = (file: string) => {
  try {
    if (existsSync(file)) unlinkSync(file);
  } catch {
    // best effort
  }
};

function specDirs(specsDir: string): string[] {
  try {
    return readdirSync(specsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(specsDir, d.name));
  } catch {
    return [];
  }
}

/**
 * Stopped by a safe stop, not finished or failed: Human Review with reason
 * "stopped", or back in Planning when it stopped before having subtasks.
 */
export function wasSafeStopped(specDir: string): boolean {
  try {
    const plan = JSON.parse(readFileSync(path.join(specDir, 'implementation_plan.json'), 'utf-8')) as Record<string, unknown>;
    if (plan.status === 'human_review') return plan.reviewReason === 'stopped';
    return plan.status === 'backlog' && !plan.reviewReason;
  } catch {
    return false;
  }
}

/**
 * Clear stale markers and return the tasks to resume. `projects` gives each
 * project's id, path and specs dir (relative); worktrees live under
 * `.malvy/worktrees/tasks/<specId>/<specsDir>/<specId>`.
 */
export function collectResumeCandidates(projects: Array<{ id: string; path: string; specsDir: string }>): ResumeCandidate[] {
  const resume: ResumeCandidate[] = [];
  for (const project of projects) {
    for (const dir of specDirs(path.join(project.path, project.specsDir))) {
      const specId = path.basename(dir);
      remove(path.join(dir, SAFE_STOP_FILE));
      remove(path.join(project.path, '.malvy', 'worktrees', 'tasks', specId, project.specsDir, specId, SAFE_STOP_FILE));
      const marker = path.join(dir, RESUME_AFTER_RESTART_FILE);
      if (!existsSync(marker)) continue;
      remove(marker);
      if (wasSafeStopped(dir)) resume.push({ projectId: project.id, specId });
    }
  }
  return resume;
}

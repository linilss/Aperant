/**
 * Cheap, non-blocking read of every task's status in a project: just the spec
 * dirs' implementation_plan.json status and task_metadata.json archivedAt.
 * projectStore.getTasks() rebuilds full Task objects synchronously (subtasks,
 * worktree copies, …) and blocks the main process with hundreds of specs, so
 * the queue and the activity badges poll with this instead.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { getSpecsDir } from '../shared/constants';
import type { Project, TaskStatus } from '../shared/types';

export interface TaskStatusEntry {
  id: string;
  status: TaskStatus;
  createdAt: string;
  archived: boolean;
}

// Same mapping as ProjectStore.determineTaskStatusAndReason
const STATUS_MAP: Record<string, TaskStatus> = {
  pending: 'backlog',
  planning: 'in_progress',
  in_progress: 'in_progress',
  coding: 'in_progress',
  review: 'ai_review',
  completed: 'done',
  done: 'done',
  human_review: 'human_review',
  ai_review: 'ai_review',
  pr_created: 'pr_created',
  pending_merge: 'pending_merge',
  backlog: 'backlog',
  error: 'error',
  queue: 'queue',
  queued: 'queue'
};

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(file, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function scanTaskStatuses(project: Pick<Project, 'path' | 'autoBuildPath'>): Promise<TaskStatusEntry[]> {
  const specsDir = path.join(project.path, getSpecsDir(project.autoBuildPath));
  let dirs: string[];
  try {
    dirs = (await readdir(specsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  return Promise.all(
    dirs.map(async (id) => {
      const [plan, meta] = await Promise.all([
        readJson(path.join(specsDir, id, 'implementation_plan.json')),
        readJson(path.join(specsDir, id, 'task_metadata.json'))
      ]);
      const raw = typeof plan?.status === 'string' ? plan.status : '';
      return {
        id,
        status: STATUS_MAP[raw] ?? 'backlog',
        createdAt: typeof plan?.created_at === 'string' ? plan.created_at : '',
        archived: !!meta?.archivedAt
      };
    })
  );
}

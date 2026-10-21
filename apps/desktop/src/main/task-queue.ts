/**
 * Task queue in the main process: promotes Queue → In Progress for every
 * project (not only the one on screen), FIFO, up to the project's parallel
 * limit. A task paused on a usage limit doesn't hold a slot, but any such pause
 * holds promotion in that project (new tasks would hit the same limit).
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

import { getSpecsDir } from '../shared/constants';
import type { Task } from '../shared/types';
import { RATE_LIMIT_PAUSE_FILE } from './ai/orchestration/pause-handler';
import { taskStatusUpdater } from './ipc-handlers/task/execution-handlers';
import { projectStore } from './project-store';

export const DEFAULT_MAX_PARALLEL_TASKS = 2;
const TICK_MS = 20_000;

/** Tasks to promote now, oldest first */
export function pickTasksToPromote(tasks: Task[], maxParallel: number, isPaused: (task: Task) => boolean): Task[] {
  const live = tasks.filter((t) => !t.metadata?.archivedAt);
  if (live.some(isPaused)) return [];
  const running = live.filter((t) => t.status === 'in_progress').length;
  const free = Math.max(0, maxParallel - running);
  return live
    .filter((t) => t.status === 'queue')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(0, free);
}

/** While this file exists in userData, the queue starts nothing (manual pause) */
export const QUEUE_PAUSE_FILE = 'QUEUE_PAUSED';
const queuePaused = (): boolean => existsSync(path.join(app.getPath('userData'), QUEUE_PAUSE_FILE));

let busy = false;
let timer: NodeJS.Timeout | null = null;

/** One pass over all projects (or just `projectId`) */
export async function processTaskQueues(projectId?: string): Promise<void> {
  if (busy || !taskStatusUpdater || queuePaused()) return;
  busy = true;
  try {
    for (const project of projectStore.getProjects()) {
      if (projectId && project.id !== projectId) continue;
      if (project.settings?.overviewOnly) continue;
      projectStore.invalidateTasksCache(project.id);
      const specsDir = path.join(project.path, getSpecsDir(project.autoBuildPath));
      const isPaused = (t: Task) => t.status === 'in_progress' && existsSync(path.join(specsDir, t.specId, RATE_LIMIT_PAUSE_FILE));
      const max = project.settings?.maxParallelTasks ?? DEFAULT_MAX_PARALLEL_TASKS;
      for (const task of pickTasksToPromote(projectStore.getTasks(project.id), max, isPaused)) {
        const result = await taskStatusUpdater(task.id, 'in_progress');
        if (!result.success) console.warn(`[TaskQueue] Could not start ${task.id}: ${result.error ?? 'unknown error'}`);
      }
    }
  } catch (error) {
    console.warn('[TaskQueue] Queue pass failed:', error);
  } finally {
    busy = false;
  }
}

/** Run the queue regularly and shortly after a task leaves a slot */
export function startTaskQueue(onTaskExit: (listener: () => void) => void): void {
  if (timer) return;
  timer = setInterval(() => void processTaskQueues(), TICK_MS);
  onTaskExit(() => setTimeout(() => void processTaskQueues(), 3_000));
}

import { readFileSync } from 'fs';
import path from 'path';
import type { TaskDeployment, TaskMetadata } from '../shared/types';
import { writeFileAtomicSync } from './utils/atomic-file';
import { resolveDeployment } from './deploy-log';

/**
 * Resolve running deployments from their logs and save any that finished, in every spec
 * location. Returns the (possibly updated) deployments of the first location.
 */
export function resolveTaskDeployments(projectPath: string, specPaths: string[]): TaskDeployment[] {
  let result: TaskDeployment[] | null = null;
  for (const specPath of specPaths) {
    const metadataPath = path.join(specPath, 'task_metadata.json');
    let metadata: TaskMetadata;
    try {
      metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
    } catch {
      continue;
    }
    const before = Array.isArray(metadata.deployments) ? metadata.deployments : [];
    const after = before.map((d) => resolveDeployment(projectPath, d));
    if (after.some((d, i) => d !== before[i])) {
      writeFileAtomicSync(metadataPath, JSON.stringify({ ...metadata, deployments: after }, null, 2));
    }
    result ??= after;
  }
  return result ?? [];
}

/**
 * Appends a user-confirmed deploy to `task_metadata.json` in every location of the spec
 * (main project + worktree copies, like archiving). Returns the deployments list of the
 * first location, or null when there is no spec directory.
 */
export function appendTaskDeployment(specPaths: string[], entry: TaskDeployment): TaskDeployment[] | null {
  let result: TaskDeployment[] | null = null;

  for (const specPath of specPaths) {
    const metadataPath = path.join(specPath, 'task_metadata.json');
    let metadata: TaskMetadata = {};
    try {
      metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const deployments = [...(Array.isArray(metadata.deployments) ? metadata.deployments : []), entry];
    writeFileAtomicSync(metadataPath, JSON.stringify({ ...metadata, deployments }, null, 2));
    result ??= deployments;
  }

  return result;
}

/** Patch the deployment entry of a deploy run (by deployId) in every spec location. */
export function updateTaskDeployment(specPaths: string[], deployId: string, patch: Partial<TaskDeployment>): void {
  for (const specPath of specPaths) {
    const metadataPath = path.join(specPath, 'task_metadata.json');
    let metadata: TaskMetadata;
    try {
      metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
    } catch {
      continue;
    }
    if (!Array.isArray(metadata.deployments) || !metadata.deployments.some((d) => d.deployId === deployId)) continue;
    const deployments = metadata.deployments.map((d) => (d.deployId === deployId ? { ...d, ...patch } : d));
    writeFileAtomicSync(metadataPath, JSON.stringify({ ...metadata, deployments }, null, 2));
  }
}

/** Record that Malvy merged the task into the main branch (it is Not live until a verified deploy). */
export function markTaskMerged(specPaths: string[], at = new Date().toISOString()): void {
  for (const specPath of specPaths) {
    const metadataPath = path.join(specPath, 'task_metadata.json');
    let metadata: TaskMetadata = {};
    try {
      metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') continue;
    }
    writeFileAtomicSync(metadataPath, JSON.stringify({ ...metadata, mergedAt: at }, null, 2));
  }
}

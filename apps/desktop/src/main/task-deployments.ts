import { readFileSync } from 'fs';
import path from 'path';
import type { TaskDeployment, TaskMetadata } from '../shared/types';
import { writeFileAtomicSync } from './utils/atomic-file';

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

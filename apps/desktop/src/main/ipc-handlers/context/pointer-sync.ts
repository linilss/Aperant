/**
 * Developer pointers: user_taught memories anchored to a doc file + heading.
 *
 * Every change is mirrored to `<project>/.malvy/pointers.md` (read by the agent
 * worker) and `CLAUDE.local.md` is kept importing it (read by Claude CLI).
 */

import type { DocPointer } from '../../../shared/types';
import type { Memory } from '../../ai/memory/types';
import { writePointersFile } from '../../claude-docs';
import { ensureClaudeLocalImports } from '../../claude-local';
import { projectStore } from '../../project-store';
import { getMemoryService } from './memory-service-factory';

export const POINTER_TAG = 'pointer';
export const APPLIED_TAG = 'applied';
const APPLIED_IN_PREFIX = 'applied:';

export function toDocPointer(m: Memory): DocPointer {
  const appliedTag = m.tags.find((tag) => tag.startsWith(APPLIED_IN_PREFIX));
  return {
    id: m.id,
    content: m.content,
    docPath: m.relatedFiles[0] || undefined,
    heading: m.citationText || undefined,
    createdAt: m.createdAt,
    appliedIn: appliedTag ? appliedTag.slice(APPLIED_IN_PREFIX.length) : undefined,
  };
}

/** List all active pointers for a project, oldest first */
export async function listPointers(projectId: string): Promise<DocPointer[]> {
  const service = await getMemoryService();
  const memories = await service.search({
    projectId,
    sources: ['user_taught'],
    excludeDeprecated: true,
    limit: 1000,
  });
  return memories
    .map(toDocPointer)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Regenerate `.malvy/pointers.md` for a project and make sure CLAUDE.local.md
 * imports it. Returns the current pointer list.
 */
export async function syncPointers(projectId: string): Promise<DocPointer[]> {
  const pointers = await listPointers(projectId);
  const project = projectStore.getProject(projectId);
  if (project) {
    writePointersFile(project.path, pointers);
    ensureClaudeLocalImports(project.path);
  }
  return pointers;
}

/** Tag pointers as baked into a Malvy doc file (relative to .malvy/docs) */
export async function markPointersApplied(pointerIds: string[], docPath: string): Promise<void> {
  if (pointerIds.length === 0) return;
  const service = await getMemoryService();
  for (const id of pointerIds) {
    const memory = await service.getMemory(id);
    if (!memory) continue;
    const tags = memory.tags.filter((tag) => tag !== APPLIED_TAG && !tag.startsWith(APPLIED_IN_PREFIX));
    tags.push(APPLIED_TAG, `${APPLIED_IN_PREFIX}${docPath}`);
    await service.updateMemory(id, { tags });
  }
}

/**
 * Consolidate & enqueue: preview groups of Planning tasks (AI, read-only), and
 * re-point roadmap features at the task their spec was merged into. Creating,
 * archiving and queueing reuse the existing task IPC from the renderer.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ipcMain } from 'electron';

import { AUTO_BUILD_PATHS, IPC_CHANNELS, getSpecsDir } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { readFileWithRetry, writeFileWithRetry } from '../../utils/atomic-file';
import { withFileLock } from '../../utils/file-lock';
import { resolveClaudeCliFeatureModel } from '../feature-settings-helper';
import { runTaskConsolidation, type TaskGroup } from '../../ai/runners/task-consolidate';

export interface ConsolidatePreview {
  groups: TaskGroup[];
  /** Spec text per task, for the merged descriptions */
  specs: Record<string, { title: string; spec: string }>;
}

export function registerConsolidateHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.TASK_CONSOLIDATE_PREVIEW,
    async (_, projectId: string, tasks: Array<{ specId: string; title: string }>): Promise<IPCResult<ConsolidatePreview>> => {
      const project = projectStore.getProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      const specsDir = path.join(project.path, getSpecsDir(project.autoBuildPath));
      const specs: ConsolidatePreview['specs'] = {};
      for (const t of tasks ?? []) {
        const file = path.join(specsDir, t.specId, AUTO_BUILD_PATHS.SPEC_FILE);
        specs[t.specId] = { title: t.title, spec: existsSync(file) ? readFileSync(file, 'utf-8') : '' };
      }
      try {
        const groups = await runTaskConsolidation({
          projectDir: project.path,
          tasks: Object.entries(specs).map(([specId, s]) => ({ specId, title: s.title, spec: s.spec })),
          modelId: resolveClaudeCliFeatureModel('roadmap'),
        });
        return { success: true, data: { groups, specs } };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Consolidation failed' };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.TASK_CONSOLIDATE_RELINK,
    async (_, projectId: string, mapping: Record<string, string>): Promise<IPCResult> => {
      const project = projectStore.getProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      const roadmapPath = path.join(project.path, AUTO_BUILD_PATHS.ROADMAP_DIR, AUTO_BUILD_PATHS.ROADMAP_FILE);
      if (!existsSync(roadmapPath)) return { success: true };
      try {
        await withFileLock(roadmapPath, async () => {
          const roadmap = JSON.parse((await readFileWithRetry(roadmapPath, { encoding: 'utf-8' })) as string);
          let changed = false;
          for (const f of roadmap.features ?? []) {
            const to = typeof f.linked_spec_id === 'string' ? mapping[f.linked_spec_id] : undefined;
            if (to) {
              f.linked_spec_id = to;
              changed = true;
            }
          }
          if (changed) await writeFileWithRetry(roadmapPath, JSON.stringify(roadmap, null, 2), { encoding: 'utf-8' });
        });
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Relink failed' };
      }
    }
  );
}

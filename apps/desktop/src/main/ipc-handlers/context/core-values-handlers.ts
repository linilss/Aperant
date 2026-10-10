import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { CoreValues, IPCResult, SaveCoreValuesResult } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { readCoreValues, saveCoreValues } from '../../core-values-store';
import { runCoreValuesDraft } from '../../ai/runners/core-values-draft';
import { resolveClaudeCliFeatureModel } from '../feature-settings-helper';

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/** Core values: `.malvy/core-values.md` get / save / AI draft */
export function registerCoreValuesHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_CORE_VALUES_GET,
    async (_, projectId: string): Promise<IPCResult<CoreValues>> => {
      const project = projectStore.getProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      return { success: true, data: readCoreValues(project.path) };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_CORE_VALUES_SAVE,
    async (_, projectId: string, text: unknown): Promise<IPCResult<SaveCoreValuesResult>> => {
      const project = projectStore.getProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      if (typeof text !== 'string') return { success: false, error: 'Invalid core values' };
      try {
        return { success: true, data: saveCoreValues(project.path, text) };
      } catch (error) {
        return { success: false, error: errorMessage(error, 'Failed to save core values') };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_CORE_VALUES_DRAFT,
    async (_, projectId: string): Promise<IPCResult<string>> => {
      const project = projectStore.getProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      try {
        const draft = await runCoreValuesDraft({
          projectDir: project.path,
          modelId: resolveClaudeCliFeatureModel('insights'),
        });
        return { success: true, data: draft };
      } catch (error) {
        return { success: false, error: errorMessage(error, 'Failed to draft core values') };
      }
    }
  );
}

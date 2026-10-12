import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type {
  DesignPublishPlan,
  DesignSystemConfig,
  DesignSystemOperation,
  DesignSystemRunResult,
  DesignSystemState,
  IPCResult,
} from '../../../shared/types';
import { projectStore } from '../../project-store';
import {
  computePublishPlan,
  detectDesignSystem,
  hasDesignSnapshot,
  loadDesignData,
  readDesignConfig,
  readDesignFile,
  recordPublished,
  saveDesignOverrides,
  writeSnapshotFromSaved,
} from '../../design-system';
import { runDesignPublish, runDesignSync } from '../../ai/runners/design-system';
import { resolveClaudeCliFeatureModel } from '../feature-settings-helper';
import { safeSendToRenderer } from '../utils';

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/** Sync/publish currently running, per project */
const running = new Map<string, DesignSystemOperation>();

function buildState(projectId: string, projectDir: string): DesignSystemState {
  const config = readDesignConfig(projectDir);
  const detection = detectDesignSystem(projectDir, config);
  return {
    detection,
    config,
    data: loadDesignData(projectDir, detection),
    hasSnapshot: hasDesignSnapshot(projectDir),
    running: running.get(projectId) ?? null,
  };
}

/** Context → Design: detection, overrides, file reads, sync from artifact, gated publish */
export function registerDesignSystemHandlers(getMainWindow: () => BrowserWindow | null): void {
  const progress = (projectId: string, text: string) =>
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.CONTEXT_DESIGN_PROGRESS, projectId, text);

  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_DESIGN_GET,
    async (_, projectId: string): Promise<IPCResult<DesignSystemState>> => {
      const project = projectStore.getProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      try {
        return { success: true, data: buildState(projectId, project.path) };
      } catch (error) {
        return { success: false, error: errorMessage(error, 'Failed to load the design system') };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_DESIGN_SAVE_OVERRIDES,
    async (_, projectId: string, input: unknown): Promise<IPCResult<DesignSystemState>> => {
      const project = projectStore.getProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      if (!input || typeof input !== 'object') return { success: false, error: 'Invalid input' };
      const { artifactUrl, sourceDir } = input as Partial<Record<keyof DesignSystemConfig, unknown>>;
      try {
        saveDesignOverrides(project.path, {
          ...(typeof artifactUrl === 'string' ? { artifactUrl } : {}),
          ...(typeof sourceDir === 'string' ? { sourceDir } : {}),
        });
        return { success: true, data: buildState(projectId, project.path) };
      } catch (error) {
        return { success: false, error: errorMessage(error, 'Failed to save') };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_DESIGN_READ_FILE,
    async (_, projectId: string, relPath: unknown): Promise<IPCResult<string>> => {
      const project = projectStore.getProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      if (typeof relPath !== 'string') return { success: false, error: 'Invalid path' };
      try {
        const detection = detectDesignSystem(project.path);
        return { success: true, data: readDesignFile(project.path, detection, relPath) };
      } catch (error) {
        return { success: false, error: errorMessage(error, 'Failed to read file') };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_DESIGN_PUBLISH_PLAN,
    async (_, projectId: string): Promise<IPCResult<DesignPublishPlan | null>> => {
      const project = projectStore.getProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      try {
        return { success: true, data: computePublishPlan(project.path, detectDesignSystem(project.path)) };
      } catch (error) {
        return { success: false, error: errorMessage(error, 'Failed to compare files') };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_DESIGN_SYNC,
    async (_, projectId: string): Promise<IPCResult<DesignSystemRunResult>> => {
      const project = projectStore.getProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      if (running.has(projectId)) return { success: false, error: 'Already running' };
      const detection = detectDesignSystem(project.path);
      if (!detection.artifactUrl) return { success: false, error: 'No artifact link' };
      running.set(projectId, 'sync');
      try {
        const { saved } = await runDesignSync({
          projectDir: project.path,
          modelId: resolveClaudeCliFeatureModel('insights'),
          artifactUrl: detection.artifactUrl,
          onProgress: (text) => progress(projectId, text),
        });
        const files = writeSnapshotFromSaved(project.path, saved, { version: saved.find((s) => s.version)?.version });
        return { success: true, data: { operation: 'sync', files, at: new Date().toISOString() } };
      } catch (error) {
        return { success: false, error: errorMessage(error, 'Sync failed') };
      } finally {
        running.delete(projectId);
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_DESIGN_PUBLISH,
    async (_, projectId: string, confirmedPaths: unknown): Promise<IPCResult<DesignSystemRunResult>> => {
      const project = projectStore.getProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      if (!Array.isArray(confirmedPaths)) return { success: false, error: 'Nothing confirmed' };
      if (running.has(projectId)) return { success: false, error: 'Already running' };
      const plan = computePublishPlan(project.path, detectDesignSystem(project.path));
      if (!plan) return { success: false, error: 'No source folder or artifact link' };
      // Only publish what the user saw and confirmed (and that is still changed)
      const files = plan.files.filter((f) => confirmedPaths.includes(f.path));
      if (files.length === 0) return { success: false, error: 'No changed files to publish' };
      running.set(projectId, 'publish');
      try {
        const result = await runDesignPublish({
          projectDir: project.path,
          modelId: resolveClaudeCliFeatureModel('insights'),
          plan: { ...plan, files },
          onProgress: (text) => progress(projectId, text),
        });
        if (!result.published) {
          const reason = /FAILED:\s*(.+)/.exec(result.text)?.[1]?.trim();
          return { success: false, error: reason || 'The artifact was not published' };
        }
        const config = recordPublished(project.path, files);
        return {
          success: true,
          data: { operation: 'publish', files: files.map((f) => f.path), at: config.publishedAt ?? new Date().toISOString() },
        };
      } catch (error) {
        return { success: false, error: errorMessage(error, 'Publish failed') };
      } finally {
        running.delete(projectId);
      }
    }
  );
}

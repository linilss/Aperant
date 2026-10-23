import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { FunnelProgress, IPCResult, ProjectActivity } from '../../shared/types';
import { getActiveDeploy } from '../deploy-manager';
import { computeProjectActivity } from '../../shared/utils/project-activity';
import { scanTaskStatuses } from '../task-status-scan';
import { getFunnelProgress } from '../funnel-progress';
import { projectStore } from '../project-store';
import { safeSendToRenderer } from './utils';

let getWindow: (() => BrowserWindow | null) | null = null;

/**
 * Tell the renderer that a funnel step's output for this project may have changed
 * (core values saved, docs applied, ranking saved, roadmap/ideation generated …),
 * so the tab progress and sidebar checks refresh without waiting for the poll.
 */
export function notifyFunnelChanged(projectId: string): void {
  if (getWindow) safeSendToRenderer(getWindow, IPC_CHANNELS.PROJECT_FUNNEL_CHANGED, projectId);
}

/** Plan-funnel progress (project tab bars, sidebar checks) */
export function registerFunnelHandlers(getMainWindow: () => BrowserWindow | null): void {
  getWindow = getMainWindow;

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_FUNNEL_PROGRESS,
    async (_, projectIds: unknown): Promise<IPCResult<Record<string, FunnelProgress>>> => {
      if (!Array.isArray(projectIds)) return { success: false, error: 'Invalid project ids' };
      const data: Record<string, FunnelProgress> = {};
      for (const id of projectIds) {
        if (typeof id !== 'string') continue;
        const project = projectStore.getProject(id);
        if (project) data[id] = getFunnelProgress(project.path);
      }
      return { success: true, data };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_ACTIVITY,
    async (_, projectIds: unknown): Promise<IPCResult<Record<string, ProjectActivity>>> => {
      if (!Array.isArray(projectIds)) return { success: false, error: 'Invalid project ids' };
      const data: Record<string, ProjectActivity> = {};
      for (const id of projectIds) {
        const project = typeof id === 'string' ? projectStore.getProject(id) : undefined;
        if (!project) continue;
        // Async status scan, not getTasks(): this polls every few seconds for every open project
        const statuses = await scanTaskStatuses(project);
        const tasks = statuses.map((s) => ({ status: s.status, metadata: s.archived ? { archivedAt: 'archived' } : {} }));
        data[id] = computeProjectActivity(tasks as Parameters<typeof computeProjectActivity>[0], !!getActiveDeploy(id));
      }
      return { success: true, data };
    }
  );
}

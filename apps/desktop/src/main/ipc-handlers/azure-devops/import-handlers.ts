/**
 * Azure DevOps import handlers
 * Handles bulk importing work items as tasks
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { getAzureDevOpsConfig, adoFetch } from './utils';
import type { ADOAPIWorkItem } from './types';
import { createSpecForWorkItem, type ADOTaskInfo } from './spec-utils';

// Debug logging helper
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.debug(`[ADO Import] ${message}`, data);
    } else {
      console.debug(`[ADO Import] ${message}`);
    }
  }
}

export interface ADOImportResult {
  success: boolean;
  imported: number;
  failed: number;
  errors?: string[];
}

/**
 * Import multiple Azure DevOps work items as tasks
 */
export function registerImportWorkItems(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_IMPORT_WORK_ITEMS,
    async (
      _event,
      projectId: string,
      workItemIds: number[]
    ): Promise<IPCResult<ADOImportResult>> => {
      debugLog('importWorkItems handler called', { projectId, workItemIds });

      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = await getAzureDevOpsConfig(project);
      if (!config) {
        return { success: false, error: 'Azure DevOps not configured' };
      }

      const tasks: ADOTaskInfo[] = [];
      const errors: string[] = [];
      let imported = 0;
      let failed = 0;

      for (const workItemId of workItemIds) {
        try {
          // Fetch the full work item details
          const apiItem = await adoFetch(
            config,
            `/wit/workitems/${workItemId}?$expand=all`
          ) as ADOAPIWorkItem;

          // Create a spec/task from the work item
          const task = await createSpecForWorkItem(
            project,
            apiItem,
            config,
            project.settings?.mainBranch
          );

          if (task) {
            tasks.push(task);
            imported++;
            debugLog('Imported work item:', { workItemId, taskId: task.id });
          } else {
            failed++;
            errors.push(`Failed to create task for work item #${workItemId}`);
          }
        } catch (error) {
          failed++;
          const errorMessage =
            error instanceof Error
              ? error.message
              : `Unknown error for work item #${workItemId}`;
          errors.push(errorMessage);
          debugLog('Failed to import work item:', { workItemId, error: errorMessage });
        }
      }

      // Note: IPCResult.success indicates transport success (IPC call completed without system error).
      // data.success indicates operation success (at least one work item was imported).
      return {
        success: true,
        data: {
          success: imported > 0,
          imported,
          failed,
          errors: errors.length > 0 ? errors : undefined
        }
      };
    }
  );
}

/**
 * Register all import handlers
 */
export function registerImportHandlers(): void {
  debugLog('Registering Azure DevOps import handlers');
  registerImportWorkItems();
  debugLog('Azure DevOps import handlers registered');
}

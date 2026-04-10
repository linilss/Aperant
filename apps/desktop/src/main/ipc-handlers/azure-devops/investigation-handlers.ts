/**
 * Azure DevOps investigation handlers
 * Handles AI-powered work item investigation and task creation
 */

import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import { projectStore } from '../../project-store';
import { getAzureDevOpsConfig, adoFetch } from './utils';
import type {
  ADOAPIWorkItem,
  ADOAPIWorkItemComment,
  ADOAPIWorkItemCommentsResponse
} from './types';
import { createSpecForWorkItem } from './spec-utils';
import type { AgentManager } from '../../agent';

// Debug logging helper
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.debug(`[ADO Investigation] ${message}`, data);
    } else {
      console.debug(`[ADO Investigation] ${message}`);
    }
  }
}

// ============================================================
// Progress event types
// ============================================================

export interface ADOInvestigationStatus {
  phase: 'idle' | 'fetching' | 'analyzing' | 'creating_task' | 'complete' | 'error';
  workItemId?: number;
  progress: number;
  message: string;
  error?: string;
}

export interface ADOInvestigationResult {
  success: boolean;
  workItemId: number;
  analysis: {
    summary: string;
    proposedSolution: string;
    affectedFiles: string[];
    estimatedComplexity: 'simple' | 'standard' | 'complex';
    acceptanceCriteria: string[];
  };
  taskId?: string;
  error?: string;
}

// ============================================================
// Renderer send helpers
// ============================================================

function sendProgress(
  getMainWindow: () => BrowserWindow | null,
  projectId: string,
  status: ADOInvestigationStatus
): void {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.send(
      IPC_CHANNELS.AZURE_DEVOPS_INVESTIGATION_PROGRESS,
      projectId,
      status
    );
  }
}

function sendComplete(
  getMainWindow: () => BrowserWindow | null,
  projectId: string,
  result: ADOInvestigationResult
): void {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.send(
      IPC_CHANNELS.AZURE_DEVOPS_INVESTIGATION_COMPLETE,
      projectId,
      result
    );
  }
}

function sendError(
  getMainWindow: () => BrowserWindow | null,
  projectId: string,
  error: string
): void {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.send(
      IPC_CHANNELS.AZURE_DEVOPS_INVESTIGATION_ERROR,
      projectId,
      error
    );
  }
}

// ============================================================
// Handler registration
// ============================================================

/**
 * Register investigation handler for Azure DevOps work items.
 * Uses ipcMain.on (not .handle) to fire-and-forget, sending progress via webContents.send.
 */
export function registerInvestigateWorkItem(
  _agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.on(
    IPC_CHANNELS.AZURE_DEVOPS_INVESTIGATE_WORK_ITEM,
    async (
      _event,
      projectId: string,
      workItemId: number,
      selectedCommentIds?: number[]
    ) => {
      debugLog('investigateWorkItem handler called', {
        projectId,
        workItemId,
        selectedCommentIds
      });

      const project = projectStore.getProject(projectId);
      if (!project) {
        sendError(getMainWindow, projectId, 'Project not found');
        return;
      }

      const config = await getAzureDevOpsConfig(project);
      if (!config) {
        sendError(getMainWindow, projectId, 'Azure DevOps not configured');
        return;
      }

      try {
        // Phase 1: Fetching work item
        sendProgress(getMainWindow, project.id, {
          phase: 'fetching',
          workItemId,
          progress: 10,
          message: 'Fetching work item details...'
        });

        const workItem = await adoFetch(
          config,
          `/wit/workitems/${workItemId}?$expand=all`
        ) as ADOAPIWorkItem;

        // Fetch comments if any selected
        let filteredComments: ADOAPIWorkItemComment[] = [];
        if (selectedCommentIds && selectedCommentIds.length > 0) {
          try {
            const commentsResponse = await adoFetch(
              config,
              `/wit/workitems/${workItemId}/comments`
            ) as ADOAPIWorkItemCommentsResponse;

            const allComments = Array.isArray(commentsResponse?.value)
              ? commentsResponse.value
              : [];

            // Filter to only the selected comments
            filteredComments = allComments.filter(c =>
              selectedCommentIds.includes(c.id)
            );
          } catch (commentError) {
            // Non-fatal: proceed without comments
            debugLog('Failed to fetch comments, proceeding without them:', commentError);
          }
        }

        // Phase 2: Creating task
        sendProgress(getMainWindow, project.id, {
          phase: 'creating_task',
          workItemId,
          progress: 50,
          message: 'Creating task from work item...'
        });

        const task = await createSpecForWorkItem(
          project,
          workItem,
          config,
          project.settings?.mainBranch,
          filteredComments.length > 0 ? filteredComments : undefined
        );

        if (!task) {
          sendError(getMainWindow, project.id, 'Failed to create task from work item');
          return;
        }

        // Phase 3: Complete
        sendProgress(getMainWindow, project.id, {
          phase: 'complete',
          workItemId,
          progress: 100,
          message: 'Investigation complete'
        });

        const title = workItem.fields['System.Title'] ?? `Work Item #${workItemId}`;
        const description =
          workItem.fields['System.Description'] ??
          'See task details for more information.';

        const result: ADOInvestigationResult = {
          success: true,
          workItemId,
          analysis: {
            summary: `Investigation of Azure DevOps work item #${workItemId}: ${title}`,
            proposedSolution: description,
            affectedFiles: [],
            estimatedComplexity: 'standard',
            acceptanceCriteria: []
          },
          taskId: task.id
        };

        sendComplete(getMainWindow, project.id, result);
        debugLog('Investigation complete:', { workItemId, taskId: task.id });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Investigation failed';
        debugLog('Investigation failed:', errorMessage);
        sendError(getMainWindow, project.id, errorMessage);
      }
    }
  );
}

/**
 * Register all investigation handlers
 */
export function registerInvestigationHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  debugLog('Registering Azure DevOps investigation handlers');
  registerInvestigateWorkItem(agentManager, getMainWindow);
  debugLog('Azure DevOps investigation handlers registered');
}

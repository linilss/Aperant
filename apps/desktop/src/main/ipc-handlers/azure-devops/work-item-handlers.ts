/**
 * Azure DevOps work item handlers
 * Handles fetching work items and comments
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { getAzureDevOpsConfig, adoFetch } from './utils';
import type {
  ADOAPIWorkItem,
  ADOAPIWiqlResult,
  ADOAPIWorkItemCommentsResponse,
  AzureDevOpsWorkItem,
  AzureDevOpsWorkItemComment
} from './types';

// Debug logging helper — enabled in development OR when DEBUG flag is set
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.debug(`[ADO Work Items] ${message}`, data);
    } else {
      console.debug(`[ADO Work Items] ${message}`);
    }
  }
}

// Mapping from renderer-friendly state filter to ADO state names
const STATE_FILTER_MAP: Record<string, string[] | null> = {
  active: ['New', 'Active', 'In Progress'],
  closed: ['Done', 'Resolved', 'Closed', 'Removed'],
  all: null
};

/**
 * Build WIQL state filter clause
 */
function buildStateFilterClause(stateFilter: string[] | null): string {
  if (!stateFilter) return '';
  const stateList = stateFilter.map(s => `'${s}'`).join(', ');
  return ` AND [System.State] IN (${stateList})`;
}

/**
 * Extract assignedTo display name from the ADO field (can be object or string)
 */
function extractAssignedTo(
  field: { displayName: string; uniqueName: string } | string | undefined
): string | undefined {
  if (!field) return undefined;
  if (typeof field === 'string') return field || undefined;
  return field.displayName || undefined;
}

/**
 * Parse semicolon-separated tags string into an array
 */
function parseTags(tagsField: string | undefined): string[] {
  if (!tagsField) return [];
  return tagsField
    .split(';')
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

/**
 * Construct web URL for a work item
 */
function buildWorkItemWebUrl(
  config: { orgUrl: string; project: string },
  workItem: ADOAPIWorkItem
): string {
  if (workItem._links?.html?.href) {
    return workItem._links.html.href;
  }
  return `${config.orgUrl}/${encodeURIComponent(config.project)}/_workitems/edit/${workItem.id}`;
}

/**
 * Transform ADO API work item to our normalized shape
 */
function transformWorkItem(
  apiItem: ADOAPIWorkItem,
  config: { orgUrl: string; project: string }
): AzureDevOpsWorkItem {
  const fields = apiItem.fields;
  return {
    id: apiItem.id,
    title: fields['System.Title'] ?? '',
    description: fields['System.Description'] ?? undefined,
    state: fields['System.State'] ?? '',
    workItemType: fields['System.WorkItemType'] ?? '',
    assignedTo: extractAssignedTo(
      fields['System.AssignedTo'] as { displayName: string; uniqueName: string } | string | undefined
    ),
    createdDate: fields['System.CreatedDate'] ?? '',
    changedDate: fields['System.ChangedDate'] ?? '',
    tags: parseTags(fields['System.Tags'] as string | undefined),
    areaPath: fields['System.AreaPath'] ?? '',
    iterationPath: fields['System.IterationPath'] ?? '',
    webUrl: buildWorkItemWebUrl(config, apiItem)
  };
}

/**
 * Get work items from Azure DevOps via WIQL
 */
export function registerGetWorkItems(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_GET_WORK_ITEMS,
    async (
      _event,
      projectId: string,
      state?: 'active' | 'closed' | 'all'
    ): Promise<IPCResult<AzureDevOpsWorkItem[]>> => {
      debugLog('getWorkItems handler called', { projectId, state });

      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = await getAzureDevOpsConfig(project);
      if (!config) {
        return { success: false, error: 'Azure DevOps not configured' };
      }

      try {
        const stateKey = state ?? 'active';
        const stateFilter = STATE_FILTER_MAP[stateKey] ?? STATE_FILTER_MAP.active;
        const stateClause = buildStateFilterClause(stateFilter ?? null);

        // WIQL query — escape single quotes in project name
        const escapedProject = config.project.replace(/'/g, "''");
        const wiqlQuery = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${escapedProject}'${stateClause} ORDER BY [System.ChangedDate] DESC`;

        const wiqlResponse = await adoFetch(config, '/wit/wiql?$top=200', {
          method: 'POST',
          body: JSON.stringify({ query: wiqlQuery })
        }) as ADOAPIWiqlResult;

        const workItemRefs = wiqlResponse?.workItems ?? [];

        if (workItemRefs.length === 0) {
          debugLog('No work items found');
          return { success: true, data: [] };
        }

        // Batch-fetch work item details in chunks of 200 (ADO limit)
        const BATCH_SIZE = 200;
        const allWorkItems: AzureDevOpsWorkItem[] = [];

        for (let i = 0; i < workItemRefs.length; i += BATCH_SIZE) {
          const batch = workItemRefs.slice(i, i + BATCH_SIZE);
          const ids = batch.map(ref => ref.id).join(',');

          const detailsResponse = await adoFetch(
            config,
            `/wit/workitems?ids=${ids}&$expand=all`
          ) as { value: ADOAPIWorkItem[] };

          const batchItems = Array.isArray(detailsResponse?.value) ? detailsResponse.value : [];
          const transformed = batchItems.map(item => transformWorkItem(item, config));
          allWorkItems.push(...transformed);
        }

        debugLog('Fetched work items:', allWorkItems.length);

        return { success: true, data: allWorkItems };
      } catch (error) {
        debugLog('Failed to get work items:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get work items'
        };
      }
    }
  );
}

/**
 * Get a single work item by ID
 */
export function registerGetWorkItem(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_GET_WORK_ITEM,
    async (
      _event,
      projectId: string,
      workItemId: number
    ): Promise<IPCResult<AzureDevOpsWorkItem>> => {
      debugLog('getWorkItem handler called', { projectId, workItemId });

      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = await getAzureDevOpsConfig(project);
      if (!config) {
        return { success: false, error: 'Azure DevOps not configured' };
      }

      try {
        const apiItem = await adoFetch(
          config,
          `/wit/workitems/${workItemId}?$expand=all`
        ) as ADOAPIWorkItem;

        const workItem = transformWorkItem(apiItem, config);

        return { success: true, data: workItem };
      } catch (error) {
        debugLog('Failed to get work item:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get work item'
        };
      }
    }
  );
}

/**
 * Get comments for a work item
 */
export function registerGetWorkItemComments(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_GET_WORK_ITEM_COMMENTS,
    async (
      _event,
      projectId: string,
      workItemId: number
    ): Promise<IPCResult<AzureDevOpsWorkItemComment[]>> => {
      debugLog('getWorkItemComments handler called', { projectId, workItemId });

      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = await getAzureDevOpsConfig(project);
      if (!config) {
        return { success: false, error: 'Azure DevOps not configured' };
      }

      try {
        const response = await adoFetch(
          config,
          `/wit/workitems/${workItemId}/comments`
        ) as ADOAPIWorkItemCommentsResponse;

        const comments = Array.isArray(response?.value) ? response.value : [];
        const transformed: AzureDevOpsWorkItemComment[] = comments.map(c => ({
          id: c.id,
          text: c.text,
          createdBy: c.createdBy?.displayName ?? 'Unknown',
          createdDate: c.createdDate
        }));

        debugLog('Fetched comments:', transformed.length);

        return { success: true, data: transformed };
      } catch (error) {
        debugLog('Failed to get comments:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get work item comments'
        };
      }
    }
  );
}

/**
 * Register all work item handlers
 */
export function registerWorkItemHandlers(): void {
  debugLog('Registering Azure DevOps work item handlers');
  registerGetWorkItems();
  registerGetWorkItem();
  registerGetWorkItemComments();
  debugLog('Azure DevOps work item handlers registered');
}

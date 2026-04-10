/**
 * Azure DevOps repository handlers
 * Handles connection status, project discovery, repo detection, and branch listing
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import { projectStore } from '../../project-store';
import {
  getAzureDevOpsConfig,
  adoFetch,
  adoOrgFetch,
  adoFetchWithCount,
  detectAzureDevOpsFromRemote
} from './utils';
import type {
  ADOAPIProject,
  ADOAPIRepository,
  ADOAPIWiqlResult,
  ADOAPIRef,
  AzureDevOpsSyncStatus
} from './types';

// Debug logging helper — enabled in development OR when DEBUG flag is set
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.debug(`[ADO Repo] ${message}`, data);
    } else {
      console.debug(`[ADO Repo] ${message}`);
    }
  }
}

/**
 * Check Azure DevOps connection status for a project.
 * Fetches project info + work item count via WIQL.
 */
export function registerCheckConnection(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_CHECK_CONNECTION,
    async (_event, projectId: string): Promise<IPCResult<AzureDevOpsSyncStatus>> => {
      debugLog('checkConnection handler called', { projectId });

      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = await getAzureDevOpsConfig(project);
      if (!config) {
        debugLog('No Azure DevOps config found');
        return {
          success: true,
          data: {
            connected: false,
            error:
              'Azure DevOps not configured. Please add AZURE_DEVOPS_TOKEN, AZURE_DEVOPS_ORG_URL, and AZURE_DEVOPS_PROJECT to your .env file.'
          }
        };
      }

      try {
        // Fetch project info via org-level endpoint (no project prefix in URL)
        // URL: {orgUrl}/_apis/projects/{project}?api-version=7.1
        const projectInfo = await adoOrgFetch(
          config,
          `/projects/${encodeURIComponent(config.project)}`
        ) as ADOAPIProject;

        debugLog('Project info retrieved:', { name: projectInfo.name });

        // Count work items via WIQL
        const wiqlBody = {
          query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${config.project.replace(/'/g, "''")}' ORDER BY [System.ChangedDate] DESC`
        };

        // adoFetchWithCount reads count from response body
        const { totalCount: workItemCount } = await adoFetchWithCount(
          config,
          '/wit/wiql?$top=1',
          {
            method: 'POST',
            body: JSON.stringify(wiqlBody)
          }
        );

        return {
          success: true,
          data: {
            connected: true,
            orgUrl: config.orgUrl,
            projectName: projectInfo.name,
            workItemCount,
            lastSyncedAt: new Date().toISOString()
          }
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to connect to Azure DevOps';
        debugLog('Connection check failed:', errorMessage);
        return {
          success: true,
          data: {
            connected: false,
            error: errorMessage
          }
        };
      }
    }
  );
}

/**
 * List accessible projects at the org level
 */
export function registerGetProjects(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_GET_PROJECTS,
    async (_event, projectId: string): Promise<IPCResult<ADOAPIProject[]>> => {
      debugLog('getProjects handler called');

      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = await getAzureDevOpsConfig(project);
      if (!config) {
        return { success: false, error: 'Azure DevOps not configured' };
      }

      try {
        // Org-level projects endpoint — no project prefix in URL
        const response = await adoOrgFetch(
          config,
          '/projects'
        ) as { value: ADOAPIProject[]; count: number };

        const projects = Array.isArray(response?.value) ? response.value : [];
        debugLog('Found projects:', projects.length);

        return { success: true, data: projects };
      } catch (error) {
        debugLog('Failed to get projects:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get projects'
        };
      }
    }
  );
}

/**
 * Detect Azure DevOps org/project/repo from git remote URL
 */
export function registerDetectRepo(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_DETECT_REPO,
    async (
      _event,
      projectId: string
    ): Promise<IPCResult<{ orgUrl: string; project: string; repo: string } | null>> => {
      debugLog('detectRepo handler called', { projectId });

      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        const detected = detectAzureDevOpsFromRemote(project.path);
        debugLog('Detected remote:', detected);
        return { success: true, data: detected };
      } catch (error) {
        debugLog('Failed to detect repo:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to detect repo'
        };
      }
    }
  );
}

/**
 * List branches for the detected repo
 */
export function registerGetBranches(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_GET_BRANCHES,
    async (_event, projectId: string): Promise<IPCResult<string[]>> => {
      debugLog('getBranches handler called', { projectId });

      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = await getAzureDevOpsConfig(project);
      if (!config) {
        return { success: false, error: 'Azure DevOps not configured' };
      }

      try {
        // List all repos in the project
        const reposResponse = await adoFetch(
          config,
          '/git/repositories'
        ) as { value: ADOAPIRepository[]; count: number };

        const repos = Array.isArray(reposResponse?.value) ? reposResponse.value : [];

        if (repos.length === 0) {
          debugLog('No repositories found in project');
          return { success: true, data: [] };
        }

        // Try to match the repo detected from git remote; fall back to first repo
        let targetRepo: ADOAPIRepository = repos[0];
        const detected = detectAzureDevOpsFromRemote(project.path);
        if (detected) {
          const matched = repos.find(
            r => r.name.toLowerCase() === detected.repo.toLowerCase()
          );
          if (matched) {
            targetRepo = matched;
          }
        }

        debugLog('Fetching branches for repo:', targetRepo.name);

        // Fetch branches (refs/heads/*)
        const refsResponse = await adoFetch(
          config,
          `/git/repositories/${encodeURIComponent(targetRepo.id)}/refs?filter=heads`
        ) as { value: ADOAPIRef[]; count: number };

        const refs = Array.isArray(refsResponse?.value) ? refsResponse.value : [];

        // Strip "refs/heads/" prefix
        const branches = refs.map(ref => ref.name.replace(/^refs\/heads\//, ''));

        debugLog('Found branches:', branches.length);

        return { success: true, data: branches };
      } catch (error) {
        debugLog('Failed to get branches:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get branches'
        };
      }
    }
  );
}

/**
 * Register all repository handlers
 */
export function registerRepositoryHandlers(): void {
  debugLog('Registering Azure DevOps repository handlers');
  registerCheckConnection();
  registerGetProjects();
  registerDetectRepo();
  registerGetBranches();
  debugLog('Azure DevOps repository handlers registered');
}

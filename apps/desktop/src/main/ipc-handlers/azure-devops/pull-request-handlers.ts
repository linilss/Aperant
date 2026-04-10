/**
 * Azure DevOps pull request handlers
 * Handles fetching pull requests from git repositories
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { getAzureDevOpsConfig, adoFetch, detectAzureDevOpsFromRemote } from './utils';
import type {
  ADOAPIRepository,
  ADOAPIPullRequest,
  AzureDevOpsPullRequest
} from './types';

// Debug logging helper — enabled in development OR when DEBUG flag is set
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.debug(`[ADO Pull Requests] ${message}`, data);
    } else {
      console.debug(`[ADO Pull Requests] ${message}`);
    }
  }
}

/**
 * Strip "refs/heads/" prefix from an ADO ref name
 */
function stripRefPrefix(refName: string): string {
  return refName.replace(/^refs\/heads\//, '');
}

/**
 * Construct the web URL for a pull request
 */
function buildPRWebUrl(
  config: { orgUrl: string; project: string },
  repoName: string,
  pullRequestId: number
): string {
  return `${config.orgUrl}/${encodeURIComponent(config.project)}/_git/${encodeURIComponent(repoName)}/pullrequest/${pullRequestId}`;
}

/**
 * Normalize an ADO PR status to our restricted union
 */
function normalizeStatus(
  status: ADOAPIPullRequest['status']
): 'active' | 'completed' | 'abandoned' {
  if (status === 'completed') return 'completed';
  if (status === 'abandoned') return 'abandoned';
  return 'active';
}

/**
 * Transform ADO API pull request to our normalized shape
 */
function transformPullRequest(
  apiPR: ADOAPIPullRequest,
  config: { orgUrl: string; project: string }
): AzureDevOpsPullRequest {
  const repoName = apiPR.repository?.name ?? '';
  return {
    pullRequestId: apiPR.pullRequestId,
    title: apiPR.title,
    description: apiPR.description,
    status: normalizeStatus(apiPR.status),
    sourceBranch: stripRefPrefix(apiPR.sourceRefName),
    targetBranch: stripRefPrefix(apiPR.targetRefName),
    createdBy: apiPR.createdBy?.displayName ?? 'Unknown',
    reviewers: (apiPR.reviewers ?? []).map(r => ({
      id: r.id,
      displayName: r.displayName,
      vote: r.vote,
      isRequired: r.isRequired
    })),
    creationDate: apiPR.creationDate,
    closedDate: apiPR.closedDate,
    webUrl: buildPRWebUrl(config, repoName, apiPR.pullRequestId),
    repositoryName: repoName
  };
}

/**
 * Find the target repository for the given project.
 * Tries to match from git remote first; falls back to the first repo.
 */
async function findTargetRepo(
  config: { orgUrl: string; project: string; token: string },
  projectPath: string
): Promise<ADOAPIRepository | null> {
  const reposResponse = await adoFetch(
    config,
    '/git/repositories'
  ) as { value: ADOAPIRepository[]; count: number };

  const repos = Array.isArray(reposResponse?.value) ? reposResponse.value : [];
  if (repos.length === 0) return null;

  const detected = detectAzureDevOpsFromRemote(projectPath);
  if (detected) {
    const matched = repos.find(
      r => r.name.toLowerCase() === detected.repo.toLowerCase()
    );
    if (matched) return matched;
  }

  return repos[0];
}

/**
 * Get pull requests from Azure DevOps
 */
export function registerGetPullRequests(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_GET_PULL_REQUESTS,
    async (
      _event,
      projectId: string,
      state?: 'active' | 'completed' | 'all'
    ): Promise<IPCResult<AzureDevOpsPullRequest[]>> => {
      debugLog('getPullRequests handler called', { projectId, state });

      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = await getAzureDevOpsConfig(project);
      if (!config) {
        return { success: false, error: 'Azure DevOps not configured' };
      }

      try {
        const targetRepo = await findTargetRepo(config, project.path);
        if (!targetRepo) {
          debugLog('No repositories found in project');
          return { success: true, data: [] };
        }

        // Map our state param to the ADO API searchCriteria.status value
        const statusParam = state === 'all' ? 'all' : state === 'completed' ? 'completed' : 'active';

        const prsResponse = await adoFetch(
          config,
          `/git/repositories/${encodeURIComponent(targetRepo.id)}/pullrequests?searchCriteria.status=${statusParam}`
        ) as { value: ADOAPIPullRequest[]; count: number };

        const apiPRs = Array.isArray(prsResponse?.value) ? prsResponse.value : [];
        const pullRequests = apiPRs.map(pr => transformPullRequest(pr, config));

        debugLog('Fetched pull requests:', pullRequests.length);

        return { success: true, data: pullRequests };
      } catch (error) {
        debugLog('Failed to get pull requests:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get pull requests'
        };
      }
    }
  );
}

/**
 * Get a single pull request by ID
 */
export function registerGetPullRequest(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_GET_PULL_REQUEST,
    async (
      _event,
      projectId: string,
      pullRequestId: number
    ): Promise<IPCResult<AzureDevOpsPullRequest>> => {
      debugLog('getPullRequest handler called', { projectId, pullRequestId });

      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = await getAzureDevOpsConfig(project);
      if (!config) {
        return { success: false, error: 'Azure DevOps not configured' };
      }

      try {
        const targetRepo = await findTargetRepo(config, project.path);
        if (!targetRepo) {
          return { success: false, error: 'No repositories found in Azure DevOps project' };
        }

        const apiPR = await adoFetch(
          config,
          `/git/repositories/${encodeURIComponent(targetRepo.id)}/pullrequests/${pullRequestId}`
        ) as ADOAPIPullRequest;

        const pullRequest = transformPullRequest(apiPR, config);

        return { success: true, data: pullRequest };
      } catch (error) {
        debugLog('Failed to get pull request:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get pull request'
        };
      }
    }
  );
}

/**
 * Register all pull request handlers
 */
export function registerPullRequestHandlers(): void {
  debugLog('Registering Azure DevOps pull request handlers');
  registerGetPullRequests();
  registerGetPullRequest();
  debugLog('Azure DevOps pull request handlers registered');
}

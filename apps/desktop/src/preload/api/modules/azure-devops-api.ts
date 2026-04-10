import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import type {
  AzureDevOpsWorkItem,
  AzureDevOpsWorkItemComment,
  AzureDevOpsPullRequest,
  AzureDevOpsSyncStatus
} from '../../../main/ipc-handlers/azure-devops/types';
import { createIpcListener, invokeIpc, sendIpc, type IpcListenerCleanup } from './ipc-utils';

export type { AzureDevOpsWorkItem, AzureDevOpsWorkItemComment, AzureDevOpsPullRequest, AzureDevOpsSyncStatus };

export interface AzureDevOpsInvestigationStatus {
  phase: 'fetching' | 'analyzing' | 'generating' | 'complete';
  workItemId: number;
  progress: number;
  message: string;
}

export interface AzureDevOpsInvestigationResult {
  success: boolean;
  workItemId: number;
  analysis?: {
    summary: string;
    proposedSolution: string;
    affectedFiles: string[];
    estimatedComplexity: string;
    acceptanceCriteria: string[];
  };
  taskId?: string;
  error?: string;
}

/**
 * Azure DevOps Integration API
 */
export interface AzureDevOpsAPI {
  // Connection & repository
  checkAzureDevOpsConnection: (projectId: string) => Promise<IPCResult<AzureDevOpsSyncStatus>>;
  detectAzureDevOpsRepo: (projectPath: string) => Promise<IPCResult<{ orgUrl: string; project: string; repo: string }>>;
  getAzureDevOpsBranches: (projectId: string) => Promise<IPCResult<string[]>>;

  // Work Items
  getAzureDevOpsWorkItems: (projectId: string, state?: 'active' | 'closed' | 'all') => Promise<IPCResult<AzureDevOpsWorkItem[]>>;
  getAzureDevOpsWorkItem: (projectId: string, workItemId: number) => Promise<IPCResult<AzureDevOpsWorkItem>>;
  getAzureDevOpsWorkItemComments: (projectId: string, workItemId: number) => Promise<IPCResult<AzureDevOpsWorkItemComment[]>>;
  investigateAzureDevOpsWorkItem: (projectId: string, workItemId: number) => void;
  importAzureDevOpsWorkItems: (projectId: string, workItemIds: number[]) => Promise<IPCResult<{ importedCount: number; specIds: string[] }>>;

  // Pull Requests
  getAzureDevOpsPullRequests: (projectId: string, state?: 'active' | 'completed' | 'all') => Promise<IPCResult<AzureDevOpsPullRequest[]>>;
  getAzureDevOpsPullRequest: (projectId: string, pullRequestId: number) => Promise<IPCResult<AzureDevOpsPullRequest>>;

  // Event Listeners
  onAzureDevOpsInvestigationProgress: (
    callback: (projectId: string, status: AzureDevOpsInvestigationStatus) => void
  ) => IpcListenerCleanup;
  onAzureDevOpsInvestigationComplete: (
    callback: (projectId: string, result: AzureDevOpsInvestigationResult) => void
  ) => IpcListenerCleanup;
  onAzureDevOpsInvestigationError: (
    callback: (projectId: string, error: string) => void
  ) => IpcListenerCleanup;
}

/**
 * Creates the Azure DevOps Integration API implementation
 */
export const createAzureDevOpsAPI = (): AzureDevOpsAPI => ({
  // Connection & repository
  checkAzureDevOpsConnection: (projectId: string): Promise<IPCResult<AzureDevOpsSyncStatus>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_CHECK_CONNECTION, projectId),

  detectAzureDevOpsRepo: (projectPath: string): Promise<IPCResult<{ orgUrl: string; project: string; repo: string }>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_DETECT_REPO, projectPath),

  getAzureDevOpsBranches: (projectId: string): Promise<IPCResult<string[]>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_GET_BRANCHES, projectId),

  // Work Items
  getAzureDevOpsWorkItems: (projectId: string, state?: 'active' | 'closed' | 'all'): Promise<IPCResult<AzureDevOpsWorkItem[]>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_GET_WORK_ITEMS, projectId, state),

  getAzureDevOpsWorkItem: (projectId: string, workItemId: number): Promise<IPCResult<AzureDevOpsWorkItem>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_GET_WORK_ITEM, projectId, workItemId),

  getAzureDevOpsWorkItemComments: (projectId: string, workItemId: number): Promise<IPCResult<AzureDevOpsWorkItemComment[]>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_GET_WORK_ITEM_COMMENTS, projectId, workItemId),

  investigateAzureDevOpsWorkItem: (projectId: string, workItemId: number): void =>
    sendIpc(IPC_CHANNELS.AZURE_DEVOPS_INVESTIGATE_WORK_ITEM, projectId, workItemId),

  importAzureDevOpsWorkItems: (projectId: string, workItemIds: number[]): Promise<IPCResult<{ importedCount: number; specIds: string[] }>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_IMPORT_WORK_ITEMS, projectId, workItemIds),

  // Pull Requests
  getAzureDevOpsPullRequests: (projectId: string, state?: 'active' | 'completed' | 'all'): Promise<IPCResult<AzureDevOpsPullRequest[]>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_GET_PULL_REQUESTS, projectId, state),

  getAzureDevOpsPullRequest: (projectId: string, pullRequestId: number): Promise<IPCResult<AzureDevOpsPullRequest>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_GET_PULL_REQUEST, projectId, pullRequestId),

  // Event Listeners
  onAzureDevOpsInvestigationProgress: (
    callback: (projectId: string, status: AzureDevOpsInvestigationStatus) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AZURE_DEVOPS_INVESTIGATION_PROGRESS, callback),

  onAzureDevOpsInvestigationComplete: (
    callback: (projectId: string, result: AzureDevOpsInvestigationResult) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AZURE_DEVOPS_INVESTIGATION_COMPLETE, callback),

  onAzureDevOpsInvestigationError: (
    callback: (projectId: string, error: string) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AZURE_DEVOPS_INVESTIGATION_ERROR, callback),
});

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

// PR Review types

export interface ADOPRReviewFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'security' | 'quality' | 'logic' | 'style' | 'performance';
  title: string;
  description: string;
  file: string;
  line: number;
  suggestedFix?: string;
  fixable: boolean;
}

export interface ADOPRReviewResult {
  pullRequestId: number;
  repositoryName: string;
  success: boolean;
  findings: ADOPRReviewFinding[];
  summary: string;
  overallStatus: 'approve' | 'request_changes' | 'comment';
  verdict: string;
  verdictReasoning: string;
  reviewedAt: string;
  reviewedCommitSha?: string;
  isFollowupReview?: boolean;
  hasPostedFindings?: boolean;
  postedFindingIds?: string[];
}

export interface ADOPRReviewProgress {
  phase: 'fetching' | 'analyzing' | 'generating' | 'complete';
  pullRequestId: number;
  progress: number;
  message: string;
}

export interface ADOPRNewCommitsCheck {
  hasNewCommits: boolean;
  commitCount: number;
  latestCommitSha?: string;
  latestCommitMessage?: string;
}

export interface ADOPRLogs {
  pullRequestId: number;
  entries: Array<{
    timestamp: string;
    level: 'info' | 'warn' | 'error';
    message: string;
  }>;
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

  // PR Review
  reviewAzureDevOpsPR: (projectId: string, pullRequestId: number) => void;
  reviewAzureDevOpsPRFollowup: (projectId: string, pullRequestId: number) => void;
  cancelAzureDevOpsPRReview: (projectId: string, pullRequestId: number) => void;
  getAzureDevOpsPRReview: (projectId: string, pullRequestId: number) => Promise<IPCResult<ADOPRReviewResult | null>>;
  getAzureDevOpsPRReviewsBatch: (projectId: string, prIds: number[]) => Promise<IPCResult<Record<number, ADOPRReviewResult>>>;
  postAzureDevOpsPRReview: (projectId: string, pullRequestId: number, findingIds?: string[]) => Promise<IPCResult<void>>;
  deleteAzureDevOpsPRReview: (projectId: string, pullRequestId: number) => Promise<IPCResult<void>>;
  approveAzureDevOpsPR: (projectId: string, pullRequestId: number, vote: number) => Promise<IPCResult<void>>;
  mergeAzureDevOpsPR: (projectId: string, pullRequestId: number) => Promise<IPCResult<void>>;
  checkAzureDevOpsPRNewCommits: (projectId: string, pullRequestId: number) => Promise<IPCResult<ADOPRNewCommitsCheck>>;
  checkAzureDevOpsPRMergeReadiness: (projectId: string, pullRequestId: number) => Promise<IPCResult<{ canMerge: boolean; reason?: string }>>;
  getAzureDevOpsPRDiff: (projectId: string, pullRequestId: number) => Promise<IPCResult<string>>;
  getAzureDevOpsPRLogs: (projectId: string, pullRequestId: number) => Promise<IPCResult<ADOPRLogs | null>>;

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
  onAzureDevOpsPRReviewProgress: (callback: (projectId: string, progress: ADOPRReviewProgress) => void) => IpcListenerCleanup;
  onAzureDevOpsPRReviewComplete: (callback: (projectId: string, result: ADOPRReviewResult) => void) => IpcListenerCleanup;
  onAzureDevOpsPRReviewError: (callback: (projectId: string, pullRequestId: number, error: string) => void) => IpcListenerCleanup;
  onAzureDevOpsPRLogsUpdated: (callback: (projectId: string, pullRequestId: number) => void) => IpcListenerCleanup;
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

  // PR Review
  reviewAzureDevOpsPR: (projectId: string, pullRequestId: number): void =>
    sendIpc(IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW, projectId, pullRequestId),

  reviewAzureDevOpsPRFollowup: (projectId: string, pullRequestId: number): void =>
    sendIpc(IPC_CHANNELS.AZURE_DEVOPS_PR_FOLLOWUP_REVIEW, projectId, pullRequestId),

  cancelAzureDevOpsPRReview: (projectId: string, pullRequestId: number): void =>
    sendIpc(IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_CANCEL, projectId, pullRequestId),

  getAzureDevOpsPRReview: (projectId: string, pullRequestId: number): Promise<IPCResult<ADOPRReviewResult | null>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_PR_GET_REVIEW, projectId, pullRequestId),

  getAzureDevOpsPRReviewsBatch: (projectId: string, prIds: number[]): Promise<IPCResult<Record<number, ADOPRReviewResult>>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_PR_GET_REVIEWS_BATCH, projectId, prIds),

  postAzureDevOpsPRReview: (projectId: string, pullRequestId: number, findingIds?: string[]): Promise<IPCResult<void>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_PR_POST_REVIEW, projectId, pullRequestId, findingIds),

  deleteAzureDevOpsPRReview: (projectId: string, pullRequestId: number): Promise<IPCResult<void>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_PR_DELETE_REVIEW, projectId, pullRequestId),

  approveAzureDevOpsPR: (projectId: string, pullRequestId: number, vote: number): Promise<IPCResult<void>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_PR_APPROVE, projectId, pullRequestId, vote),

  mergeAzureDevOpsPR: (projectId: string, pullRequestId: number): Promise<IPCResult<void>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_PR_MERGE, projectId, pullRequestId),

  checkAzureDevOpsPRNewCommits: (projectId: string, pullRequestId: number): Promise<IPCResult<ADOPRNewCommitsCheck>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_PR_CHECK_NEW_COMMITS, projectId, pullRequestId),

  checkAzureDevOpsPRMergeReadiness: (projectId: string, pullRequestId: number): Promise<IPCResult<{ canMerge: boolean; reason?: string }>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_PR_CHECK_MERGE_READINESS, projectId, pullRequestId),

  getAzureDevOpsPRDiff: (projectId: string, pullRequestId: number): Promise<IPCResult<string>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_PR_GET_DIFF, projectId, pullRequestId),

  getAzureDevOpsPRLogs: (projectId: string, pullRequestId: number): Promise<IPCResult<ADOPRLogs | null>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_PR_GET_LOGS, projectId, pullRequestId),

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

  onAzureDevOpsPRReviewProgress: (
    callback: (projectId: string, progress: ADOPRReviewProgress) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_PROGRESS, callback),

  onAzureDevOpsPRReviewComplete: (
    callback: (projectId: string, result: ADOPRReviewResult) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_COMPLETE, callback),

  onAzureDevOpsPRReviewError: (
    callback: (projectId: string, pullRequestId: number, error: string) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_ERROR, callback),

  onAzureDevOpsPRLogsUpdated: (
    callback: (projectId: string, pullRequestId: number) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AZURE_DEVOPS_PR_LOGS_UPDATED, callback),
});

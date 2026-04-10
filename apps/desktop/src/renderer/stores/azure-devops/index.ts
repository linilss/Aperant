/**
 * Azure DevOps Stores — focused state management for Azure DevOps integration.
 *
 * This module exports all Azure DevOps-related stores and their utilities.
 */

// Work Items Store
export {
  useWorkItemsStore,
  loadAzureDevOpsWorkItems,
  importAzureDevOpsWorkItems,
  type WorkItemFilterState,
  type AzureDevOpsWorkItem
} from './work-items-store';

// Sync Status Store
export {
  useSyncStatusStore,
  checkAzureDevOpsConnection,
  type AzureDevOpsSyncStatus
} from './sync-status-store';

// Pull Request type (defined here for co-location with the store layer)
export interface AzureDevOpsPullRequest {
  pullRequestId: number;
  title: string;
  description?: string;
  status: 'active' | 'completed' | 'abandoned';
  sourceBranch: string;
  targetBranch: string;
  createdBy: string;
  reviewers: Array<{
    id: string;
    displayName: string;
    vote: number;
    isRequired?: boolean;
  }>;
  creationDate: string;
  closedDate?: string;
  webUrl: string;
  repositoryName: string;
}

/**
 * Azure DevOps module types and interfaces
 */

export interface AzureDevOpsConfig {
  token: string;          // Personal Access Token (PAT)
  orgUrl: string;         // e.g., "https://dev.azure.com/myorg"
  project: string;        // Project name
}

export interface ADOAPIProject {
  id: string;
  name: string;
  description?: string;
  url: string;
  state: string;
}

export interface ADOAPIRepository {
  id: string;
  name: string;
  defaultBranch?: string;
  remoteUrl: string;
  webUrl?: string;
  project: { id: string; name: string };
}

// Work Items use a flat fields object
export interface ADOAPIWorkItemFields {
  'System.Id': number;
  'System.Title': string;
  'System.Description'?: string;
  'System.State': string;
  'System.WorkItemType': string;
  'System.AssignedTo'?: { displayName: string; uniqueName: string } | string;
  'System.CreatedDate': string;
  'System.ChangedDate': string;
  'System.Tags'?: string;
  'System.AreaPath': string;
  'System.IterationPath': string;
  'Microsoft.VSTS.Common.Priority'?: number;
  [key: string]: unknown;
}

export interface ADOAPIWorkItem {
  id: number;
  rev: number;
  fields: ADOAPIWorkItemFields;
  url: string;
  _links?: {
    html?: { href: string };
    workItemComments?: { href: string };
  };
}

export interface ADOAPIWorkItemComment {
  id: number;
  text: string;
  createdBy: { displayName: string };
  createdDate: string;
  modifiedDate: string;
}

export interface ADOAPIWorkItemCommentsResponse {
  totalCount: number;
  count: number;
  value: ADOAPIWorkItemComment[];
}

export interface ADOAPIWiqlResult {
  workItems: Array<{ id: number; url: string }>;
}

export interface ADOAPIRef {
  name: string;             // e.g., "refs/heads/main"
  objectId: string;
  creator: { displayName: string };
  url: string;
}

export interface ADOAPIPullRequest {
  pullRequestId: number;
  title: string;
  description?: string;
  status: 'active' | 'completed' | 'abandoned' | 'notSet';
  sourceRefName: string;   // e.g., "refs/heads/feature/foo"
  targetRefName: string;   // e.g., "refs/heads/main"
  createdBy: { displayName: string; uniqueName: string };
  reviewers: Array<{
    id: string;
    displayName: string;
    vote: number;           // 10=approved, 5=approved w/ suggestions, 0=no vote, -5=waiting, -10=rejected
    isRequired?: boolean;
  }>;
  creationDate: string;
  closedDate?: string;
  mergeStatus?: string;
  url: string;
  repository: { id: string; name: string };
}

// Normalized types exposed to the renderer
export interface AzureDevOpsWorkItem {
  id: number;
  title: string;
  description?: string;
  state: string;
  workItemType: string;
  assignedTo?: string;
  createdDate: string;
  changedDate: string;
  tags: string[];
  areaPath: string;
  iterationPath: string;
  webUrl: string;
}

export interface AzureDevOpsWorkItemComment {
  id: number;
  text: string;
  createdBy: string;
  createdDate: string;
}

export interface AzureDevOpsPullRequest {
  pullRequestId: number;
  title: string;
  description?: string;
  status: 'active' | 'completed' | 'abandoned';
  sourceBranch: string;    // cleaned: "feature/foo" not "refs/heads/feature/foo"
  targetBranch: string;
  createdBy: string;
  reviewers: Array<{ id: string; displayName: string; vote: number; isRequired?: boolean }>;
  creationDate: string;
  closedDate?: string;
  webUrl: string;
  repositoryName: string;
}

export interface AzureDevOpsSyncStatus {
  connected: boolean;
  orgUrl?: string;
  projectName?: string;
  workItemCount?: number;
  lastSyncedAt?: string;
  error?: string;
}

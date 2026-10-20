/**
 * Mock implementation for environment configuration and integration operations
 */

export const integrationMock = {
  // Environment Configuration Operations
  getProjectEnv: async () => ({
    success: true,
    data: {
      linearEnabled: false,
      azureDevOpsEnabled: false,
      memoryEnabled: false,
      enableFancyUi: true
    }
  }),

  updateProjectEnv: async () => ({
    success: true
  }),

  // Linear Integration Operations
  getLinearTeams: async () => ({
    success: true,
    data: []
  }),

  getLinearProjects: async () => ({
    success: true,
    data: []
  }),

  getLinearIssues: async () => ({
    success: true,
    data: []
  }),

  importLinearIssues: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  checkLinearConnection: async () => ({
    success: true,
    data: {
      connected: false,
      error: 'Not available in browser mock'
    }
  }),

  // Azure DevOps Integration Operations
  checkAzureDevOpsConnection: async () => ({ success: true, data: { connected: false } }),
  detectAzureDevOpsRepo: async () => ({ success: false, error: 'Not available in browser mock' }),
  getAzureDevOpsBranches: async () => ({ success: true, data: [] }),
  getAzureDevOpsWorkItems: async () => ({ success: true, data: [] }),
  getAzureDevOpsWorkItem: async () => ({ success: false, error: 'Not available in browser mock' }),
  getAzureDevOpsWorkItemComments: async () => ({ success: true, data: [] }),
  investigateAzureDevOpsWorkItem: () => {},
  importAzureDevOpsWorkItems: async () => ({ success: false, error: 'Not available in browser mock' }),
  getAzureDevOpsPullRequests: async () => ({ success: true, data: [] }),
  getAzureDevOpsPullRequest: async () => ({ success: false, error: 'Not available in browser mock' }),
  onAzureDevOpsInvestigationProgress: () => () => {},
  onAzureDevOpsInvestigationComplete: () => () => {},
  onAzureDevOpsInvestigationError: () => () => {},

  // Azure DevOps PR Review Operations
  reviewAzureDevOpsPR: () => {},
  reviewAzureDevOpsPRFollowup: () => {},
  cancelAzureDevOpsPRReview: () => {},
  getAzureDevOpsPRReview: async () => ({ success: true, data: null }),
  getAzureDevOpsPRReviewsBatch: async () => ({ success: true, data: {} }),
  postAzureDevOpsPRReview: async () => ({ success: true }),
  deleteAzureDevOpsPRReview: async () => ({ success: true }),
  approveAzureDevOpsPR: async () => ({ success: true }),
  mergeAzureDevOpsPR: async () => ({ success: true }),
  checkAzureDevOpsPRNewCommits: async () => ({ success: true, data: { hasNewCommits: false, commitCount: 0 } }),
  checkAzureDevOpsPRMergeReadiness: async () => ({ success: true, data: { canMerge: false } }),
  getAzureDevOpsPRDiff: async () => ({ success: true, data: '' }),
  getAzureDevOpsPRLogs: async () => ({ success: true, data: null }),
  onAzureDevOpsPRReviewProgress: () => () => {},
  onAzureDevOpsPRReviewComplete: () => () => {},
  onAzureDevOpsPRReviewError: () => () => {},
  onAzureDevOpsPRLogsUpdated: () => () => {},
};

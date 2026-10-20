/**
 * Mock implementation for environment configuration and integration operations
 */

export const integrationMock = {
  // Environment Configuration Operations
  getProjectEnv: async () => ({
    success: true,
    data: {
      linearEnabled: false,
      githubEnabled: false,
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

  // GitHub Integration Operations
  getGitHubRepositories: async () => ({
    success: true,
    data: []
  }),

  getGitHubIssues: async () => ({
    success: true,
    data: { issues: [], hasMore: false }
  }),

  getGitHubIssue: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  checkGitHubConnection: async () => ({
    success: true,
    data: {
      connected: false,
      error: 'Not available in browser mock'
    }
  }),

  investigateGitHubIssue: () => {
    console.warn('[Browser Mock] investigateGitHubIssue called');
  },

  getIssueComments: async () => ({
    success: true,
    data: []
  }),

  importGitHubIssues: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  createGitHubRelease: async () => ({
    success: true,
    data: {
      url: 'https://github.com/example/repo/releases/tag/v1.0.0'
    }
  }),

  onGitHubInvestigationProgress: () => () => {},
  onGitHubInvestigationComplete: () => () => {},
  onGitHubInvestigationError: () => () => {},

  // GitHub OAuth Operations (gh CLI)
  checkGitHubCli: async () => ({
    success: true,
    data: {
      installed: false,
      version: undefined
    }
  }),

  checkGitHubAuth: async () => ({
    success: true,
    data: {
      authenticated: false,
      username: undefined
    }
  }),

  startGitHubAuth: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  getGitHubToken: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  getGitHubUser: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  listGitHubUserRepos: async () => ({
    success: true,
    data: {
      repos: [
        { fullName: 'user/example-repo', description: 'An example repository', isPrivate: false },
        { fullName: 'user/private-repo', description: 'A private repository', isPrivate: true }
      ]
    }
  }),

  detectGitHubRepo: async () => ({
    success: true,
    data: 'user/example-repo'
  }),

  getGitHubBranches: async () => ({
    success: true,
    data: ['main', 'develop', 'feature/example']
  }),

  createGitHubRepo: async (_repoName: string, _options: { description?: string; isPrivate?: boolean; projectPath: string; owner?: string }) => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  addGitRemote: async (_projectPath: string, _repoFullName: string) => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  listGitHubOrgs: async () => ({
    success: true,
    data: {
      orgs: [
        { login: 'example-org', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4' },
        { login: 'another-org', avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4' }
      ]
    }
  }),

  // OAuth device code event listener (for streaming device code during auth)
  onGitHubAuthDeviceCode: () => () => {},

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

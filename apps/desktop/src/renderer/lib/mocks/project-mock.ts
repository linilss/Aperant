/**
 * Mock implementation for project operations
 */

import { DEFAULT_PROJECT_SETTINGS } from '../../../shared/constants';
import { FUNNEL_STEP_IDS, type FunnelProgress } from '../../../shared/types/funnel';
import { mockProjects } from './mock-data';

/** Varied funnel progress so the tab bars show empty, partial and complete states */
const MOCK_FUNNEL_COMPLETED: Record<string, number> = { 'mock-project-1': 3, 'mock-project-2': 0 };

function mockFunnelProgress(projectId: string): FunnelProgress {
  const completed =
    MOCK_FUNNEL_COMPLETED[projectId] ??
    [...projectId].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % (FUNNEL_STEP_IDS.length + 1);
  const steps = FUNNEL_STEP_IDS.map((id, i) => ({ id, done: i < completed }));
  return { steps, completed, total: steps.length };
}

export const projectMock = {
  addProject: async (projectPath: string) => ({
    success: true,
    data: {
      id: `mock-${Date.now()}`,
      name: projectPath.split('/').pop() || 'new-project',
      path: projectPath,
      autoBuildPath: `${projectPath}/.malvy`,
      settings: DEFAULT_PROJECT_SETTINGS,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  }),

  removeProject: async () => ({ success: true }),

  getProjects: async () => ({
    success: true,
    data: mockProjects
  }),

  updateProjectSettings: async () => ({ success: true }),

  initializeProject: async () => ({
    success: true,
    data: { success: true, version: '1.0.0', wasUpdate: false }
  }),

  clearProjectData: async () => ({ success: true }),
  listDeployScripts: async () => ({ success: true, data: [] }),
  getDeployPreflight: async () => ({
    success: true,
    data: { currentBranch: 'main', mainBranch: 'main', hasUncommittedChanges: false }
  }),
  prepareDeployCheckout: async () => ({ success: true, data: '/Users/demo/projects/demo/.malvy/worktrees/deploy' }),
  verifyBeforeDeploy: async () => ({ success: true, data: { ok: true, skipped: true } }),
  resolveTaskDeployments: async () => ({ success: true, data: {} }),
  recordTaskDeployment: async () => ({ success: true, data: [] }),
  getFunnelProgress: async (projectIds: string[]) => ({
    success: true,
    data: Object.fromEntries(projectIds.map((id) => [id, mockFunnelProgress(id)]))
  }),
  onFunnelChanged: () => () => undefined,

  checkProjectVersion: async () => ({
    success: true,
    data: {
      isInitialized: true,
      currentVersion: '1.0.0',
      sourceVersion: '1.0.0',
      updateAvailable: false
    }
  }),

  // Tab state operations (persisted in main process)
  getTabState: async () => ({
    success: true,
    data: {
      openProjectIds: [],
      activeProjectId: null,
      tabOrder: []
    }
  }),

  saveTabState: async () => ({ success: true }),

  // Kanban Preferences
  getKanbanPreferences: async () => ({ success: true, data: null }),
  saveKanbanPreferences: async () => ({ success: true }),

  // Dialog operations
  selectDirectory: async () => {
    return prompt('Enter project path (browser mock):', '/Users/demo/projects/new-project');
  },

  createProjectFolder: async (_location: string, name: string, initGit: boolean) => ({
    success: true,
    data: {
      path: `/Users/demo/projects/${name}`,
      name,
      gitInitialized: initGit
    }
  }),

  getDefaultProjectLocation: async () => '/Users/demo/projects',

  // File explorer operations
  listDirectory: async () => ({
    success: true,
    data: []
  }),

  readFile: async () => ({
    success: true,
    data: ''
  }),

  // Git operations
  getGitBranches: async () => ({
    success: true,
    data: ['main', 'develop', 'feature/test']
  }),

  getGitBranchesWithInfo: async () => ({
    success: true,
    data: [
      { name: 'main', type: 'local' as const, displayName: 'main', isCurrent: true },
      { name: 'develop', type: 'local' as const, displayName: 'develop', isCurrent: false },
      { name: 'feature/test', type: 'local' as const, displayName: 'feature/test', isCurrent: false },
      { name: 'origin/main', type: 'remote' as const, displayName: 'origin/main', isCurrent: false },
      { name: 'origin/develop', type: 'remote' as const, displayName: 'origin/develop', isCurrent: false }
    ]
  }),

  getCurrentGitBranch: async () => ({
    success: true,
    data: 'main'
  }),

  detectMainBranch: async () => ({
    success: true,
    data: 'main'
  }),

  checkGitStatus: async () => ({
    success: true,
    data: {
      isGitRepo: true,
      hasCommits: true,
      currentBranch: 'main'
    }
  }),

  initializeGit: async () => ({
    success: true,
    data: { success: true }
  }),

  // Memory Infrastructure operations (LadybugDB)
  getMemoryInfrastructureStatus: async () => ({
    success: true,
    data: {
      memory: {
        kuzuInstalled: true,
        databasePath: '~/.malvy/graphs',
        databaseExists: true,
        databases: ['auto_claude_memory']
      },
      ready: true
    }
  }),

  listMemoryDatabases: async () => ({
    success: true,
    data: ['auto_claude_memory', 'project_memory']
  }),

  testMemoryConnection: async () => ({
    success: true,
    data: {
      success: true,
      message: 'Connected to LadybugDB database (mock)',
      details: { latencyMs: 5 }
    }
  })
};

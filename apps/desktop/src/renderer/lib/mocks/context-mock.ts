/**
 * Mock implementation for context and memory operations
 */

const noop = (): void => undefined;

/** No design system detected (browser mock) */
const emptyDesignState = {
  detection: {
    name: null,
    artifactUrl: null,
    sourceDir: null,
    publishRoot: null,
    tokenFiles: [],
    docFile: null,
    candidates: [],
    overridden: { artifactUrl: false, sourceDir: false }
  },
  config: {},
  data: {
    origin: 'none' as const,
    colors: [],
    typography: [],
    radii: [],
    spacing: [],
    components: [],
    docs: [],
    parsedFiles: [],
    rawFiles: []
  },
  hasSnapshot: false,
  running: null
};

export const contextMock = {
  getProjectContext: async () => ({
    success: true,
    data: {
      projectIndex: null,
      memoryStatus: null,
      memoryState: null,
      recentMemories: [],
      isLoading: false
    }
  }),

  refreshProjectIndex: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  getMemoryStatus: async () => ({
    success: true,
    data: {
      enabled: false,
      available: false,
      reason: 'Browser mock environment'
    }
  }),

  searchMemories: async () => ({
    success: true,
    data: []
  }),

  getRecentMemories: async () => ({
    success: true,
    data: []
  }),

  // Memory Management
  verifyMemory: async (_memoryId: string) => ({
    success: true
  }),

  pinMemory: async (_memoryId: string, _pinned: boolean) => ({
    success: true
  }),

  deprecateMemory: async (_memoryId: string) => ({
    success: true
  }),

  deleteMemory: async (_memoryId: string) => ({
    success: true
  }),

  // Developer pointers
  listPointers: async () => ({ success: true, data: [] }),
  createPointer: async () => ({ success: false, error: 'Not available in browser mock' }),
  updatePointer: async () => ({ success: true }),
  deletePointer: async () => ({ success: true }),

  // CLAUDE.md docs tree + optimizer
  listClaudeDocs: async () => ({ success: true, data: { docs: [], lastOptimizedAt: null } }),
  readClaudeDoc: async () => ({ success: false, error: 'Not available in browser mock' }),
  listCodeBranches: async () => ({ success: true, data: [] }),
  getProjectSummary: async () => ({ success: true, data: null }),
  getCoreValues: async () => ({ success: true, data: { text: '', updatedAt: null } }),
  saveCoreValues: async (_projectId: string, text: string) => ({
    success: true,
    data: { values: { text: text.trim(), updatedAt: text.trim() ? new Date().toISOString() : null }, directionsMarkedStale: false }
  }),
  draftCoreValues: async () => ({ success: false, error: 'Not available in browser mock' }),
  getPendingDocsRun: async () => ({ success: true, data: { pending: null, isRunning: false } }),
  discardPendingDocsRun: async () => ({ success: true }),
  optimizeClaudeDocs: noop,
  stopClaudeDocsOptimizer: noop,
  applyDocProposals: async () => ({ success: true, data: { applied: [], errors: [] } }),
  onDocsOptimizerChunk: () => noop,
  onDocsOptimizerBranchProgress: () => noop,
  onDocsOptimizerComplete: () => noop,
  onDocsOptimizerError: () => noop,

  // Design system (Context → Design)
  getDesignSystem: async () => ({ success: true, data: emptyDesignState }),
  saveDesignSystemOverrides: async () => ({ success: false, error: 'Not available in browser mock' }),
  readDesignSystemFile: async () => ({ success: false, error: 'Not available in browser mock' }),
  getDesignPublishPlan: async () => ({ success: true, data: null }),
  syncDesignSystem: async () => ({ success: false, error: 'Not available in browser mock' }),
  publishDesignSystem: async () => ({ success: false, error: 'Not available in browser mock' }),
  onDesignSystemProgress: () => noop
};

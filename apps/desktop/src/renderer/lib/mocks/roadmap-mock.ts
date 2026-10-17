/**
 * Mock implementation for roadmap operations
 */

export const roadmapMock = {
  getRoadmap: async () => ({
    success: true,
    data: null
  }),

  generateRoadmap: () => {
    console.warn('[Browser Mock] generateRoadmap called');
  },

  refreshRoadmap: () => {
    console.warn('[Browser Mock] refreshRoadmap called');
  },

  updateFeatureStatus: async () => ({ success: true }),
  updateFeaturePriority: async () => ({ success: true }),
  refineRoadmapFeature: async () => ({ success: false, error: 'Not available in browser mode' }),
  planRoadmapFeatures: async () => ({ success: false, error: 'Not available in browser mode' }),
  onRoadmapFeatureRefineStarted: () => () => {},
  onRoadmapFeatureRefined: () => () => {},
  onRoadmapFeatureRefineFailed: () => () => {},

  convertFeatureToSpec: async (projectId: string, _featureId: string) => ({
    success: true,
    data: {
      id: `task-${Date.now()}`,
      specId: '',
      projectId,
      title: 'Converted Feature',
      description: 'Feature converted from roadmap',
      status: 'backlog' as const,
      subtasks: [],
      logs: [],
      createdAt: new Date(),
      updatedAt: new Date()
    }
  }),

  // Roadmap Event Listeners
  onRoadmapProgress: () => () => {},
  onRoadmapComplete: () => () => {},
  onRoadmapError: () => () => {},

  // Feature Refine session stubs
  roadmapRefineStart: () => {},
  roadmapRefineSend: () => {},
  roadmapRefineStop: () => {},
  onRoadmapRefineChunk: () => () => {},
  onRoadmapRefineToolUse: () => () => {},
  onRoadmapRefineComplete: () => () => {},
  onRoadmapRefineError: () => () => {},
};

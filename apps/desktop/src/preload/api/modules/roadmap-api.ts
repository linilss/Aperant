import { IPC_CHANNELS } from '../../../shared/constants';
import type {
  Roadmap,
  RoadmapFeature,
  RoadmapFeaturePriority,
  RoadmapFeatureRefineOptions,
  RoadmapFeatureStatus,
  RoadmapGenerationStatus,
  PersistedRoadmapProgress,
  CompetitorAnalysis,
  Task,
  IPCResult
} from '../../../shared/types';
import { createIpcListener, invokeIpc, sendIpc, IpcListenerCleanup } from './ipc-utils';

/** Result produced by the AI feature refinement session (grill → PRD → plan). */
export interface FeatureRefineResult {
  title: string;
  description: string;
  prd: string;
  plan: string;
  acceptanceCriteria: string[];
  userStories: string[];
}

/**
 * Roadmap API operations
 */
export interface RoadmapAPI {
  // Operations
  getRoadmap: (projectId: string) => Promise<IPCResult<Roadmap | null>>;
  getRoadmapStatus: (projectId: string) => Promise<IPCResult<{ isRunning: boolean }>>;
  saveRoadmap: (projectId: string, roadmap: Roadmap) => Promise<IPCResult>;
  generateRoadmap: (projectId: string, enableCompetitorAnalysis?: boolean, refreshCompetitorAnalysis?: boolean) => void;
  refreshRoadmap: (projectId: string, enableCompetitorAnalysis?: boolean, refreshCompetitorAnalysis?: boolean, guidance?: string) => void;
  stopRoadmap: (projectId: string) => Promise<IPCResult>;
  updateFeatureStatus: (
    projectId: string,
    featureId: string,
    status: RoadmapFeatureStatus
  ) => Promise<IPCResult>;
  updateFeaturePriority: (
    projectId: string,
    featureId: string,
    priority: RoadmapFeaturePriority
  ) => Promise<IPCResult>;
  convertFeatureToSpec: (
    projectId: string,
    featureId: string
  ) => Promise<IPCResult<Task>>;
  /** One-shot AI refinement of a feature; resolves with the updated feature when done */
  /** Proofread planned features (no task yet) and create their tasks, in the background */
  planRoadmapFeatures: (projectId: string, featureIds: string[]) => Promise<IPCResult>;
  refineRoadmapFeature: (
    projectId: string,
    featureId: string,
    line: string,
    options: RoadmapFeatureRefineOptions
  ) => Promise<IPCResult<RoadmapFeature>>;
  onRoadmapFeatureRefineStarted: (
    callback: (projectId: string, featureId: string) => void
  ) => IpcListenerCleanup;
  onRoadmapFeatureRefined: (
    callback: (projectId: string, feature: RoadmapFeature) => void
  ) => IpcListenerCleanup;
  onRoadmapFeatureRefineFailed: (
    callback: (projectId: string, featureId: string, error: string) => void
  ) => IpcListenerCleanup;

  // Competitor analysis
  saveCompetitorAnalysis: (projectId: string, competitorAnalysis: CompetitorAnalysis) => Promise<IPCResult>;

  // Progress persistence
  saveRoadmapProgress: (projectId: string, progress: PersistedRoadmapProgress) => Promise<IPCResult>;
  loadRoadmapProgress: (projectId: string) => Promise<IPCResult<PersistedRoadmapProgress | null>>;
  clearRoadmapProgress: (projectId: string) => Promise<IPCResult>;

  // Event Listeners
  onRoadmapProgress: (
    callback: (projectId: string, status: RoadmapGenerationStatus) => void
  ) => IpcListenerCleanup;
  onRoadmapComplete: (
    callback: (projectId: string, roadmap: Roadmap) => void
  ) => IpcListenerCleanup;
  onRoadmapError: (
    callback: (projectId: string, error: string) => void
  ) => IpcListenerCleanup;
  onRoadmapStopped: (
    callback: (projectId: string) => void
  ) => IpcListenerCleanup;

  // Feature Refine session
  roadmapRefineStart: (projectId: string, initialDescription?: string, featureContext?: RoadmapFeature) => void;
  roadmapRefineSend: (projectId: string, message: string) => void;
  roadmapRefineStop: (projectId: string) => void;
  onRoadmapRefineChunk: (
    callback: (projectId: string, chunk: string) => void
  ) => IpcListenerCleanup;
  onRoadmapRefineToolUse: (
    callback: (projectId: string, toolName: string) => void
  ) => IpcListenerCleanup;
  onRoadmapRefineComplete: (
    callback: (projectId: string, result: FeatureRefineResult | null) => void
  ) => IpcListenerCleanup;
  onRoadmapRefineError: (
    callback: (projectId: string, error: string) => void
  ) => IpcListenerCleanup;
}

/**
 * Creates the Roadmap API implementation
 */
export const createRoadmapAPI = (): RoadmapAPI => ({
  // Operations
  getRoadmap: (projectId: string): Promise<IPCResult<Roadmap | null>> =>
    invokeIpc(IPC_CHANNELS.ROADMAP_GET, projectId),

  getRoadmapStatus: (projectId: string): Promise<IPCResult<{ isRunning: boolean }>> =>
    invokeIpc(IPC_CHANNELS.ROADMAP_GET_STATUS, projectId),

  saveRoadmap: (projectId: string, roadmap: Roadmap): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.ROADMAP_SAVE, projectId, roadmap),

  generateRoadmap: (projectId: string, enableCompetitorAnalysis?: boolean, refreshCompetitorAnalysis?: boolean): void =>
    sendIpc(IPC_CHANNELS.ROADMAP_GENERATE, projectId, enableCompetitorAnalysis, refreshCompetitorAnalysis),

  refreshRoadmap: (projectId: string, enableCompetitorAnalysis?: boolean, refreshCompetitorAnalysis?: boolean, guidance?: string): void =>
    sendIpc(IPC_CHANNELS.ROADMAP_REFRESH, projectId, enableCompetitorAnalysis, refreshCompetitorAnalysis, guidance),

  stopRoadmap: (projectId: string): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.ROADMAP_STOP, projectId),

  updateFeatureStatus: (
    projectId: string,
    featureId: string,
    status: RoadmapFeatureStatus
  ): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.ROADMAP_UPDATE_FEATURE, projectId, featureId, status),

  updateFeaturePriority: (
    projectId: string,
    featureId: string,
    priority: RoadmapFeaturePriority
  ): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.ROADMAP_UPDATE_FEATURE_PRIORITY, projectId, featureId, priority),

  convertFeatureToSpec: (
    projectId: string,
    featureId: string
  ): Promise<IPCResult<Task>> =>
    invokeIpc(IPC_CHANNELS.ROADMAP_CONVERT_TO_SPEC, projectId, featureId),

  planRoadmapFeatures: (projectId: string, featureIds: string[]): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.ROADMAP_PLAN_INTAKE, projectId, featureIds),
  refineRoadmapFeature: (
    projectId: string,
    featureId: string,
    line: string,
    options: RoadmapFeatureRefineOptions
  ): Promise<IPCResult<RoadmapFeature>> =>
    invokeIpc(IPC_CHANNELS.ROADMAP_REFINE_FEATURE, projectId, featureId, line, options),

  onRoadmapFeatureRefineStarted: (
    callback: (projectId: string, featureId: string) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.ROADMAP_FEATURE_REFINE_STARTED, callback),

  onRoadmapFeatureRefined: (
    callback: (projectId: string, feature: RoadmapFeature) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.ROADMAP_FEATURE_REFINED, callback),

  onRoadmapFeatureRefineFailed: (
    callback: (projectId: string, featureId: string, error: string) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.ROADMAP_FEATURE_REFINE_FAILED, callback),

  // Competitor analysis
  saveCompetitorAnalysis: (projectId: string, competitorAnalysis: CompetitorAnalysis): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.COMPETITOR_ANALYSIS_SAVE, projectId, competitorAnalysis),

  // Progress persistence
  saveRoadmapProgress: (projectId: string, progress: PersistedRoadmapProgress): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.ROADMAP_PROGRESS_SAVE, projectId, progress),

  loadRoadmapProgress: (projectId: string): Promise<IPCResult<PersistedRoadmapProgress | null>> =>
    invokeIpc(IPC_CHANNELS.ROADMAP_PROGRESS_LOAD, projectId),

  clearRoadmapProgress: (projectId: string): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.ROADMAP_PROGRESS_CLEAR, projectId),

  // Event Listeners
  onRoadmapProgress: (
    callback: (projectId: string, status: RoadmapGenerationStatus) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.ROADMAP_PROGRESS, callback),

  onRoadmapComplete: (
    callback: (projectId: string, roadmap: Roadmap) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.ROADMAP_COMPLETE, callback),

  onRoadmapError: (
    callback: (projectId: string, error: string) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.ROADMAP_ERROR, callback),

  onRoadmapStopped: (
    callback: (projectId: string) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.ROADMAP_STOPPED, callback),

  // Feature Refine session
  roadmapRefineStart: (projectId: string, initialDescription?: string, featureContext?: RoadmapFeature): void =>
    sendIpc(IPC_CHANNELS.ROADMAP_REFINE_START, projectId, initialDescription, featureContext),

  roadmapRefineSend: (projectId: string, message: string): void =>
    sendIpc(IPC_CHANNELS.ROADMAP_REFINE_SEND, projectId, message),

  roadmapRefineStop: (projectId: string): void =>
    sendIpc(IPC_CHANNELS.ROADMAP_REFINE_STOP, projectId),

  onRoadmapRefineChunk: (
    callback: (projectId: string, chunk: string) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.ROADMAP_REFINE_CHUNK, callback),

  onRoadmapRefineToolUse: (
    callback: (projectId: string, toolName: string) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.ROADMAP_REFINE_TOOL_USE, callback),

  onRoadmapRefineComplete: (
    callback: (projectId: string, result: FeatureRefineResult | null) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.ROADMAP_REFINE_COMPLETE, callback),

  onRoadmapRefineError: (
    callback: (projectId: string, error: string) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.ROADMAP_REFINE_ERROR, callback),
});

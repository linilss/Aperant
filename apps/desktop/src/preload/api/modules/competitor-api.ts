import { IPC_CHANNELS } from '../../../shared/constants';
import type {
  CompetitorAnalyzeOptions,
  CompetitorCompletePayload,
  CompetitorGetResult,
  CompetitorProgressEvent,
  CompetitorStrategyState,
  DirectionRankingInput,
  IPCResult,
  ManualCompetitorPoolInput,
} from '../../../shared/types';
import { createIpcListener, invokeIpc, sendIpc, type IpcListenerCleanup } from './ipc-utils';

/**
 * Competitors page API (Plan → Competitors)
 */
export interface CompetitorAPI {
  getCompetitors: (projectId: string) => Promise<IPCResult<CompetitorGetResult>>;
  analyzeCompetitors: (projectId: string, options?: CompetitorAnalyzeOptions) => void;
  stopCompetitors: (projectId: string) => void;
  /** Profile one competitor: deep-dive a pool item or refresh an analyzed card */
  refreshCompetitor: (projectId: string, competitorId: string) => void;
  resynthesizeDirections: (projectId: string) => void;
  saveDirectionRanking: (
    projectId: string,
    ranking: DirectionRankingInput,
  ) => Promise<IPCResult<CompetitorStrategyState>>;
  moveCompetitorToPool: (projectId: string, competitorId: string) => Promise<IPCResult<CompetitorStrategyState>>;
  addManualCompetitor: (
    projectId: string,
    input: ManualCompetitorPoolInput,
  ) => Promise<IPCResult<CompetitorStrategyState>>;

  onCompetitorsProgress: (
    callback: (projectId: string, event: CompetitorProgressEvent) => void,
  ) => IpcListenerCleanup;
  onCompetitorsComplete: (
    callback: (projectId: string, payload: CompetitorCompletePayload) => void,
  ) => IpcListenerCleanup;
  onCompetitorsError: (callback: (projectId: string, error: string) => void) => IpcListenerCleanup;
}

export const createCompetitorAPI = (): CompetitorAPI => ({
  getCompetitors: (projectId) => invokeIpc(IPC_CHANNELS.COMPETITORS_GET, projectId),
  analyzeCompetitors: (projectId, options) => sendIpc(IPC_CHANNELS.COMPETITORS_ANALYZE, projectId, options),
  stopCompetitors: (projectId) => sendIpc(IPC_CHANNELS.COMPETITORS_STOP, projectId),
  refreshCompetitor: (projectId, competitorId) =>
    sendIpc(IPC_CHANNELS.COMPETITORS_REFRESH_ONE, projectId, competitorId),
  resynthesizeDirections: (projectId) => sendIpc(IPC_CHANNELS.COMPETITORS_RESYNTHESIZE, projectId),
  saveDirectionRanking: (projectId, ranking) =>
    invokeIpc(IPC_CHANNELS.COMPETITORS_SAVE_RANKING, projectId, ranking),
  moveCompetitorToPool: (projectId, competitorId) =>
    invokeIpc(IPC_CHANNELS.COMPETITORS_MOVE_TO_POOL, projectId, competitorId),
  addManualCompetitor: (projectId, input) => invokeIpc(IPC_CHANNELS.COMPETITORS_ADD_MANUAL, projectId, input),

  onCompetitorsProgress: (callback) =>
    createIpcListener<[string, CompetitorProgressEvent]>(IPC_CHANNELS.COMPETITORS_PROGRESS, callback),
  onCompetitorsComplete: (callback) =>
    createIpcListener<[string, CompetitorCompletePayload]>(IPC_CHANNELS.COMPETITORS_COMPLETE, callback),
  onCompetitorsError: (callback) =>
    createIpcListener<[string, string]>(IPC_CHANNELS.COMPETITORS_ERROR, callback),
});

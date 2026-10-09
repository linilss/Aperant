/**
 * Competitors page IPC (Plan → Competitors).
 *
 * One session per project holds the live state while runs are in flight: a
 * full analysis / resynthesis (one at a time) and any number of single
 * competitor profile runs (pool deep-dives, card refreshes). Every state change
 * is persisted under `<project>/.malvy/roadmap/` and streamed as progress.
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';

import { IPC_CHANNELS } from '../../shared/constants';
import type {
  CompetitorAnalyzeOptions,
  CompetitorCompletePayload,
  CompetitorGetResult,
  CompetitorProgressEvent,
  CompetitorRunPhase,
  CompetitorStrategyState,
  DirectionRankingInput,
  IPCResult,
  ManualCompetitorPoolInput,
} from '../../shared/types';
import { debugError } from '../../shared/utils/debug-logger';
import { projectStore } from '../project-store';
import {
  type CompetitorRunContext,
  type CompetitorRunOutcome,
  type CompetitorStateStore,
  addManualCompetitor,
  applyDirectionRanking,
  createMemoryStore,
  emptyCompetitorState,
  loadCompetitorState,
  moveCompetitorToPool,
  profileCompetitor,
  runFullAnalysis,
  saveCompetitorState,
  synthesizeDirections,
} from '../ai/runners/competitors';
import { resolveClaudeCliFeatureModel } from './feature-settings-helper';
import { safeSendToRenderer } from './utils';

interface Session {
  projectPath: string;
  store: CompetitorStateStore;
  /** Full analysis or resynthesis in flight */
  main: { controller: AbortController; phase: CompetitorRunPhase | null } | null;
  /** Single-competitor profile runs keyed by competitor id */
  singles: Map<string, AbortController>;
}

const sessions = new Map<string, Session>();

const isBusy = (s: Session) => s.main !== null || s.singles.size > 0;

function persist(projectPath: string, state: CompetitorStrategyState): void {
  try {
    saveCompetitorState(projectPath, state);
  } catch (error) {
    debugError('[Competitors] Failed to persist state:', error);
  }
}

/** Session for a project; reloads from disk whenever nothing is running */
function getSession(projectId: string, projectPath: string): Session {
  const existing = sessions.get(projectId);
  if (existing && isBusy(existing)) return existing;
  const initial = loadCompetitorState(projectPath) ?? emptyCompetitorState();
  const session: Session = {
    projectPath,
    store: createMemoryStore(initial, (state) => persist(projectPath, state)),
    main: null,
    singles: existing?.singles ?? new Map(),
  };
  sessions.set(projectId, session);
  return session;
}

/** Claude model for the CLI: the roadmap feature model when it is a Claude model, else sonnet */
const resolveCliModel = (): string => resolveClaudeCliFeatureModel('roadmap');

/** Validate renderer-supplied analyze options (the pipeline clamps count to 3–10) */
function sanitizeAnalyzeOptions(raw: unknown): CompetitorAnalyzeOptions {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  return {
    focus: typeof r.focus === 'string' ? r.focus.slice(0, 500) : undefined,
    count: typeof r.count === 'number' ? r.count : undefined,
  };
}

export function registerCompetitorHandlers(getMainWindow: () => BrowserWindow | null): void {
  const send = (channel: string, ...args: unknown[]) => safeSendToRenderer(getMainWindow, channel, ...args);

  const context = (projectId: string, session: Session, signal: AbortSignal, onPhase?: (p: CompetitorRunPhase) => void): CompetitorRunContext => ({
    projectDir: session.projectPath,
    store: session.store,
    modelId: resolveCliModel(),
    abortSignal: signal,
    onEvent: (event: CompetitorProgressEvent) => {
      if (event.kind === 'phase') onPhase?.(event.phase);
      send(IPC_CHANNELS.COMPETITORS_PROGRESS, projectId, event);
    },
  });

  /** Run a full analysis or resynthesis as the session's main run */
  const startMain = (
    projectId: string,
    run: (ctx: CompetitorRunContext) => Promise<CompetitorRunOutcome>,
  ): void => {
    const project = projectStore.getProject(projectId);
    if (!project) {
      send(IPC_CHANNELS.COMPETITORS_ERROR, projectId, 'Project not found');
      return;
    }
    const session = getSession(projectId, project.path);
    if (session.main) return; // already running
    const controller = new AbortController();
    const main: NonNullable<Session['main']> = { controller, phase: null };
    session.main = main;
    const ctx = context(projectId, session, controller.signal, (phase) => {
      main.phase = phase;
    });

    void run(ctx)
      .catch((error): CompetitorRunOutcome => ({
        success: false,
        aborted: controller.signal.aborted,
        error: error instanceof Error ? error.message : String(error),
      }))
      .then((outcome) => {
        if (session.main === main) session.main = null;
        if (!outcome.success && !outcome.aborted && outcome.error) {
          send(IPC_CHANNELS.COMPETITORS_ERROR, projectId, outcome.error);
        }
        const payload: CompetitorCompletePayload = { state: session.store.get(), stopped: outcome.aborted };
        send(IPC_CHANNELS.COMPETITORS_COMPLETE, projectId, payload);
      });
  };

  ipcMain.handle(
    IPC_CHANNELS.COMPETITORS_GET,
    async (_, projectId: string): Promise<IPCResult<CompetitorGetResult>> => {
      const project = projectStore.getProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      const session = getSession(projectId, project.path);
      const state = session.store.get();
      const hasData = state.competitors.length > 0 || state.directions.length > 0;
      return {
        success: true,
        data: {
          state: hasData ? state : null,
          isRunning: session.main !== null,
          phase: session.main?.phase ?? null,
        },
      };
    },
  );

  ipcMain.on(IPC_CHANNELS.COMPETITORS_ANALYZE, (_, projectId: string, options?: CompetitorAnalyzeOptions) => {
    const { focus, count } = sanitizeAnalyzeOptions(options);
    // A full run replaces the competitor list — stop single runs first
    const session = sessions.get(projectId);
    if (session && !session.main) {
      for (const c of session.singles.values()) c.abort();
    }
    startMain(projectId, (ctx) => runFullAnalysis(ctx, { focus, count }));
  });

  ipcMain.on(IPC_CHANNELS.COMPETITORS_RESYNTHESIZE, (_, projectId: string) => {
    startMain(projectId, (ctx) => synthesizeDirections(ctx));
  });

  ipcMain.on(IPC_CHANNELS.COMPETITORS_STOP, (_, projectId: string) => {
    const session = sessions.get(projectId);
    if (!session) return;
    session.main?.controller.abort();
    for (const controller of session.singles.values()) controller.abort();
  });

  ipcMain.on(IPC_CHANNELS.COMPETITORS_REFRESH_ONE, (_, projectId: string, competitorId: string) => {
    const project = projectStore.getProject(projectId);
    if (!project || typeof competitorId !== 'string') return;
    const session = getSession(projectId, project.path);
    if (session.main || session.singles.has(competitorId)) return;
    const controller = new AbortController();
    session.singles.set(competitorId, controller);
    void profileCompetitor(context(projectId, session, controller.signal), competitorId)
      .catch((error) => {
        send(IPC_CHANNELS.COMPETITORS_ERROR, projectId, error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (session.singles.get(competitorId) === controller) session.singles.delete(competitorId);
      });
  });

  /** Pure state edit (no AI) shared by ranking / pool moves / manual add */
  const edit = (
    projectId: string,
    fn: (state: CompetitorStrategyState) => CompetitorStrategyState,
  ): IPCResult<CompetitorStrategyState> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: 'Project not found' };
    const session = getSession(projectId, project.path);
    if (session.main?.phase === 'synthesizing' || session.main?.phase === 'discovering') {
      return { success: false, error: 'An analysis is running' };
    }
    const state = session.store.update(fn);
    send(IPC_CHANNELS.COMPETITORS_PROGRESS, projectId, { kind: 'state', state } satisfies CompetitorProgressEvent);
    return { success: true, data: state };
  };

  ipcMain.handle(
    IPC_CHANNELS.COMPETITORS_SAVE_RANKING,
    async (_, projectId: string, ranking: DirectionRankingInput): Promise<IPCResult<CompetitorStrategyState>> => {
      if (!ranking || typeof ranking !== 'object') return { success: false, error: 'Invalid ranking' };
      return edit(projectId, (state) => applyDirectionRanking(state, ranking));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.COMPETITORS_MOVE_TO_POOL,
    async (_, projectId: string, competitorId: string): Promise<IPCResult<CompetitorStrategyState>> =>
      edit(projectId, (state) => moveCompetitorToPool(state, String(competitorId))),
  );

  ipcMain.handle(
    IPC_CHANNELS.COMPETITORS_ADD_MANUAL,
    async (_, projectId: string, input: ManualCompetitorPoolInput): Promise<IPCResult<CompetitorStrategyState>> => {
      const project = projectStore.getProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      if (!input || typeof input.name !== 'string' || !input.name.trim()) {
        return { success: false, error: 'Name is required' };
      }
      const before = getSession(projectId, project.path).store.get();
      const next = addManualCompetitor(before, input);
      if (next === before) return { success: false, error: 'duplicate' };
      return edit(projectId, () => next);
    },
  );
}

import { create } from 'zustand';
import {
  COMPETITOR_COUNT_DEFAULT,
  type CompetitorProgressEvent,
  type CompetitorProfile,
  type CompetitorRunPhase,
  type CompetitorStrategyState,
  type StrategicDirection,
  clampCompetitorCount,
} from '../../shared/types/competitors';

interface CompetitorStoreState {
  projectId: string | null;
  data: CompetitorStrategyState | null;
  /** A full analysis / resynthesis is running */
  isRunning: boolean;
  phase: CompetitorRunPhase | null;
  isLoading: boolean;
  error: string | null;
  /** Header inputs */
  focus: string;
  count: number;
  /** Local ranking draft (order, avoid, notes) until saved */
  draftDirections: StrategicDirection[];
  rankingDirty: boolean;
  isSavingRanking: boolean;

  setFocus: (focus: string) => void;
  setCount: (count: number) => void;
  setError: (error: string | null) => void;
  moveDirection: (from: number, to: number) => void;
  toggleAvoid: (directionId: string) => void;
  setNote: (directionId: string, note: string) => void;
}

const emptyState = (): CompetitorStrategyState => ({
  projectName: '',
  projectType: '',
  targetAudience: '',
  focus: '',
  competitorCount: COMPETITOR_COUNT_DEFAULT,
  analyzedAt: null,
  competitors: [],
  directions: [],
  directionsSynthesizedAt: null,
  directionsStale: false,
  rankingSavedAt: null,
});

const sameIds = (a: StrategicDirection[], b: StrategicDirection[]) =>
  a.length === b.length && a.every((d) => b.some((x) => x.id === d.id));

export const useCompetitorStore = create<CompetitorStoreState>((set) => ({
  projectId: null,
  data: null,
  isRunning: false,
  phase: null,
  isLoading: false,
  error: null,
  focus: '',
  count: COMPETITOR_COUNT_DEFAULT,
  draftDirections: [],
  rankingDirty: false,
  isSavingRanking: false,

  setFocus: (focus) => set({ focus }),
  setCount: (count) => set({ count: clampCompetitorCount(count) }),
  setError: (error) => set({ error }),

  moveDirection: (from, to) =>
    set((s) => {
      if (from === to || from < 0 || to < 0 || from >= s.draftDirections.length || to >= s.draftDirections.length) {
        return s;
      }
      const next = [...s.draftDirections];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return { draftDirections: next, rankingDirty: true };
    }),

  toggleAvoid: (directionId) =>
    set((s) => ({
      draftDirections: s.draftDirections.map((d) => (d.id === directionId ? { ...d, avoid: !d.avoid } : d)),
      rankingDirty: true,
    })),

  setNote: (directionId, note) =>
    set((s) => ({
      draftDirections: s.draftDirections.map((d) => (d.id === directionId ? { ...d, note } : d)),
      rankingDirty: true,
    })),
}));

// ---- Reducers (exported for tests) -------------------------------------------

/** Apply a new server state; the ranking draft follows unless the user has unsaved edits to the same directions */
export function applyServerState(data: CompetitorStrategyState | null): void {
  useCompetitorStore.setState((s) => {
    const directions = data?.directions ?? [];
    const keepDraft = s.rankingDirty && sameIds(s.draftDirections, directions);
    return {
      data,
      draftDirections: keepDraft ? s.draftDirections : directions,
      rankingDirty: keepDraft,
    };
  });
}

export function applyProgressEvent(event: CompetitorProgressEvent): void {
  const { data } = useCompetitorStore.getState();
  const current = data ?? emptyState();
  switch (event.kind) {
    case 'phase':
      useCompetitorStore.setState({ phase: event.phase, isRunning: true, error: null });
      break;
    case 'competitors':
      applyServerState({ ...current, competitors: event.competitors });
      break;
    case 'competitor': {
      const exists = current.competitors.some((c) => c.id === event.competitor.id);
      const competitors: CompetitorProfile[] = exists
        ? current.competitors.map((c) => (c.id === event.competitor.id ? event.competitor : c))
        : [...current.competitors, event.competitor];
      applyServerState({ ...current, competitors });
      break;
    }
    case 'directions':
      applyServerState({
        ...current,
        directions: event.directions,
        directionsStale: false,
        directionsError: undefined,
        rankingSavedAt: null,
      });
      break;
    case 'state':
      applyServerState(event.state);
      break;
  }
}

// ---- Actions ---------------------------------------------------------------------

/** Load the saved analysis (and live run status) for a project */
export async function loadCompetitors(projectId: string, options: { force?: boolean } = {}): Promise<void> {
  const store = useCompetitorStore.getState();
  if (!options.force && store.projectId === projectId && store.data) return;
  if (store.projectId !== projectId) {
    useCompetitorStore.setState({
      projectId,
      data: null,
      draftDirections: [],
      rankingDirty: false,
      isRunning: false,
      phase: null,
      error: null,
    });
  }
  useCompetitorStore.setState({ isLoading: true });
  try {
    const result = await window.electronAPI.getCompetitors(projectId);
    if (useCompetitorStore.getState().projectId !== projectId) return;
    if (result.success && result.data) {
      const { state, isRunning, phase } = result.data;
      applyServerState(state);
      useCompetitorStore.setState({
        isRunning,
        phase,
        focus: state?.focus ?? '',
        count: clampCompetitorCount(state?.competitorCount),
      });
    }
  } catch {
    // Treated as "no analysis yet"
  } finally {
    useCompetitorStore.setState({ isLoading: false });
  }
}

export function analyzeCompetitors(projectId: string): void {
  const { focus, count } = useCompetitorStore.getState();
  useCompetitorStore.setState({ isRunning: true, phase: 'discovering', error: null });
  window.electronAPI.analyzeCompetitors(projectId, { focus: focus.trim(), count });
}

export function stopCompetitors(projectId: string): void {
  window.electronAPI.stopCompetitors(projectId);
}

export function resynthesizeDirections(projectId: string): void {
  useCompetitorStore.setState({ isRunning: true, phase: 'synthesizing', error: null });
  window.electronAPI.resynthesizeDirections(projectId);
}

/** Pool deep-dive or card refresh */
export function profileCompetitor(projectId: string, competitorId: string): void {
  const { data } = useCompetitorStore.getState();
  const target = data?.competitors.find((c) => c.id === competitorId);
  if (target) applyProgressEvent({ kind: 'competitor', competitor: { ...target, status: 'running', error: undefined } });
  window.electronAPI.refreshCompetitor(projectId, competitorId);
}

export async function moveCompetitorToPool(projectId: string, competitorId: string): Promise<boolean> {
  const result = await window.electronAPI.moveCompetitorToPool(projectId, competitorId);
  if (result.success && result.data) applyServerState(result.data);
  return result.success;
}

/** Returns an error code/message, or null on success */
export async function addManualCompetitor(projectId: string, name: string, url: string): Promise<string | null> {
  const result = await window.electronAPI.addManualCompetitor(projectId, { name, url });
  if (result.success && result.data) {
    applyServerState(result.data);
    return null;
  }
  return result.error ?? 'unknown';
}

export async function saveDirectionRanking(projectId: string): Promise<boolean> {
  const { draftDirections } = useCompetitorStore.getState();
  useCompetitorStore.setState({ isSavingRanking: true });
  try {
    const result = await window.electronAPI.saveDirectionRanking(projectId, {
      order: draftDirections.map((d) => d.id),
      avoided: draftDirections.filter((d) => d.avoid).map((d) => d.id),
      notes: Object.fromEntries(draftDirections.map((d) => [d.id, d.note])),
    });
    if (result.success && result.data) {
      useCompetitorStore.setState({ rankingDirty: false });
      applyServerState(result.data);
      return true;
    }
    useCompetitorStore.setState({ error: result.error ?? null });
    return false;
  } finally {
    useCompetitorStore.setState({ isSavingRanking: false });
  }
}

/** Top pursued direction from a saved ranking (for "Guided by" chips) */
export function getTopDirection(data: CompetitorStrategyState | null): StrategicDirection | null {
  if (!data?.rankingSavedAt) return null;
  return data.directions.find((d) => !d.avoid) ?? null;
}

// ---- IPC listeners — set up while the Competitors page is mounted -----------------

export function setupCompetitorListeners(projectId: string): () => void {
  const unsubProgress = window.electronAPI.onCompetitorsProgress((pid, event) => {
    if (pid === projectId) applyProgressEvent(event);
  });
  const unsubComplete = window.electronAPI.onCompetitorsComplete((pid, payload) => {
    if (pid !== projectId) return;
    applyServerState(payload.state);
    useCompetitorStore.setState({ isRunning: false, phase: null });
  });
  const unsubError = window.electronAPI.onCompetitorsError((pid, error) => {
    if (pid !== projectId) return;
    useCompetitorStore.setState({ error, isRunning: false, phase: null });
  });
  return () => {
    unsubProgress();
    unsubComplete();
    unsubError();
  };
}

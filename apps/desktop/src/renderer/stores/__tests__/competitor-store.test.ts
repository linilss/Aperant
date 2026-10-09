import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyProgressEvent,
  applyServerState,
  getTopDirection,
  saveDirectionRanking,
  useCompetitorStore,
} from '../competitor-store';
import type { CompetitorStrategyState, StrategicDirection } from '../../../shared/types/competitors';

const dir = (id: string, overrides: Partial<StrategicDirection> = {}): StrategicDirection => ({
  id,
  title: id.toUpperCase(),
  description: '',
  occupiedBy: [],
  opportunity: '',
  fit: '',
  fitSources: [],
  risk: '',
  avoid: false,
  note: '',
  ...overrides,
});

const state = (directions: StrategicDirection[], rankingSavedAt: string | null = null): CompetitorStrategyState => ({
  projectName: 'P',
  projectType: '',
  targetAudience: '',
  focus: '',
  competitorCount: 5,
  analyzedAt: null,
  competitors: [],
  directions,
  directionsSynthesizedAt: null,
  directionsStale: false,
  rankingSavedAt,
});

describe('competitor store ranking draft', () => {
  beforeEach(() => {
    useCompetitorStore.setState({ projectId: 'p1', data: null, draftDirections: [], rankingDirty: false, error: null });
  });

  it('reorders, toggles avoid and edits notes locally, marking the draft dirty', () => {
    applyServerState(state([dir('a'), dir('b'), dir('c')]));
    const { moveDirection, toggleAvoid, setNote } = useCompetitorStore.getState();

    moveDirection(2, 0);
    toggleAvoid('b');
    setNote('a', 'note');

    const { draftDirections, rankingDirty } = useCompetitorStore.getState();
    expect(draftDirections.map((d) => d.id)).toEqual(['c', 'a', 'b']);
    expect(draftDirections.find((d) => d.id === 'b')?.avoid).toBe(true);
    expect(draftDirections.find((d) => d.id === 'a')?.note).toBe('note');
    expect(rankingDirty).toBe(true);
  });

  it('keeps unsaved edits across competitor progress, but resets them when directions are re-synthesized', () => {
    applyServerState(state([dir('a'), dir('b')]));
    useCompetitorStore.getState().moveDirection(1, 0);

    applyProgressEvent({ kind: 'state', state: state([dir('a'), dir('b')]) });
    expect(useCompetitorStore.getState().draftDirections.map((d) => d.id)).toEqual(['b', 'a']);

    applyProgressEvent({ kind: 'directions', directions: [dir('x'), dir('y')] });
    expect(useCompetitorStore.getState().draftDirections.map((d) => d.id)).toEqual(['x', 'y']);
    expect(useCompetitorStore.getState().rankingDirty).toBe(false);
  });

  it('saves the draft as order/avoided/notes', async () => {
    applyServerState(state([dir('a'), dir('b')]));
    useCompetitorStore.getState().moveDirection(1, 0);
    useCompetitorStore.getState().toggleAvoid('a');
    const saved = state([dir('b'), dir('a', { avoid: true })], '2026-10-09T00:00:00.000Z');
    const saveDirectionRankingApi = vi.fn().mockResolvedValue({ success: true, data: saved });
    vi.stubGlobal('window', { electronAPI: { saveDirectionRanking: saveDirectionRankingApi } });

    await saveDirectionRanking('p1');

    expect(saveDirectionRankingApi).toHaveBeenCalledWith('p1', {
      order: ['b', 'a'],
      avoided: ['a'],
      notes: { b: '', a: '' },
    });
    expect(useCompetitorStore.getState().rankingDirty).toBe(false);
    expect(getTopDirection(useCompetitorStore.getState().data)?.id).toBe('b');
    vi.unstubAllGlobals();
  });

  it('has no top direction until a ranking is saved', () => {
    expect(getTopDirection(state([dir('a')]))).toBeNull();
    expect(getTopDirection(state([dir('a', { avoid: true }), dir('b')], 'x'))?.id).toBe('b');
  });
});

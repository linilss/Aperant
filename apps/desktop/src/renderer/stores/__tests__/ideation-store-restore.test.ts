/**
 * Ideation store: restore a generation still running in main after a project switch
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Idea, IdeationRunStatus, IdeationSession } from '../../../shared/types';
import { useIdeationStore, loadIdeation, generateIdeation, setupIdeationListeners } from '../ideation-store';

type Listener = (...args: unknown[]) => void;
const listeners: Record<string, Listener> = {};
const listen = (name: string) =>
  vi.fn((cb: Listener) => {
    listeners[name] = cb;
    return () => {
      delete listeners[name];
    };
  });

const api = {
  getIdeation: vi.fn(),
  getIdeationStatus: vi.fn(),
  generateIdeation: vi.fn(),
  stopIdeation: vi.fn(async () => ({ success: true })),
  onIdeationProgress: listen('progress'),
  onIdeationLog: listen('log'),
  onIdeationTypeComplete: listen('typeComplete'),
  onIdeationTypeFailed: listen('typeFailed'),
  onIdeationComplete: listen('complete'),
  onIdeationError: listen('error'),
  onIdeationStopped: listen('stopped'),
};

function idea(id: string, type: Idea['type'] = 'features'): Idea {
  return { id, type, title: id, description: '', rationale: '', status: 'draft', createdAt: new Date() } as Idea;
}

function session(projectId: string, ideas: Idea[]): IdeationSession {
  return {
    id: `s-${projectId}`,
    projectId,
    config: {
      enabledTypes: ['features', 'code_quality'],
      includeRoadmapContext: true,
      includeKanbanContext: true,
      maxIdeasPerType: 5,
    },
    ideas,
    projectContext: { existingFeatures: [], techStack: [], plannedFeatures: [] },
    generatedAt: new Date(),
    updatedAt: new Date(),
  };
}

function runningStatus(overrides: Partial<IdeationRunStatus> = {}): IdeationRunStatus {
  return {
    isRunning: true,
    startedAt: '2026-10-12T10:00:00.000Z',
    append: false,
    enabledTypes: ['features', 'code_improvements', 'security_hardening'],
    status: { phase: 'generating', progress: 37, message: 'Generating code_improvements ideas...' },
    typeStates: { features: 'done', code_improvements: 'running', security_hardening: 'queued' },
    typeCounts: { features: 1 },
    ideasByType: { features: [idea('f-new')] },
    ...overrides,
  };
}

describe('ideation store: restore running generation', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    (window as unknown as { electronAPI: typeof api }).electronAPI = api;
    useIdeationStore.getState().setCurrentProjectId(null);
    api.getIdeation.mockResolvedValue({ success: true, data: null });
    api.getIdeationStatus.mockResolvedValue({ success: true, data: null });
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('shows the progress again when switching back to a project with a running generation', async () => {
    api.getIdeation.mockResolvedValue({ success: true, data: session('xr', [idea('f-old')]) });
    api.getIdeationStatus.mockResolvedValue({ success: true, data: runningStatus() });

    await loadIdeation('xr');

    const state = useIdeationStore.getState();
    expect(api.getIdeationStatus).toHaveBeenCalledWith('xr');
    expect(state.isGenerating).toBe(true);
    expect(state.generationStatus).toMatchObject({ phase: 'generating', progress: 37 });
    expect(state.config.enabledTypes).toEqual(['features', 'code_improvements', 'security_hardening']);
    expect(state.typeStates).toMatchObject({
      features: 'completed',
      code_improvements: 'generating',
      security_hardening: 'generating',
      code_quality: 'pending',
    });
    // A full run replaces the old ideas; the finished type's ideas are already there
    expect(state.session?.ideas.map((i) => i.id)).toEqual(['f-new']);
  });

  it('an append run keeps the saved ideas and adds the finished types', async () => {
    api.getIdeation.mockResolvedValue({ success: true, data: session('xr', [idea('cq-old', 'code_quality')]) });
    api.getIdeationStatus.mockResolvedValue({
      success: true,
      data: runningStatus({ append: true, enabledTypes: ['features'], typeStates: { features: 'done' } }),
    });

    await loadIdeation('xr');

    const state = useIdeationStore.getState();
    expect(state.isGenerating).toBe(true);
    expect(state.config.enabledTypes).toEqual(['features', 'code_quality']);
    expect(state.session?.ideas.map((i) => i.id).sort()).toEqual(['cq-old', 'f-new']);
  });

  it('loads the saved session normally when nothing is running', async () => {
    api.getIdeation.mockResolvedValue({ success: true, data: session('xr', [idea('f-old')]) });

    await loadIdeation('xr');

    const state = useIdeationStore.getState();
    expect(state.isGenerating).toBe(false);
    expect(state.session?.ideas.map((i) => i.id)).toEqual(['f-old']);
  });

  it('drops a status that arrives after the user switched project again', async () => {
    let resolveStatus: (v: unknown) => void = () => undefined;
    api.getIdeationStatus.mockReturnValueOnce(new Promise((r) => (resolveStatus = r)));

    const loading = loadIdeation('xr');
    await vi.waitFor(() => expect(api.getIdeationStatus).toHaveBeenCalled());
    useIdeationStore.getState().setCurrentProjectId('lawner');
    resolveStatus({ success: true, data: runningStatus() });
    await loading;

    expect(useIdeationStore.getState().currentProjectId).toBe('lawner');
    expect(useIdeationStore.getState().isGenerating).toBe(false);
  });

  it('leaves the progress screen when the run ended while the view was closed', async () => {
    useIdeationStore.getState().setCurrentProjectId('xr');
    generateIdeation('xr');
    expect(useIdeationStore.getState().isGenerating).toBe(true);
    api.getIdeation.mockResolvedValue({ success: true, data: session('xr', [idea('f-final')]) });

    // Same project, view re-opened; main has no running generation any more
    await loadIdeation('xr');

    const state = useIdeationStore.getState();
    expect(state.isGenerating).toBe(false);
    expect(state.session?.ideas.map((i) => i.id)).toEqual(['f-final']);
  });

  it('events for another project do not touch the current one, and switching back restores it', async () => {
    cleanup = setupIdeationListeners();
    api.getIdeation.mockResolvedValue({ success: true, data: session('lawner', [idea('l-1')]) });
    await loadIdeation('lawner');

    // XR's run keeps streaming while Lawner is on screen
    listeners.progress('xr', { phase: 'generating', progress: 50, message: 'xr' });
    listeners.typeComplete('xr', 'features', [idea('xr-f')]);
    listeners.typeFailed('xr', 'code_improvements');
    listeners.error('xr', 'boom');
    listeners.complete('xr', session('xr', [idea('xr-f')]));

    let state = useIdeationStore.getState();
    expect(state.isGenerating).toBe(false);
    expect(state.generationStatus.phase).toBe('idle');
    expect(state.session?.ideas.map((i) => i.id)).toEqual(['l-1']);
    expect(state.typeStates.code_improvements).toBe('pending');

    // Back to XR: main still reports the run, with the latest progress
    api.getIdeation.mockResolvedValue({ success: true, data: null });
    api.getIdeationStatus.mockResolvedValue({ success: true, data: runningStatus() });
    await loadIdeation('xr');

    state = useIdeationStore.getState();
    expect(state.isGenerating).toBe(true);
    expect(state.generationStatus.progress).toBe(37);

    // Live events for XR apply on top of the restored state
    listeners.typeComplete('xr', 'code_improvements', [idea('xr-ci', 'code_improvements')]);
    state = useIdeationStore.getState();
    expect(state.typeStates.code_improvements).toBe('completed');
    expect(state.session?.ideas.map((i) => i.id)).toEqual(['f-new', 'xr-ci']);
  });
});

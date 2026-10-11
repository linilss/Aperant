/**
 * Ideation store: per-project config (types, focus) restore and hand-off to IPC
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IdeationConfig, IdeationSession } from '../../../shared/types';
import { DEFAULT_IDEATION_CONFIG } from '../../../shared/constants';
import { useIdeationStore, loadIdeation, generateIdeation, refreshIdeation } from '../ideation-store';

const api = {
  getIdeation: vi.fn(),
  generateIdeation: vi.fn(),
  refreshIdeation: vi.fn(),
  stopIdeation: vi.fn(async () => ({ success: true })),
};

function session(config: Partial<IdeationConfig>): IdeationSession {
  return {
    id: 's1',
    projectId: 'p1',
    config: {
      enabledTypes: ['features'],
      includeRoadmapContext: true,
      includeKanbanContext: true,
      maxIdeasPerType: 5,
      ...config,
    },
    ideas: [],
    projectContext: { existingFeatures: [], techStack: [], plannedFeatures: [] },
    generatedAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('ideation store config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as unknown as { electronAPI: typeof api }).electronAPI = api;
    useIdeationStore.getState().setCurrentProjectId(null);
    useIdeationStore.setState({ isGenerating: false });
  });

  it('starts with features enabled first', () => {
    expect(useIdeationStore.getState().config.enabledTypes).toEqual([...DEFAULT_IDEATION_CONFIG.enabledTypes]);
    expect(useIdeationStore.getState().config.enabledTypes[0]).toBe('features');
  });

  it('restores the saved types and focus when a project loads', async () => {
    api.getIdeation.mockResolvedValue({
      success: true,
      data: session({ enabledTypes: ['features', 'code_quality'], focus: 'offline play', includeKanbanContext: false }),
    });

    await loadIdeation('p1');

    expect(useIdeationStore.getState().config).toMatchObject({
      enabledTypes: ['features', 'code_quality'],
      includeKanbanContext: false,
      focus: 'offline play',
    });
  });

  it('does not carry one project focus over to another without a session', async () => {
    useIdeationStore.getState().setCurrentProjectId('p1');
    useIdeationStore.getState().setConfig({ focus: 'p1 focus' });
    api.getIdeation.mockResolvedValue({ success: true, data: null });

    await loadIdeation('p2');

    expect(useIdeationStore.getState().config.focus).toBeUndefined();
  });

  it('sends the focus with generate and refresh', async () => {
    useIdeationStore.getState().setCurrentProjectId('p1');
    useIdeationStore.getState().setConfig({ focus: 'keep kids playing' });

    generateIdeation('p1');
    expect(api.generateIdeation).toHaveBeenCalledWith('p1', expect.objectContaining({ focus: 'keep kids playing' }));

    await refreshIdeation('p1');
    expect(api.refreshIdeation).toHaveBeenCalledWith('p1', expect.objectContaining({ focus: 'keep kids playing' }));
  });
});

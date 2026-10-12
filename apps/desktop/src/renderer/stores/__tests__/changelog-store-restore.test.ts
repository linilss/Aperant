/**
 * Changelog store: generation state is per project and restored from main
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangelogRunStatus } from '../../../shared/types';
import {
  useChangelogStore,
  handleGenerationProgressEvent,
  handleGenerationCompleteEvent,
  handleGenerationErrorEvent,
  restoreGenerationStatus,
  dismissGenerationStatus
} from '../changelog-store';

const api = {
  getChangelogStatus: vi.fn(),
  clearChangelogStatus: vi.fn(async () => ({ success: true }))
};

const result = { success: true, changelog: '## 1.2.0\n- Added X', version: '1.2.0', tasksIncluded: 1 };

function status(overrides: Partial<ChangelogRunStatus>): ChangelogRunStatus {
  return {
    state: 'running',
    sourceMode: 'git-history',
    version: '1.2.0',
    progress: { stage: 'generating', progress: 30, message: 'Generating changelog with AI...' },
    ...overrides
  };
}

describe('changelog store: per-project generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as unknown as { electronAPI: typeof api }).electronAPI = api;
    useChangelogStore.getState().setCurrentProjectId(null);
    useChangelogStore.getState().reset();
    api.getChangelogStatus.mockResolvedValue({ success: true, data: null });
  });

  it('ignores generation events of another project', () => {
    useChangelogStore.getState().setCurrentProjectId('B');

    handleGenerationProgressEvent('A', { stage: 'generating', progress: 30, message: 'x' });
    handleGenerationCompleteEvent('A', result);
    handleGenerationErrorEvent('A', 'boom');

    const s = useChangelogStore.getState();
    expect(s.generationProgress).toBeNull();
    expect(s.generatedChangelog).toBe('');
    expect(s.error).toBeNull();
    expect(s.isGenerating).toBe(false);
  });

  it('applies events of the project on screen', () => {
    useChangelogStore.getState().setCurrentProjectId('A');
    useChangelogStore.getState().setIsGenerating(true);

    handleGenerationCompleteEvent('A', result);

    const s = useChangelogStore.getState();
    expect(s.isGenerating).toBe(false);
    expect(s.generatedChangelog).toBe(result.changelog);
  });

  it('switching project drops the previous project spinner', () => {
    useChangelogStore.getState().setCurrentProjectId('A');
    useChangelogStore.getState().setIsGenerating(true);
    useChangelogStore.getState().setGenerationProgress({ stage: 'generating', progress: 30, message: 'x' });

    useChangelogStore.getState().setCurrentProjectId('B');

    const s = useChangelogStore.getState();
    expect(s.isGenerating).toBe(false);
    expect(s.generationProgress).toBeNull();
  });

  it('restores a running generation on project load', async () => {
    useChangelogStore.getState().setCurrentProjectId('A');
    api.getChangelogStatus.mockResolvedValue({ success: true, data: status({}) });

    const run = await restoreGenerationStatus('A');

    expect(api.getChangelogStatus).toHaveBeenCalledWith('A');
    expect(run?.state).toBe('running');
    const s = useChangelogStore.getState();
    expect(s.isGenerating).toBe(true);
    expect(s.generationProgress).toMatchObject({ stage: 'generating', progress: 30 });
    expect(s.sourceMode).toBe('git-history');
  });

  it('restores a result that finished while another project was shown', async () => {
    // A was generating, user switched to B; A's complete event arrives and is ignored
    useChangelogStore.getState().setCurrentProjectId('A');
    useChangelogStore.getState().setIsGenerating(true);
    useChangelogStore.getState().setCurrentProjectId('B');
    handleGenerationCompleteEvent('A', result);
    expect(useChangelogStore.getState().generatedChangelog).toBe('');

    // Back to A: main still has the result
    useChangelogStore.getState().setCurrentProjectId('A');
    api.getChangelogStatus.mockResolvedValue({ success: true, data: status({ state: 'done', result }) });
    await restoreGenerationStatus('A');

    const s = useChangelogStore.getState();
    expect(s.isGenerating).toBe(false);
    expect(s.generatedChangelog).toBe(result.changelog);
    expect(s.version).toBe('1.2.0');
    expect(s.generationProgress?.stage).toBe('complete');
  });

  it('restores an error', async () => {
    useChangelogStore.getState().setCurrentProjectId('A');
    api.getChangelogStatus.mockResolvedValue({ success: true, data: status({ state: 'error', error: 'boom' }) });

    await restoreGenerationStatus('A');

    const s = useChangelogStore.getState();
    expect(s.isGenerating).toBe(false);
    expect(s.error).toBe('boom');
  });

  it('nothing tracked: no spinner', async () => {
    useChangelogStore.getState().setCurrentProjectId('B');

    expect(await restoreGenerationStatus('B')).toBeNull();
    expect(useChangelogStore.getState().isGenerating).toBe(false);
  });

  it('ignores a status that arrives after switching to another project', async () => {
    useChangelogStore.getState().setCurrentProjectId('A');
    let resolve!: (v: unknown) => void;
    api.getChangelogStatus.mockReturnValue(new Promise((r) => { resolve = r; }));

    const pending = restoreGenerationStatus('A');
    useChangelogStore.getState().setCurrentProjectId('B');
    resolve({ success: true, data: status({}) });

    expect(await pending).toBeNull();
    expect(useChangelogStore.getState().isGenerating).toBe(false);
  });

  it('does not overwrite an edited result of the project already on screen', async () => {
    useChangelogStore.getState().setCurrentProjectId('A');
    useChangelogStore.getState().updateGeneratedChangelog('edited');
    api.getChangelogStatus.mockResolvedValue({ success: true, data: status({ state: 'done', result }) });

    await restoreGenerationStatus('A');

    expect(useChangelogStore.getState().generatedChangelog).toBe('edited');
  });

  it('dismiss clears the status in main', async () => {
    await dismissGenerationStatus('A');
    expect(api.clearChangelogStatus).toHaveBeenCalledWith('A');
  });
});

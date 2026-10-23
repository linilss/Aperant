import { describe, expect, it } from 'vitest';
import { ChangelogRunTracker } from '../changelog-run-tracker';

const result = { success: true, changelog: '## 1.2.0\n- Added X', version: '1.2.0', tasksIncluded: 2 };

describe('ChangelogRunTracker', () => {
  it('tracks a running generation with its latest progress', () => {
    const tracker = new ChangelogRunTracker();
    const token = {};
    tracker.start('A', token, { sourceMode: 'tasks', version: '1.2.0' });
    tracker.progress('A', token, { stage: 'generating', progress: 30, message: 'Generating' });

    expect(tracker.get('A')).toEqual({
      state: 'running',
      sourceMode: 'tasks',
      version: '1.2.0',
      progress: { stage: 'generating', progress: 30, message: 'Generating' },
    });
  });

  it('keeps a finished result until it is cleared', () => {
    const tracker = new ChangelogRunTracker();
    const token = {};
    tracker.start('A', token, { sourceMode: 'tasks', version: '1.2.0' });
    tracker.complete('A', token, result);

    // Fetching does not consume it (desktop and phone may both be showing the project)
    expect(tracker.get('A')?.state).toBe('done');
    expect(tracker.get('A')?.result).toEqual(result);

    tracker.clear('A');
    expect(tracker.get('A')).toBeNull();
  });

  it('keeps an error until it is cleared', () => {
    const tracker = new ChangelogRunTracker();
    const token = {};
    tracker.start('A', token, { sourceMode: 'git-history', version: '2.0.0' });
    tracker.fail('A', token, 'boom');

    expect(tracker.get('A')).toMatchObject({ state: 'error', error: 'boom', progress: { stage: 'error' } });
    tracker.clear('A');
    expect(tracker.get('A')).toBeNull();
  });

  it('does not clear a run that is still going', () => {
    const tracker = new ChangelogRunTracker();
    tracker.start('A', {}, { sourceMode: 'tasks', version: '1.0.0' });
    tracker.clear('A');
    expect(tracker.get('A')?.state).toBe('running');
  });

  it('keeps projects apart', () => {
    const tracker = new ChangelogRunTracker();
    const a = {};
    const b = {};
    tracker.start('A', a, { sourceMode: 'tasks', version: '1.0.0' });
    tracker.start('B', b, { sourceMode: 'tasks', version: '3.0.0' });
    tracker.complete('A', a, result);

    expect(tracker.get('A')?.state).toBe('done');
    expect(tracker.get('B')?.state).toBe('running');
    tracker.clear('A');
    expect(tracker.get('B')?.state).toBe('running');
  });

  it('ignores updates from a run that was replaced', () => {
    const tracker = new ChangelogRunTracker();
    const oldRun = {};
    const newRun = {};
    tracker.start('A', oldRun, { sourceMode: 'tasks', version: '1.0.0' });
    tracker.start('A', newRun, { sourceMode: 'tasks', version: '1.1.0' });
    tracker.complete('A', oldRun, result);

    expect(tracker.get('A')).toMatchObject({ state: 'running', version: '1.1.0' });
  });
});

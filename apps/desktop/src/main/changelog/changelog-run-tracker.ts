import type {
  ChangelogGenerationProgress,
  ChangelogGenerationResult,
  ChangelogRunStatus,
  ChangelogSourceMode,
} from '../../shared/types';

interface TrackedRun {
  /** Identifies the run so a superseded run cannot touch its successor's state */
  token: object;
  status: ChangelogRunStatus;
}

/**
 * In-memory state of changelog generations, per project.
 *
 * The renderer only shows one project, so after a project switch (or when the
 * changelog view was closed) it asks main (changelog:getStatus) for this snapshot
 * to restore the spinner, the finished changelog or the error. A finished run
 * stays here until the renderer clears it (changelog:clearStatus) or a new run
 * for the same project replaces it. Updates from a replaced run are ignored.
 */
export class ChangelogRunTracker {
  private runs = new Map<string, TrackedRun>();

  start(
    projectId: string,
    token: object,
    options: { sourceMode: ChangelogSourceMode; version: string }
  ): void {
    this.runs.set(projectId, {
      token,
      status: {
        state: 'running',
        sourceMode: options.sourceMode,
        version: options.version,
        progress: { stage: 'loading_specs', progress: 0, message: '' },
      },
    });
  }

  progress(projectId: string, token: object, progress: ChangelogGenerationProgress): void {
    const run = this.current(projectId, token);
    if (run?.state === 'running') run.progress = { ...progress };
  }

  complete(projectId: string, token: object, result: ChangelogGenerationResult): void {
    const run = this.current(projectId, token);
    if (!run) return;
    run.state = 'done';
    run.result = { ...result };
    run.progress = { stage: 'complete', progress: 100, message: run.progress.message };
  }

  fail(projectId: string, token: object, error: string): void {
    const run = this.current(projectId, token);
    if (!run) return;
    run.state = 'error';
    run.error = error;
    run.progress = { stage: 'error', progress: 0, message: error, error };
  }

  get(projectId: string): ChangelogRunStatus | null {
    const tracked = this.runs.get(projectId);
    if (!tracked) return null;
    const s = tracked.status;
    return {
      ...s,
      progress: { ...s.progress },
      ...(s.result ? { result: { ...s.result } } : {}),
    };
  }

  /** Forget a finished run once the renderer has dismissed it. A running one is kept. */
  clear(projectId: string): void {
    if (this.runs.get(projectId)?.status.state === 'running') return;
    this.runs.delete(projectId);
  }

  private current(projectId: string, token: object): ChangelogRunStatus | null {
    const tracked = this.runs.get(projectId);
    return tracked && tracked.token === token ? tracked.status : null;
  }
}

export const changelogRunTracker = new ChangelogRunTracker();

import type {
  Idea,
  IdeationGenerationStatus,
  IdeationRunStatus,
  IdeationType,
} from '../../shared/types';

interface TrackedRun {
  /** Identifies the run so a superseded run cannot touch its successor's state */
  token: object;
  status: IdeationRunStatus;
}

/**
 * In-memory state of ideation runs, per project.
 *
 * The renderer only keeps progress for the project it shows, so after a project
 * switch it asks main (ideation:getStatus) for this snapshot to restore the UI.
 * Every update takes the run's token; updates from a run that was replaced by a
 * newer one for the same project are ignored.
 */
export class IdeationRunTracker {
  private runs = new Map<string, TrackedRun>();

  start(
    projectId: string,
    token: object,
    options: { enabledTypes: IdeationType[]; append: boolean },
    now: Date = new Date()
  ): void {
    const typeStates: IdeationRunStatus['typeStates'] = {};
    for (const type of options.enabledTypes) typeStates[type] = 'queued';
    this.runs.set(projectId, {
      token,
      status: {
        isRunning: true,
        startedAt: now.toISOString(),
        append: options.append,
        enabledTypes: [...options.enabledTypes],
        status: { phase: 'analyzing', progress: 0, message: '' },
        typeStates,
        typeCounts: {},
        ideasByType: {},
      },
    });
  }

  progress(projectId: string, token: object, status: IdeationGenerationStatus): void {
    const run = this.current(projectId, token);
    if (!run) return;
    run.status = {
      phase: status.phase,
      progress: status.progress,
      message: status.message,
      ...(status.currentType ? { currentType: status.currentType } : {}),
    };
  }

  typeStarted(projectId: string, token: object, type: IdeationType): void {
    const run = this.current(projectId, token);
    if (run) run.typeStates[type] = 'running';
  }

  typeComplete(projectId: string, token: object, type: IdeationType, ideas: Idea[]): void {
    const run = this.current(projectId, token);
    if (!run) return;
    run.typeStates[type] = 'done';
    run.typeCounts[type] = ideas.length;
    run.ideasByType[type] = ideas;
  }

  typeFailed(projectId: string, token: object, type: IdeationType): void {
    const run = this.current(projectId, token);
    if (run) run.typeStates[type] = 'failed';
  }

  /** Run ended (complete, error or stopped). Without a token, clears whatever run is tracked. */
  finish(projectId: string, token?: object): void {
    const tracked = this.runs.get(projectId);
    if (!tracked) return;
    if (token && tracked.token !== token) return;
    this.runs.delete(projectId);
  }

  get(projectId: string): IdeationRunStatus | null {
    const tracked = this.runs.get(projectId);
    if (!tracked) return null;
    const s = tracked.status;
    return {
      ...s,
      enabledTypes: [...s.enabledTypes],
      status: { ...s.status },
      typeStates: { ...s.typeStates },
      typeCounts: { ...s.typeCounts },
      ideasByType: { ...s.ideasByType },
    };
  }

  private current(projectId: string, token: object): IdeationRunStatus | null {
    const tracked = this.runs.get(projectId);
    return tracked && tracked.token === token ? tracked.status : null;
  }
}

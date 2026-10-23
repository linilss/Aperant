import type { RefineRunStatus } from '../../../shared/types';

/** The part of RefineOrchestrator the registry needs */
export interface RefineRun {
  start(): Promise<void>;
  stop(): void;
  isActive(): boolean;
  getStatus(): RefineRunStatus;
}

/**
 * Refine runs per task, in main.
 *
 * Starting is idempotent: while a task's run is active, another start (e.g. a
 * reopened task dialog) returns that run instead of stopping and respawning it.
 */
export class RefineRunRegistry<T extends RefineRun = RefineRun> {
  private runs = new Map<string, T>();

  start(taskId: string, create: () => T): { run: T; started: boolean } {
    const existing = this.runs.get(taskId);
    if (existing?.isActive()) return { run: existing, started: false };
    existing?.stop();
    const run = create();
    this.runs.set(taskId, run);
    void run.start();
    return { run, started: true };
  }

  get(taskId: string): T | undefined {
    return this.runs.get(taskId);
  }

  /** Status of the task's latest run, or null when it has none */
  getStatus(taskId: string): RefineRunStatus | null {
    return this.runs.get(taskId)?.getStatus() ?? null;
  }

  /** Stop and forget the task's run */
  stop(taskId: string): void {
    this.runs.get(taskId)?.stop();
    this.runs.delete(taskId);
  }
}

import { create } from 'zustand';
import type { Task } from '../../shared/types';

export type TaskDeployStage = 'merging' | 'deploying';

/** Progress of a "merge all + deploy" run for a project */
export interface DeployBatchProgress {
  step: 'merging' | 'verifying' | 'deploying';
  /** 1-based task being merged */
  index: number;
  total: number;
}

/**
 * Which task's Deploy dialog is open (the dialog itself is mounted once in App), and
 * which tasks are mid one-click deploy. The runner is registered by the mounted dialog,
 * since only App can open the agent terminal the script runs in.
 */
interface DeployDialogState {
  task: Task | null;
  openForTask: (task: Task) => void;
  close: () => void;

  /** taskId → current step of a one-click deploy */
  inFlight: Record<string, TaskDeployStage>;
  setStage: (taskId: string, stage: TaskDeployStage | null) => void;
  runner: ((task: Task) => Promise<void>) | null;
  setRunner: (runner: ((task: Task) => Promise<void>) | null) => void;
  /** One-click deploy: merge if needed, then run the project's deploy script (falls back to the dialog) */
  deployTask: (task: Task) => void;

  /** projectId → running batch */
  batches: Record<string, DeployBatchProgress>;
  setBatch: (projectId: string, progress: DeployBatchProgress | null) => void;
  batchRunner: ((tasks: Task[]) => Promise<void>) | null;
  setBatchRunner: (runner: ((tasks: Task[]) => Promise<void>) | null) => void;
  /** Merge all tasks oldest first, verify (AI fixes collisions), then deploy once */
  deployAll: (tasks: Task[]) => void;
}

export const useDeployDialogStore = create<DeployDialogState>((set, get) => ({
  task: null,
  openForTask: (task) => set({ task }),
  close: () => set({ task: null }),

  inFlight: {},
  setStage: (taskId, stage) =>
    set((s) => {
      const inFlight = { ...s.inFlight };
      if (stage) inFlight[taskId] = stage;
      else delete inFlight[taskId];
      return { inFlight };
    }),
  runner: null,
  setRunner: (runner) => set({ runner }),
  deployTask: (task) => {
    const { runner, inFlight } = get();
    if (inFlight[task.id]) return;
    if (runner) void runner(task);
    else set({ task });
  },

  batches: {},
  setBatch: (projectId, progress) =>
    set((s) => {
      const batches = { ...s.batches };
      if (progress) batches[projectId] = progress;
      else delete batches[projectId];
      return { batches };
    }),
  batchRunner: null,
  setBatchRunner: (batchRunner) => set({ batchRunner }),
  deployAll: (tasks) => {
    const { batchRunner, batches } = get();
    if (tasks.length === 0 || batches[tasks[0].projectId] || !batchRunner) return;
    void batchRunner(tasks);
  }
}));

import { create } from 'zustand';
import type { Task } from '../../shared/types';

export type TaskDeployStage = 'merging' | 'deploying';

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
  }
}));

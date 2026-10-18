import { create } from 'zustand';

/** Tasks asked to stop after their current subtask (cleared when they stop) */
interface SafeStopState {
  pending: Record<string, true>;
  request: (taskId: string) => void;
  clear: (taskId: string) => void;
}

export const useSafeStopStore = create<SafeStopState>((set) => ({
  pending: {},
  request: (taskId) => {
    window.electronAPI.stopTaskSafe(taskId);
    set((s) => ({ pending: { ...s.pending, [taskId]: true } }));
  },
  clear: (taskId) =>
    set((s) => {
      if (!s.pending[taskId]) return s;
      const { [taskId]: _done, ...pending } = s.pending;
      return { pending };
    }),
}));

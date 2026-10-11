import { create } from 'zustand';
import type { Task } from '../../shared/types';

/** Which task's Deploy dialog is open (the dialog itself is mounted once in App). */
interface DeployDialogState {
  task: Task | null;
  openForTask: (task: Task) => void;
  close: () => void;
}

export const useDeployDialogStore = create<DeployDialogState>((set) => ({
  task: null,
  openForTask: (task) => set({ task }),
  close: () => set({ task: null })
}));

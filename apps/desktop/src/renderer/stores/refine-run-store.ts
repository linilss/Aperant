import { create } from 'zustand';

/** Refine pipelines running in main, by task id → label of the current phase */
interface RefineRunState {
  runs: Record<string, string>;
  setRun: (taskId: string, phaseLabel: string | null) => void;
}

export const useRefineRunStore = create<RefineRunState>((set) => ({
  runs: {},
  setRun: (taskId, phaseLabel) =>
    set((s) => {
      const runs = { ...s.runs };
      if (phaseLabel === null) delete runs[taskId];
      else runs[taskId] = phaseLabel;
      return { runs };
    }),
}));

/** Current phase label while the run is going; null once no phase is active or pending */
export function refinePhaseLabel(phases: Array<{ label: string; status: string }>): string | null {
  const current = phases.find((p) => p.status === 'active') ?? phases.find((p) => p.status === 'pending');
  return current?.label ?? null;
}

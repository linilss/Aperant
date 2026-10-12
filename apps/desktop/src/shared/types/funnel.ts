/** The plan funnel's steps, in order (Understand → Plan) */
export const FUNNEL_STEP_IDS = ['coreValues', 'context', 'design', 'competitors', 'roadmap', 'ideation'] as const;

export type FunnelStepId = (typeof FUNNEL_STEP_IDS)[number];

export interface FunnelStep {
  id: FunnelStepId;
  done: boolean;
  /** Short machine-ish detail, e.g. a count ("12") or a name; shown next to the step */
  detail?: string;
}

export interface FunnelProgress {
  steps: FunnelStep[];
  completed: number;
  total: number;
}

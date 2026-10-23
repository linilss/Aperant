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

/** What a project is doing right now (project tabs and the project list) */
export interface ProjectActivity {
  /** Tasks building or in AI review */
  running: number;
  /** Tasks waiting for the user: Human Review (plan approval, errors, done), Pending merge */
  needsYou: number;
  /** Merges running now */
  merging?: number;
  /** A deploy is running */
  deploying?: boolean;
}

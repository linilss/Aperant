/**
 * Competitor analysis page types (Plan → Competitors).
 *
 * Persisted as `.malvy/roadmap/competitor_analysis.json` (competitor profiles,
 * snake_case, compatible with the roadmap's CompetitorAnalysis reader) and
 * `.malvy/roadmap/strategy.json` (synthesized directions + the user's ranking).
 */

import type { CompetitorPainPoint, CompetitorRelevance, CompetitorSource } from './roadmap';

/** Bounds and default for how many competitors one run looks for */
export const COMPETITOR_COUNT_MIN = 3;
export const COMPETITOR_COUNT_MAX = 10;
export const COMPETITOR_COUNT_DEFAULT = 5;

/** Clamp a requested competitor count to [3, 10]; non-numbers give the default */
export function clampCompetitorCount(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : COMPETITOR_COUNT_DEFAULT;
  return Math.min(COMPETITOR_COUNT_MAX, Math.max(COMPETITOR_COUNT_MIN, n));
}

/** Upper bound on the discovered pool (bounds the cheap discover pass) */
export const COMPETITOR_POOL_MAX = 30;

/**
 * idle = in the pool, never profiled; queued/running = profile pass pending/in
 * flight; done = profiled; error = last profile pass failed.
 */
export type CompetitorProfileStatus = 'idle' | 'queued' | 'running' | 'done' | 'error';

export interface CompetitorProfile {
  id: string;
  name: string;
  url: string;
  /** Short line from the discover pass */
  oneLiner: string;
  /** Relevance 0–100 from the discover pass (manual entries default high) */
  relevanceScore: number;
  /**
   * In the analyzed set (cards, feeds directions) vs. the pool (compact rows).
   * A pool item being deep-dived stays in the pool until its profile is done.
   */
  analyzed: boolean;
  positioning: string;
  targetAudience: string;
  keyFeatures: string[];
  /** Public pricing model, or '' when unknown */
  pricingModel: string;
  strengths: string[];
  weaknesses: string[];
  differentiator: string;
  relevance: CompetitorRelevance;
  painPoints: CompetitorPainPoint[];
  source: CompetitorSource;
  status: CompetitorProfileStatus;
  error?: string;
  profiledAt?: string;
}

export interface StrategicDirection {
  id: string;
  title: string;
  description: string;
  /** Names of the competitors already occupying this direction */
  occupiedBy: string[];
  /** Gap / opportunity left open */
  opportunity: string;
  /** Fit with the project's current state */
  fit: string;
  /** Docs the fit assessment cites (project-relative paths) */
  fitSources: string[];
  risk: string;
  /** How the direction aligns with the project's core values ('' when none are set) */
  valuesFit: string;
  /** The direction conflicts with the core values (sorted last, suggested Avoid) */
  conflictsWithValues: boolean;
  /** User marked this direction as one to steer away from */
  avoid: boolean;
  /** Short user note */
  note: string;
}

export interface CompetitorStrategyState {
  projectName: string;
  projectType: string;
  targetAudience: string;
  /** Free-text focus that steered the last run */
  focus: string;
  /** Slider value: how many top-relevance competitors get profiled (3–10) */
  competitorCount: number;
  /** When the last full analysis finished (ISO) */
  analyzedAt: string | null;
  /** Analyzed set and pool together; split by `analyzed` */
  competitors: CompetitorProfile[];
  /** Directions in the user's ranked order */
  directions: StrategicDirection[];
  directionsSynthesizedAt: string | null;
  directionsError?: string;
  /** The analyzed set changed since directions were synthesized */
  directionsStale: boolean;
  /** When the user last saved a ranking; null = directions are still in AI order */
  rankingSavedAt: string | null;
}

export interface DirectionRankingInput {
  /** Direction ids, best first */
  order: string[];
  /** Direction ids marked "Avoid" */
  avoided: string[];
  /** Per-direction notes keyed by id */
  notes: Record<string, string>;
}

export interface CompetitorAnalyzeOptions {
  focus?: string;
  /** How many top-relevance competitors to profile (clamped to 3–10, default 5) */
  count?: number;
}

export interface ManualCompetitorPoolInput {
  name: string;
  url?: string;
}

export type CompetitorRunPhase = 'discovering' | 'profiling' | 'synthesizing';

/** Live progress streamed while a run is in flight */
export type CompetitorProgressEvent =
  | { kind: 'phase'; phase: CompetitorRunPhase }
  /** Discovered pool + selected analyzed set; replaces the competitor list */
  | { kind: 'competitors'; competitors: CompetitorProfile[] }
  /** One competitor's status changed or its profile finished */
  | { kind: 'competitor'; competitor: CompetitorProfile }
  | { kind: 'directions'; directions: StrategicDirection[] }
  /** Full state after a non-AI change (remove to pool, manual add) */
  | { kind: 'state'; state: CompetitorStrategyState };

export interface CompetitorGetResult {
  state: CompetitorStrategyState | null;
  /** A full analysis or resynthesis is running */
  isRunning: boolean;
  phase: CompetitorRunPhase | null;
}

export interface CompetitorCompletePayload {
  state: CompetitorStrategyState;
  /** The user stopped the run; state holds whatever finished */
  stopped: boolean;
}

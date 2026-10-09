/**
 * Competitor analysis persistence.
 *
 * - `.malvy/roadmap/competitor_analysis.json` — profiles, snake_case. Keeps every
 *   field the roadmap reader (roadmap-handlers ROADMAP_GET) and features phase use
 *   (competitors[].pain_points ids, market_gaps, insights_summary, created_at).
 * - `.malvy/roadmap/strategy.json` — synthesized directions in ranked order.
 *
 * Writes stay under `<project>/.malvy/` (invisible mode).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { safeParseJson } from '../../../utils/json-repair';
import {
  type CompetitorProfile,
  type CompetitorProfileStatus,
  type CompetitorStrategyState,
  type DirectionRankingInput,
  type StrategicDirection,
  clampCompetitorCount,
} from '../../../../shared/types/competitors';
import type { CompetitorPainPoint, CompetitorRelevance } from '../../../../shared/types/roadmap';

export const COMPETITOR_FILE = 'competitor_analysis.json';
export const STRATEGY_FILE = 'strategy.json';
/** An analysis older than this is re-run by the roadmap instead of reused */
export const COMPETITOR_ANALYSIS_MAX_AGE_DAYS = 30;

export const roadmapDir = (projectDir: string) => join(projectDir, '.malvy', 'roadmap');
export const competitorFilePath = (projectDir: string) => join(roadmapDir(projectDir), COMPETITOR_FILE);
export const strategyFilePath = (projectDir: string) => join(roadmapDir(projectDir), STRATEGY_FILE);

// =============================================================================
// Small normalizers
// =============================================================================

type Raw = Record<string, unknown>;

export const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
export const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean) : [];
const level = (v: unknown, fallback: CompetitorRelevance = 'medium'): CompetitorRelevance =>
  v === 'high' || v === 'medium' || v === 'low' ? v : fallback;

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'item'
  );
}

/** `${prefix}-${slug}` unique within `taken` (mutated) */
export function uniqueId(prefix: string, text: string, taken: Set<string>): string {
  const base = `${prefix}-${slugify(text)}`;
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  taken.add(id);
  return id;
}

function readJson(path: string): Raw | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = safeParseJson<unknown>(readFileSync(path, 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Raw) : null;
  } catch {
    return null;
  }
}

function writeJsonAtomic(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmp, path);
}

// =============================================================================
// Raw → state
// =============================================================================

function normalizePainPoints(raw: unknown, competitorId: string): CompetitorPainPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Raw => !!p && typeof p === 'object')
    .map((p, i) => ({
      id: str(p.id) || `${competitorId}-pain-${i + 1}`,
      description: str(p.description),
      source: str(p.source),
      severity: level(p.severity),
      frequency: str(p.frequency),
      opportunity: str(p.opportunity),
    }))
    .filter((p) => p.description);
}

function normalizeStatus(raw: Raw, analyzed: boolean): { status: CompetitorProfileStatus; error?: string } {
  const error = str(raw.error) || undefined;
  if (raw.status === 'error') return { status: 'error', error };
  if (raw.status === 'done' || raw.status === 'idle') return { status: raw.status };
  if (raw.status === 'queued' || raw.status === 'running') {
    // A run was interrupted (app closed) before this profile finished
    return analyzed
      ? { status: 'error', error: 'Interrupted before profiling finished' }
      : { status: 'idle' };
  }
  // Older files (roadmap's own competitor phase) hold full profiles only
  return { status: analyzed ? 'done' : 'idle' };
}

const score = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : fallback;

export function normalizeStoredCompetitor(
  raw: Raw,
  index: number,
  taken: Set<string>,
  analyzed = true,
): CompetitorProfile | null {
  const name = str(raw.name);
  if (!name) return null;
  const rawId = str(raw.id);
  const id = rawId && !taken.has(rawId) ? rawId : uniqueId('c', name || String(index), taken);
  taken.add(id);
  const positioning = str(raw.positioning) || str(raw.description);
  return {
    id,
    name,
    url: str(raw.url),
    oneLiner: str(raw.one_liner) || positioning,
    relevanceScore: score(raw.relevance_score, raw.source === 'manual' ? 90 : 50),
    analyzed,
    positioning,
    targetAudience: str(raw.target_audience),
    keyFeatures: strList(raw.key_features),
    pricingModel: str(raw.pricing_model),
    strengths: strList(raw.strengths),
    weaknesses: strList(raw.weaknesses),
    differentiator: str(raw.differentiator) || str(raw.market_position),
    relevance: level(raw.relevance),
    painPoints: normalizePainPoints(raw.pain_points, id),
    source: raw.source === 'manual' ? 'manual' : 'ai',
    ...normalizeStatus(raw, analyzed),
    profiledAt: str(raw.profiled_at) || undefined,
  };
}

export function normalizeStoredDirection(raw: Raw, taken: Set<string>): StrategicDirection | null {
  const title = str(raw.title);
  if (!title) return null;
  const rawId = str(raw.id);
  const id = rawId && !taken.has(rawId) ? rawId : uniqueId('dir', title, taken);
  taken.add(id);
  return {
    id,
    title,
    description: str(raw.description),
    occupiedBy: strList(raw.occupied_by ?? raw.occupiedBy),
    opportunity: str(raw.opportunity),
    fit: str(raw.fit),
    fitSources: strList(raw.fit_sources ?? raw.fitSources),
    risk: str(raw.risk),
    avoid: raw.avoid === true,
    note: str(raw.note),
  };
}

/** Load the page state from disk; null when no analysis exists */
export function loadCompetitorState(projectDir: string): CompetitorStrategyState | null {
  const analysis = readJson(competitorFilePath(projectDir));
  const strategy = readJson(strategyFilePath(projectDir));
  if (!analysis && !strategy) return null;

  const ctx = (analysis?.project_context ?? {}) as Raw;
  const competitorIds = new Set<string>();
  const readList = (raw: unknown, analyzed: boolean) =>
    (Array.isArray(raw) ? raw : [])
      .filter((c): c is Raw => !!c && typeof c === 'object')
      .map((c, i) => normalizeStoredCompetitor(c, i, competitorIds, analyzed))
      .filter((c): c is CompetitorProfile => c !== null);
  const competitors = [...readList(analysis?.competitors, true), ...readList(analysis?.competitor_pool, false)];

  const directionIds = new Set<string>();
  const directions = (Array.isArray(strategy?.directions) ? strategy.directions : [])
    .filter((d): d is Raw => !!d && typeof d === 'object')
    .map((d) => normalizeStoredDirection(d, directionIds))
    .filter((d): d is StrategicDirection => d !== null);

  const metadata = (analysis?.metadata ?? {}) as Raw;
  return {
    projectName: str(ctx.project_name),
    projectType: str(ctx.project_type),
    targetAudience: str(ctx.target_audience),
    focus: str(analysis?.focus),
    competitorCount: clampCompetitorCount(analysis?.competitor_count),
    analyzedAt: str(analysis?.analyzed_at) || str(analysis?.created_at) || str(metadata.created_at) || null,
    competitors,
    directions,
    directionsSynthesizedAt: str(strategy?.directions_synthesized_at) || null,
    directionsError: str(strategy?.directions_error) || undefined,
    directionsStale: strategy?.directions_stale === true,
    rankingSavedAt: str(strategy?.ranking_saved_at) || null,
  };
}

export function emptyCompetitorState(): CompetitorStrategyState {
  return {
    projectName: '',
    projectType: '',
    targetAudience: '',
    focus: '',
    competitorCount: clampCompetitorCount(undefined),
    analyzedAt: null,
    competitors: [],
    directions: [],
    directionsSynthesizedAt: null,
    directionsStale: false,
    rankingSavedAt: null,
  };
}

// =============================================================================
// State → raw
// =============================================================================

function competitorToRaw(c: CompetitorProfile): Raw {
  return {
    id: c.id,
    name: c.name,
    url: c.url,
    // Fields read by the roadmap UI / features phase
    description: c.positioning || c.oneLiner,
    relevance: c.relevance,
    pain_points: c.painPoints.map((p) => ({
      id: p.id,
      description: p.description,
      source: p.source,
      severity: p.severity,
      frequency: p.frequency,
      opportunity: p.opportunity,
    })),
    strengths: c.strengths,
    market_position: c.differentiator,
    source: c.source,
    // Competitors page fields
    one_liner: c.oneLiner,
    relevance_score: c.relevanceScore,
    positioning: c.positioning,
    target_audience: c.targetAudience,
    key_features: c.keyFeatures,
    pricing_model: c.pricingModel,
    weaknesses: c.weaknesses,
    differentiator: c.differentiator,
    status: c.status,
    ...(c.error ? { error: c.error } : {}),
    ...(c.profiledAt ? { profiled_at: c.profiledAt } : {}),
  };
}

function directionToRaw(d: StrategicDirection): Raw {
  return {
    id: d.id,
    title: d.title,
    description: d.description,
    occupied_by: d.occupiedBy,
    opportunity: d.opportunity,
    fit: d.fit,
    fit_sources: d.fitSources,
    risk: d.risk,
    avoid: d.avoid,
    note: d.note,
  };
}

/** Serialize the analysis file (exported for tests) */
export function toCompetitorAnalysisRaw(state: CompetitorStrategyState): Raw {
  const createdAt = state.analyzedAt ?? new Date().toISOString();
  // `competitors` holds the analyzed set only — the roadmap reader shows it as-is
  const analyzed = state.competitors.filter((c) => c.analyzed);
  const pool = state.competitors.filter((c) => !c.analyzed);
  const done = analyzed.filter((c) => c.status === 'done');
  return {
    generator: 'malvy-competitors',
    focus: state.focus,
    competitor_count: state.competitorCount,
    analyzed_at: state.analyzedAt,
    created_at: createdAt,
    metadata: { created_at: createdAt },
    project_context: {
      project_name: state.projectName,
      project_type: state.projectType,
      target_audience: state.targetAudience,
    },
    competitors: analyzed.map(competitorToRaw),
    competitor_pool: pool.map(competitorToRaw),
    market_gaps: state.directions
      .filter((d) => !d.avoid && d.opportunity)
      .map((d) => ({
        id: `gap-${d.id}`,
        description: d.opportunity,
        affected_competitors: d.occupiedBy,
        opportunity_size: 'medium',
        suggested_feature: d.title,
      })),
    insights_summary: {
      top_pain_points: done.flatMap((c) => c.painPoints.map((p) => p.description)).slice(0, 8),
      differentiator_opportunities: state.directions.filter((d) => !d.avoid).map((d) => d.title),
      market_trends: [],
    },
    research_metadata: {
      search_queries_used: [],
      sources_consulted: done.map((c) => c.url).filter(Boolean),
      limitations: [],
    },
  };
}

/** Persist both files */
export function saveCompetitorState(projectDir: string, state: CompetitorStrategyState): void {
  writeJsonAtomic(competitorFilePath(projectDir), toCompetitorAnalysisRaw(state));
  writeJsonAtomic(strategyFilePath(projectDir), {
    directions: state.directions.map(directionToRaw),
    directions_synthesized_at: state.directionsSynthesizedAt,
    ...(state.directionsError ? { directions_error: state.directionsError } : {}),
    directions_stale: state.directionsStale,
    ranking_saved_at: state.rankingSavedAt,
  });
}

// =============================================================================
// Ranking + freshness
// =============================================================================

const NOTE_MAX_CHARS = 500;

/**
 * Apply a user ranking: reorder directions (unknown ids ignored, missing ones
 * keep their relative order at the end), set avoid flags and notes.
 */
export function applyDirectionRanking(
  state: CompetitorStrategyState,
  ranking: DirectionRankingInput,
  now: Date = new Date(),
): CompetitorStrategyState {
  const order = Array.isArray(ranking.order) ? ranking.order : [];
  const avoided = new Set(Array.isArray(ranking.avoided) ? ranking.avoided : []);
  const notes = ranking.notes && typeof ranking.notes === 'object' ? ranking.notes : {};
  const rank = new Map(order.map((id, i) => [id, i]));
  const directions = state.directions
    .map((d, i) => ({ d, key: rank.get(d.id) ?? order.length + i }))
    .sort((a, b) => a.key - b.key)
    .map(({ d }) => ({
      ...d,
      avoid: avoided.has(d.id),
      note: typeof notes[d.id] === 'string' ? notes[d.id].trim().slice(0, NOTE_MAX_CHARS) : d.note,
    }));
  return { ...state, directions, rankingSavedAt: now.toISOString() };
}

/** True when the analysis has profiles and finished within the max age */
export function isCompetitorAnalysisFresh(
  state: CompetitorStrategyState | null,
  now: Date = new Date(),
  maxAgeDays: number = COMPETITOR_ANALYSIS_MAX_AGE_DAYS,
): boolean {
  if (!state?.analyzedAt) return false;
  if (!state.competitors.some((c) => c.analyzed && c.status === 'done')) return false;
  const at = Date.parse(state.analyzedAt);
  if (Number.isNaN(at)) return false;
  return now.getTime() - at <= maxAgeDays * 24 * 60 * 60 * 1000;
}

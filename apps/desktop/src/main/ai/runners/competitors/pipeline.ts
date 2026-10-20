/**
 * Competitor Analysis Pipeline
 * ============================
 *
 * Three cheap passes through the claude CLI (subscription-safe, see cli/claude-cli.ts):
 *
 * 1. discover   — one process, web tools: a pool of up to 30 alternatives
 *                 (name, url, one-liner, relevance score).
 * 2. profile    — the top N by relevance (slider 3–10) in parallel batches
 *                 (≤3 per process, ≤4 processes); each `<competitor_profile>` block is
 *                 parsed as it streams, so cards fill in one by one.
 * 3. synthesize — one process, no tools, one turn: strategic directions from the
 *                 analyzed set only.
 *
 * Pool items can be deep-dived one at a time (profileCompetitor), analyzed ones
 * moved back to the pool, and manual entries added — the latter two are pure
 * state edits that only flag the directions as stale.
 *
 * State lives behind a CompetitorStateStore so concurrent single-competitor
 * runs and the full run all apply atomic updates to the same object.
 */

import { runClaudeCli } from '../../cli/claude-cli';
import { tryLoadPrompt } from '../../prompts/prompt-loader';
import { safeParseJson } from '../../../utils/json-repair';
import {
  COMPETITOR_POOL_MAX,
  type CompetitorProfile,
  type CompetitorProgressEvent,
  type CompetitorStrategyState,
  type ManualCompetitorPoolInput,
  type StrategicDirection,
  clampCompetitorCount,
} from '../../../../shared/types/competitors';
import type { CompetitorPainPoint } from '../../../../shared/types/roadmap';
import { loadCoreValuesSection } from '../../../core-values';
import { buildProjectBrief } from './project-brief';
import { str, strList, uniqueId } from './persistence';

// =============================================================================
// Constants
// =============================================================================

export const DISCOVER_MAX_TURNS = 8;
export const SYNTHESIZE_MAX_TURNS = 1;
/** Turn cap for a profile process: a couple of web calls per competitor plus the answer */
export const profileMaxTurns = (batchSize: number) => 2 + 2 * batchSize;
export const DEFAULT_MAX_CONCURRENCY = 4;
export const DEFAULT_MAX_BATCH_SIZE = 3;

const WEB_TOOLS = ['WebSearch', 'WebFetch', 'Read', 'Glob', 'Grep'];

// =============================================================================
// Types
// =============================================================================

export interface CompetitorStateStore {
  get(): CompetitorStrategyState;
  /** Apply an atomic update; implementations may persist */
  update(fn: (state: CompetitorStrategyState) => CompetitorStrategyState): CompetitorStrategyState;
}

export interface CompetitorRunContext {
  projectDir: string;
  store: CompetitorStateStore;
  /** Full model id (resolveModelId) */
  modelId: string;
  abortSignal?: AbortSignal;
  onEvent?: (event: CompetitorProgressEvent) => void;
  maxConcurrency?: number;
  maxBatchSize?: number;
  /** Manual competitors from the old roadmap flow (manual_competitors.json) */
  extraManual?: ManualCompetitorPoolInput[];
  now?: () => Date;
}

export interface CompetitorRunOutcome {
  success: boolean;
  aborted: boolean;
  error?: string;
}

/** In-memory store (tests, and the base of the IPC handler's persisted store) */
export function createMemoryStore(
  initial: CompetitorStrategyState,
  onChange?: (state: CompetitorStrategyState) => void,
): CompetitorStateStore {
  let state = initial;
  return {
    get: () => state,
    update: (fn) => {
      state = fn(state);
      onChange?.(state);
      return state;
    },
  };
}

// =============================================================================
// Pure helpers
// =============================================================================

/** All `<tag>…</tag>` bodies in order of appearance */
export function extractAllTagBlocks(text: string, tag: string): string[] {
  const blocks: string[] = [];
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  let from = 0;
  for (;;) {
    const start = text.indexOf(open, from);
    if (start === -1) break;
    const end = text.indexOf(close, start + open.length);
    if (end === -1) break;
    blocks.push(text.slice(start + open.length, end).trim());
    from = end + close.length;
  }
  return blocks;
}

const lastBlock = (text: string, tag: string) => extractAllTagBlocks(text, tag).at(-1) ?? null;

function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

const normName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Same competitor by name or url host */
export function isSameCompetitor(a: { name: string; url: string }, b: { name: string; url: string }): boolean {
  if (normName(a.name) && normName(a.name) === normName(b.name)) return true;
  const ha = hostOf(a.url);
  return !!ha && ha === hostOf(b.url);
}

/**
 * Batch sizes for N profiles: as many processes as useful (≤ maxConcurrency),
 * at most maxBatchSize competitors each, spread evenly. 5 → [2,1,1,1], 10 → [3,3,2,2].
 */
export function planBatches(n: number, maxConcurrency = DEFAULT_MAX_CONCURRENCY, maxBatchSize = DEFAULT_MAX_BATCH_SIZE): number[] {
  if (n <= 0) return [];
  const count = Math.max(Math.ceil(n / maxBatchSize), Math.min(maxConcurrency, n));
  const base = Math.floor(n / count);
  const extra = n % count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

/** How many directions to ask for, scaled by the analyzed count */
export function directionRange(analyzedCount: number): { min: number; max: number } {
  if (analyzedCount <= 5) return { min: 3, max: 5 };
  if (analyzedCount <= 8) return { min: 3, max: 6 };
  return { min: 4, max: 7 };
}

const clampScore = (v: unknown, fallback: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : fallback;
};

function blankProfile(id: string, name: string, url: string): CompetitorProfile {
  return {
    id,
    name,
    url,
    oneLiner: '',
    relevanceScore: 50,
    analyzed: false,
    positioning: '',
    targetAudience: '',
    keyFeatures: [],
    pricingModel: '',
    strengths: [],
    weaknesses: [],
    differentiator: '',
    relevance: 'medium',
    painPoints: [],
    source: 'ai',
    status: 'idle',
  };
}

interface DiscoverOutput {
  project: { name: string; type: string; audience: string };
  candidates: Array<{ name: string; url: string; oneLiner: string; relevanceScore: number }>;
}

/** Parse the `<competitor_pool>` block (array, or object with `competitors`) */
export function parseDiscoverOutput(text: string): DiscoverOutput | null {
  const block = lastBlock(text, 'competitor_pool');
  if (block === null) return null;
  const data = safeParseJson<unknown>(block);
  const obj = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  const list = Array.isArray(data) ? data : Array.isArray(obj.competitors) ? obj.competitors : null;
  if (!list) return null;
  const project = (obj.project && typeof obj.project === 'object' ? obj.project : {}) as Record<string, unknown>;
  const candidates = list
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({
      name: str(c.name),
      url: str(c.url),
      oneLiner: str(c.one_liner ?? c.oneLiner ?? c.positioning),
      relevanceScore: clampScore(c.relevance ?? c.relevance_score, 50),
    }))
    .filter((c) => c.name);
  return {
    project: { name: str(project.name), type: str(project.type), audience: str(project.audience) },
    candidates,
  };
}

/** Merge a parsed `<competitor_profile>` object into a profile */
export function applyProfile(base: CompetitorProfile, raw: Record<string, unknown>, now: Date): CompetitorProfile {
  const painPoints: CompetitorPainPoint[] = (Array.isArray(raw.pain_points) ? raw.pain_points : [])
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && !!str(p.description))
    .slice(0, 4)
    .map((p, i) => ({
      id: `${base.id}-pain-${i + 1}`,
      description: str(p.description),
      source: str(p.source),
      severity: p.severity === 'high' || p.severity === 'low' ? p.severity : 'medium',
      frequency: str(p.frequency),
      opportunity: str(p.opportunity),
    }));
  const relevance = raw.relevance === 'high' || raw.relevance === 'low' ? raw.relevance : 'medium';
  return {
    ...base,
    url: str(raw.url) || base.url,
    positioning: str(raw.positioning) || base.oneLiner,
    targetAudience: str(raw.target_audience),
    keyFeatures: strList(raw.key_features).slice(0, 8),
    pricingModel: str(raw.pricing_model),
    strengths: strList(raw.strengths).slice(0, 6),
    weaknesses: strList(raw.weaknesses).slice(0, 6),
    differentiator: str(raw.differentiator),
    relevance,
    painPoints,
    status: 'done',
    error: undefined,
    profiledAt: now.toISOString(),
  };
}

/**
 * Parse `<strategic_directions>`; carries avoid/note over from same-titled old
 * directions. Directions flagged `conflicts_with_values` are sorted last and
 * default to Avoid.
 */
export function parseDirections(
  text: string,
  previous: StrategicDirection[],
  max: number,
): StrategicDirection[] | null {
  const block = lastBlock(text, 'strategic_directions');
  if (block === null) return null;
  const data = safeParseJson<unknown>(block);
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).directions)
      ? ((data as Record<string, unknown>).directions as unknown[])
      : null;
  if (!list) return null;
  const taken = new Set<string>();
  const byTitle = new Map(previous.map((d) => [d.title.trim().toLowerCase(), d]));
  const directions = list
    .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object' && !!str(d.title))
    .slice(0, max)
    .map((d) => {
      const title = str(d.title);
      const old = byTitle.get(title.toLowerCase());
      const conflictsWithValues = d.conflicts_with_values === true || d.conflicts_with_values === 'true';
      return {
        id: uniqueId('dir', title, taken),
        title,
        description: str(d.description),
        occupiedBy: strList(d.occupied_by),
        opportunity: str(d.opportunity),
        fit: str(d.fit),
        fitSources: strList(d.fit_sources),
        risk: str(d.risk),
        valuesFit: str(d.values_fit),
        conflictsWithValues,
        // A conflict with the core values suggests Avoid unless the user already decided
        avoid: old?.avoid ?? conflictsWithValues,
        note: old?.note ?? '',
      };
    });
  if (directions.length === 0) return null;
  // Directions that conflict with the core values go last (stable otherwise)
  return [...directions.filter((d) => !d.conflictsWithValues), ...directions.filter((d) => d.conflictsWithValues)];
}

/** Move an analyzed competitor back to the pool (keeps its profile) */
export function moveCompetitorToPool(state: CompetitorStrategyState, competitorId: string): CompetitorStrategyState {
  const target = state.competitors.find((c) => c.id === competitorId);
  if (!target?.analyzed) return state;
  return {
    ...state,
    competitors: state.competitors.map((c) =>
      c.id === competitorId ? { ...c, analyzed: false, status: c.status === 'done' ? 'done' : 'idle', error: undefined } : c,
    ),
    directionsStale: state.directions.length > 0 || state.directionsStale,
  };
}

/** Add a manual entry to the pool; unchanged when it is already listed or has no name */
export function addManualCompetitor(
  state: CompetitorStrategyState,
  input: ManualCompetitorPoolInput,
): CompetitorStrategyState {
  const name = str(input?.name).slice(0, 120);
  const url = str(input?.url).slice(0, 500);
  if (!name) return state;
  if (state.competitors.some((c) => isSameCompetitor(c, { name, url }))) return state;
  const taken = new Set(state.competitors.map((c) => c.id));
  const entry: CompetitorProfile = {
    ...blankProfile(uniqueId('c', name, taken), name, url),
    relevanceScore: 90,
    source: 'manual',
  };
  return { ...state, competitors: [...state.competitors, entry] };
}

// =============================================================================
// Prompts
// =============================================================================

const FALLBACK_DISCOVER =
  'Find alternatives to the project below with WebSearch. Output <competitor_pool>{"project":{"name":"","type":"","audience":""},"competitors":[{"name":"","url":"","one_liner":"","relevance":0}]}</competitor_pool>.';
const FALLBACK_PROFILE =
  'Profile each competitor below with WebSearch/WebFetch. After EACH one, output <competitor_profile>{"name":"","url":"","positioning":"","target_audience":"","key_features":[],"pricing_model":"","strengths":[],"weaknesses":[],"differentiator":"","relevance":"high|medium|low","pain_points":[]}</competitor_profile>.';
const FALLBACK_DIRECTIONS =
  'Synthesize strategic directions from the competitors below. Output <strategic_directions>[{"title":"","description":"","occupied_by":[],"opportunity":"","fit":"","fit_sources":[],"risk":"","values_fit":"","conflicts_with_values":false}]</strategic_directions>.';

const prompt = (name: string, fallback: string) => tryLoadPrompt(name) ?? fallback;

/** Core values for the research passes, where they inform judgement but don't filter facts */
function valuesAsContext(projectDir: string, note: string): string {
  const section = loadCoreValuesSection(projectDir);
  return section ? `${section}In this research step they are context for what our product stands for. ${note}\n\n` : '';
}

/** Directions-pass rules that depend on whether core values are set */
export function directionsValuesRules(hasValues: boolean): string {
  if (!hasValues) {
    return '## Core values\nNone set — use "values_fit": "" and "conflicts_with_values": false for every direction.\n\n';
  }
  return (
    '## Core values rules (apply to EVERY direction)\n' +
    '- Only propose directions consistent with the CORE VALUES at the top. They outweigh market opportunity, ' +
    'competitor gaps and fit with the current code.\n' +
    '- "values_fit": one sentence on how the direction serves (or would break) the core values, naming the value.\n' +
    '- "conflicts_with_values": true when pursuing it would break any core value. Include such a direction only when ' +
    'a large part of the market goes that way and the user should see it; it is then sorted last and suggested as Avoid.\n' +
    '- Rank directions that serve the core values best first.\n\n'
  );
}

function briefBlock(projectDir: string): string {
  return buildProjectBrief(projectDir) || '(No project docs found — infer the product from the directory name and focus.)';
}

function compactProfile(c: CompetitorProfile) {
  return {
    name: c.name,
    positioning: c.positioning || c.oneLiner,
    target_audience: c.targetAudience,
    key_features: c.keyFeatures,
    pricing_model: c.pricingModel,
    strengths: c.strengths,
    weaknesses: c.weaknesses,
    differentiator: c.differentiator,
  };
}

/** Full directions-synthesis prompt: core values first, then instructions, brief, competitors */
export function buildDirectionsPrompt(
  projectDir: string,
  state: CompetitorStrategyState,
  analyzed: CompetitorProfile[],
  min: number,
  max: number,
): string {
  const values = loadCoreValuesSection(projectDir);
  return (
    values +
    `${prompt('competitor_directions', FALLBACK_DIRECTIONS)}\n\n---\n\n` +
    directionsValuesRules(values !== '') +
    `## Project brief (cite these sources in fit_sources)\n${briefBlock(projectDir)}\n\n` +
    (state.focus ? `## Focus from the user\n${state.focus}\n\n` : '') +
    `## Competitors (${analyzed.length})\n${JSON.stringify(analyzed.map(compactProfile))}\n\n` +
    `Output between ${min} and ${max} directions.`
  );
}

// =============================================================================
// Runner internals
// =============================================================================

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

function setCompetitor(ctx: CompetitorRunContext, id: string, patch: (c: CompetitorProfile) => CompetitorProfile): void {
  const state = ctx.store.update((s) => ({
    ...s,
    competitors: s.competitors.map((c) => (c.id === id ? patch(c) : c)),
  }));
  const updated = state.competitors.find((c) => c.id === id);
  if (updated) ctx.onEvent?.({ kind: 'competitor', competitor: updated });
}

/**
 * Profile one batch in a single CLI process. Profiles are applied as their
 * blocks stream in; anything not delivered when the process ends is an error.
 * `promote` moves pool items into the analyzed set once their profile is done.
 */
async function profileBatch(ctx: CompetitorRunContext, ids: string[], promote: boolean): Promise<number> {
  const now = ctx.now ?? (() => new Date());
  const batch = ids
    .map((id) => ctx.store.get().competitors.find((c) => c.id === id))
    .filter((c): c is CompetitorProfile => !!c);
  if (batch.length === 0) return 0;
  for (const c of batch) setCompetitor(ctx, c.id, (x) => ({ ...x, status: 'running', error: undefined }));

  const pending = new Map(batch.map((c) => [c.id, c]));
  let buffer = '';
  let consumed = 0;
  let delivered = 0;
  const consume = () => {
    const blocks = extractAllTagBlocks(buffer, 'competitor_profile');
    for (const block of blocks.slice(consumed)) {
      const raw = safeParseJson<Record<string, unknown>>(block);
      if (!raw || typeof raw !== 'object') continue;
      const name = str(raw.name);
      const match =
        [...pending.values()].find((c) => isSameCompetitor(c, { name, url: str(raw.url) })) ??
        (!name ? [...pending.values()][0] : undefined);
      if (!match) continue;
      pending.delete(match.id);
      delivered++;
      setCompetitor(ctx, match.id, (c) => ({ ...applyProfile(c, raw, now()), analyzed: promote || c.analyzed }));
    }
    consumed = blocks.length;
  };

  const competitorsList = batch
    .map((c, i) => `${i + 1}. ${c.name}${c.url ? ` — ${c.url}` : ''}${c.oneLiner ? ` — ${c.oneLiner}` : ''}`)
    .join('\n');
  const state = ctx.store.get();
  const fullPrompt =
    valuesAsContext(ctx.projectDir, 'Where a competitor clashes with them, say so in its weaknesses.') +
    `${prompt('competitor_profile', FALLBACK_PROFILE)}\n\n---\n\n` +
    `## Our project (for relevance only)\n${state.projectName || '(see brief)'}${state.targetAudience ? ` — audience: ${state.targetAudience}` : ''}\n\n` +
    `## Competitors to profile (${batch.length})\n${competitorsList}\n\n` +
    `Output exactly ${batch.length} <competitor_profile> block(s), one per competitor, each right after you finish researching it.`;

  let failure: string | undefined;
  try {
    await runClaudeCli({
      prompt: fullPrompt,
      cwd: ctx.projectDir,
      projectPath: ctx.projectDir,
      modelId: ctx.modelId,
      allowedTools: WEB_TOOLS,
      restrictTools: true,
      minimalContext: true,
      maxTurns: profileMaxTurns(batch.length),
      abortSignal: ctx.abortSignal,
      onText: (text) => {
        buffer += text;
        consume();
      },
    });
  } catch (error) {
    failure = errorMessage(error);
  }
  consume();

  const aborted = ctx.abortSignal?.aborted === true;
  for (const c of pending.values()) {
    setCompetitor(ctx, c.id, (x) => ({
      ...x,
      // A stopped pool deep-dive just returns to idle
      status: aborted && !x.analyzed ? (x.profiledAt ? 'done' : 'idle') : 'error',
      error: aborted ? 'Stopped' : failure ?? 'No profile returned',
    }));
  }
  return delivered;
}

// =============================================================================
// Public runs
// =============================================================================

/** Discover a pool, profile the top N, then (optionally) synthesize directions */
export async function runFullAnalysis(
  ctx: CompetitorRunContext,
  options: { focus?: string; count?: number; synthesize?: boolean } = {},
): Promise<CompetitorRunOutcome> {
  const now = ctx.now ?? (() => new Date());
  const focus = str(options.focus).slice(0, 500);
  const count = clampCompetitorCount(options.count);
  const aborted = () => ctx.abortSignal?.aborted === true;

  // ---- 1. Discover -------------------------------------------------------------
  ctx.onEvent?.({ kind: 'phase', phase: 'discovering' });
  const previous = ctx.store.get();
  const manual = [
    ...previous.competitors.filter((c) => c.source === 'manual'),
    ...(ctx.extraManual ?? []).map((m) => ({ name: str(m.name), url: str(m.url) })),
  ].filter((m) => m.name);
  const discoverPrompt =
    valuesAsContext(ctx.projectDir, 'Still list real competitors that do not share them; rate relevance by overlap in audience and problem.') +
    `${prompt('competitor_discover', FALLBACK_DISCOVER)}\n\n---\n\n` +
    `## Project brief\n${briefBlock(ctx.projectDir)}\n\n` +
    (focus ? `## Focus from the user\n${focus}\n\n` : '') +
    (manual.length > 0
      ? `## Already known (do not list again)\n${manual.map((m) => `- ${m.name}${m.url ? ` (${m.url})` : ''}`).join('\n')}\n\n`
      : '') +
    `List as many relevant competitors/alternatives as you can find, at most ${COMPETITOR_POOL_MAX}.`;

  let discovered: DiscoverOutput | null = null;
  let discoverError = '';
  for (let attempt = 0; attempt < 2 && !discovered && !aborted(); attempt++) {
    try {
      const text = await runClaudeCli({
        prompt: discoverPrompt,
        cwd: ctx.projectDir,
        projectPath: ctx.projectDir,
        modelId: ctx.modelId,
        allowedTools: WEB_TOOLS,
        restrictTools: true,
        minimalContext: true,
        maxTurns: DISCOVER_MAX_TURNS,
        abortSignal: ctx.abortSignal,
      });
      discovered = parseDiscoverOutput(text);
      if (!discovered || discovered.candidates.length === 0) {
        discovered = null;
        discoverError = 'No <competitor_pool> block with competitors in the response';
      }
    } catch (error) {
      discoverError = errorMessage(error);
    }
  }
  if (aborted()) return { success: false, aborted: true };
  if (!discovered) return { success: false, aborted: false, error: `Discovery failed: ${discoverError}` };

  // ---- Build pool + analyzed set -----------------------------------------------
  const taken = new Set<string>();
  const competitors: CompetitorProfile[] = [];
  for (const m of previous.competitors.filter((c) => c.source === 'manual')) {
    taken.add(m.id);
    competitors.push({ ...m, analyzed: false, status: 'idle', error: undefined });
  }
  for (const m of ctx.extraManual ?? []) {
    const name = str(m.name);
    if (!name || competitors.some((c) => isSameCompetitor(c, { name, url: str(m.url) }))) continue;
    competitors.push({ ...blankProfile(uniqueId('c', name, taken), name, str(m.url)), relevanceScore: 90, source: 'manual' });
  }
  for (const cand of discovered.candidates) {
    if (competitors.length >= COMPETITOR_POOL_MAX + manual.length) break;
    if (competitors.some((c) => isSameCompetitor(c, cand))) continue;
    competitors.push({
      ...blankProfile(uniqueId('c', cand.name, taken), cand.name, cand.url),
      oneLiner: cand.oneLiner,
      relevanceScore: cand.relevanceScore,
    });
  }
  const topIds = new Set(
    [...competitors].sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, count).map((c) => c.id),
  );
  const ranked = competitors
    .map((c) => (topIds.has(c.id) ? { ...c, analyzed: true, status: 'queued' as const } : c))
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  const synthesize = options.synthesize !== false;
  const state = ctx.store.update((s) => ({
    ...s,
    projectName: discovered.project.name || s.projectName,
    projectType: discovered.project.type || s.projectType,
    targetAudience: discovered.project.audience || s.targetAudience,
    focus,
    competitorCount: count,
    competitors: ranked,
    directionsStale: s.directions.length > 0,
  }));
  ctx.onEvent?.({ kind: 'competitors', competitors: state.competitors });

  // ---- 2. Profile top N in parallel batches ------------------------------------
  ctx.onEvent?.({ kind: 'phase', phase: 'profiling' });
  const analyzedIds = ranked.filter((c) => c.analyzed).map((c) => c.id);
  const sizes = planBatches(analyzedIds.length, ctx.maxConcurrency, ctx.maxBatchSize);
  const batches: string[][] = [];
  let offset = 0;
  for (const size of sizes) {
    batches.push(analyzedIds.slice(offset, offset + size));
    offset += size;
  }
  let done = 0;
  await runPool(batches, ctx.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY, async (ids) => {
    if (aborted()) return;
    done += await profileBatch(ctx, ids, true);
  });
  // Batches that never started (stop) leave queued items behind
  if (aborted()) {
    for (const c of ctx.store.get().competitors.filter((x) => x.status === 'queued')) {
      setCompetitor(ctx, c.id, (x) => ({ ...x, status: 'error', error: 'Stopped' }));
    }
  }
  ctx.store.update((s) => ({ ...s, analyzedAt: now().toISOString() }));

  if (aborted()) return { success: false, aborted: true };
  if (done === 0) return { success: false, aborted: false, error: 'No competitor could be profiled' };
  if (!synthesize) return { success: true, aborted: false };

  // ---- 3. Directions -----------------------------------------------------------
  return synthesizeDirections(ctx);
}

/**
 * Profile one competitor: deep-dive a pool item (moves it to the analyzed set
 * when done) or refresh an analyzed one. A pool item that already has a
 * profile is promoted without a CLI run.
 */
export async function profileCompetitor(ctx: CompetitorRunContext, competitorId: string): Promise<CompetitorRunOutcome> {
  const target = ctx.store.get().competitors.find((c) => c.id === competitorId);
  if (!target) return { success: false, aborted: false, error: 'Competitor not found' };
  const wasPool = !target.analyzed;

  if (wasPool && target.status === 'done' && target.profiledAt) {
    setCompetitor(ctx, competitorId, (c) => ({ ...c, analyzed: true }));
  } else {
    const delivered = await profileBatch(ctx, [competitorId], true);
    if (ctx.abortSignal?.aborted) return { success: false, aborted: true };
    if (delivered === 0) {
      const after = ctx.store.get().competitors.find((c) => c.id === competitorId);
      return { success: false, aborted: false, error: after?.error ?? 'No profile returned' };
    }
  }
  if (wasPool) {
    const state = ctx.store.update((s) => ({ ...s, directionsStale: s.directions.length > 0 || s.directionsStale }));
    ctx.onEvent?.({ kind: 'state', state });
  }
  return { success: true, aborted: false };
}

/** Synthesize strategic directions from the analyzed, profiled competitors only */
export async function synthesizeDirections(ctx: CompetitorRunContext): Promise<CompetitorRunOutcome> {
  const now = ctx.now ?? (() => new Date());
  ctx.onEvent?.({ kind: 'phase', phase: 'synthesizing' });
  const state = ctx.store.get();
  const analyzed = state.competitors.filter((c) => c.analyzed && c.status === 'done');
  if (analyzed.length === 0) {
    return { success: false, aborted: false, error: 'No analyzed competitors to synthesize from' };
  }
  const { min, max } = directionRange(analyzed.length);
  const synthPrompt = buildDirectionsPrompt(ctx.projectDir, state, analyzed, min, max);

  let error = '';
  for (let attempt = 0; attempt < 2 && !ctx.abortSignal?.aborted; attempt++) {
    try {
      const text = await runClaudeCli({
        prompt: synthPrompt,
        cwd: ctx.projectDir,
        projectPath: ctx.projectDir,
        modelId: ctx.modelId,
        allowedTools: [],
        restrictTools: true,
        minimalContext: true,
        maxTurns: SYNTHESIZE_MAX_TURNS,
        abortSignal: ctx.abortSignal,
      });
      const directions = parseDirections(text, ctx.store.get().directions, max);
      if (directions) {
        const next = ctx.store.update((s) => ({
          ...s,
          directions,
          directionsSynthesizedAt: now().toISOString(),
          directionsError: undefined,
          directionsStale: false,
          // The AI's order counts as the saved ranking; reorder and save only to change it
          rankingSavedAt: now().toISOString(),
        }));
        ctx.onEvent?.({ kind: 'directions', directions: next.directions });
        return { success: true, aborted: false };
      }
      error = 'No <strategic_directions> block in the response';
    } catch (e) {
      error = errorMessage(e);
    }
  }
  if (ctx.abortSignal?.aborted) return { success: false, aborted: true };
  const next = ctx.store.update((s) => ({ ...s, directionsError: error }));
  ctx.onEvent?.({ kind: 'state', state: next });
  return { success: false, aborted: false, error: `Direction synthesis failed: ${error}` };
}

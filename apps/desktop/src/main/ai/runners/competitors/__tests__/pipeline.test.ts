import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks
// =============================================================================

interface CliCall {
  prompt: string;
  allowedTools: string[];
  maxTurns?: number;
  restrictTools?: boolean;
  minimalContext?: boolean;
  abortSignal?: AbortSignal;
  onText?: (text: string) => void;
}

/** Fake CLI: returns text (or throws) per call; may stream via onText */
let cli: (call: CliCall) => Promise<string>;
const cliCalls: CliCall[] = [];

vi.mock('../../../cli/claude-cli', () => ({
  runClaudeCli: (call: CliCall) => {
    cliCalls.push(call);
    return cli(call);
  },
}));

vi.mock('../../../prompts/prompt-loader', () => ({
  tryLoadPrompt: (name: string) => `# ${name}`,
}));

vi.mock('../project-brief', () => ({
  buildProjectBrief: () => '### Source: .malvy/docs/project_summary.json\nA fitness app',
}));

// =============================================================================
// Imports after mocks
// =============================================================================

import {
  addManualCompetitor,
  createMemoryStore,
  directionRange,
  extractAllTagBlocks,
  moveCompetitorToPool,
  parseDiscoverOutput,
  planBatches,
  profileCompetitor,
  runFullAnalysis,
  synthesizeDirections,
  type CompetitorRunContext,
} from '../pipeline';
import { emptyCompetitorState } from '../persistence';
import type { CompetitorProgressEvent, CompetitorStrategyState } from '../../../../../shared/types/competitors';

// =============================================================================
// Helpers
// =============================================================================

const kind = (call: CliCall) =>
  call.prompt.startsWith('# competitor_discover')
    ? 'discover'
    : call.prompt.startsWith('# competitor_profile')
      ? 'profile'
      : 'directions';

/** 12 candidates, relevance 100, 95, … 45 → "Rival 1" is most relevant */
const CANDIDATES = Array.from({ length: 12 }, (_, i) => ({
  name: `Rival ${i + 1}`,
  url: `https://rival${i + 1}.example`,
  one_liner: `Rival number ${i + 1}`,
  relevance: 100 - i * 5,
}));

const discoverText = (candidates = CANDIDATES) =>
  `thinking…\n<competitor_pool>${JSON.stringify({
    project: { name: 'FitApp', type: 'iOS app', audience: 'Runners' },
    competitors: candidates,
  })}</competitor_pool>`;

const profileBlock = (name: string) =>
  `<competitor_profile>${JSON.stringify({
    name,
    positioning: `${name} positioning`,
    key_features: ['Plans'],
    strengths: ['Brand'],
    weaknesses: ['Price'],
    differentiator: 'AI coach',
    relevance: 'high',
    pain_points: [{ description: 'Too expensive', source: 'App Store' }],
  })}</competitor_profile>`;

/** Names listed in a profile prompt ("1. Rival 3 — https://…") */
const namesIn = (prompt: string) =>
  [...prompt.matchAll(/^\d+\. (.+?)(?: — |$)/gm)].map((m) => m[1]);

const DIRECTIONS = [
  { title: 'Coach-first', description: 'AI programs', occupied_by: ['Rival 1'], opportunity: 'Personal', fit: 'Good', fit_sources: ['.malvy/docs/project_summary.json'], risk: 'Cost' },
  { title: 'Cheapest', description: 'Free tier', occupied_by: [], opportunity: 'Price', fit: 'Weak', fit_sources: [], risk: 'Margins' },
  { title: 'Community', description: 'Social', occupied_by: ['Rival 2'], opportunity: 'Groups', fit: 'Ok', fit_sources: [], risk: 'Moderation' },
];
const directionsText = () => `<strategic_directions>${JSON.stringify(DIRECTIONS)}</strategic_directions>`;

/** Default fake: answers each pass; profiles stream one block per competitor */
function happyCli() {
  cli = async (call) => {
    const k = kind(call);
    if (k === 'discover') return discoverText();
    if (k === 'directions') return directionsText();
    let text = '';
    for (const name of namesIn(call.prompt)) {
      const block = profileBlock(name);
      call.onText?.(block);
      text += block;
    }
    return text;
  };
}

function makeCtx(overrides: Partial<CompetitorRunContext> = {}, initial?: CompetitorStrategyState) {
  const events: CompetitorProgressEvent[] = [];
  const store = createMemoryStore(initial ?? emptyCompetitorState());
  const ctx: CompetitorRunContext = {
    projectDir: '/project',
    store,
    modelId: 'model-sonnet',
    onEvent: (e) => events.push(e),
    now: () => new Date('2026-10-09T12:00:00.000Z'),
    ...overrides,
  };
  return { ctx, store, events };
}

const analyzedNames = (s: CompetitorStrategyState) => s.competitors.filter((c) => c.analyzed).map((c) => c.name);

beforeEach(() => {
  cliCalls.length = 0;
  happyCli();
});

// =============================================================================
// Pure helpers
// =============================================================================

describe('planBatches', () => {
  it('adapts batches to N: one process each for small N, ≤3 per process and ≤4 processes otherwise', () => {
    expect(planBatches(3)).toEqual([1, 1, 1]);
    expect(planBatches(5)).toEqual([2, 1, 1, 1]);
    expect(planBatches(10)).toEqual([3, 3, 2, 2]);
    expect(planBatches(1)).toEqual([1]);
    expect(planBatches(0)).toEqual([]);
  });
});

describe('directionRange', () => {
  it('scales with the analyzed count', () => {
    expect(directionRange(3)).toEqual({ min: 3, max: 5 });
    expect(directionRange(7)).toEqual({ min: 3, max: 6 });
    expect(directionRange(10)).toEqual({ min: 4, max: 7 });
  });
});

describe('parsing', () => {
  it('extracts all tag blocks in order', () => {
    expect(extractAllTagBlocks('<a>1</a> x <a> 2 </a><a>open', 'a')).toEqual(['1', '2']);
  });

  it('tolerates a trailing comma and a bare array in the pool block', () => {
    const parsed = parseDiscoverOutput('<competitor_pool>[{"name":"A","url":"a.com","relevance":"70"},]</competitor_pool>');
    expect(parsed?.candidates).toEqual([{ name: 'A', url: 'a.com', oneLiner: '', relevanceScore: 70 }]);
  });
});

// =============================================================================
// Full analysis
// =============================================================================

describe('runFullAnalysis', () => {
  it('discovers a pool larger than N and profiles only the top N by relevance (default 5)', async () => {
    const { ctx, store } = makeCtx();

    const outcome = await runFullAnalysis(ctx);

    expect(outcome).toEqual({ success: true, aborted: false });
    const state = store.get();
    expect(state.competitors).toHaveLength(12);
    expect(analyzedNames(state)).toEqual(['Rival 1', 'Rival 2', 'Rival 3', 'Rival 4', 'Rival 5']);
    expect(state.competitors.filter((c) => !c.analyzed).every((c) => c.status === 'idle')).toBe(true);
    expect(state.competitors.filter((c) => c.analyzed).every((c) => c.status === 'done')).toBe(true);
    expect(state.competitorCount).toBe(5);
    expect(state.projectName).toBe('FitApp');
    expect(state.analyzedAt).toBe('2026-10-09T12:00:00.000Z');

    // 1 discover + 4 profile processes (planBatches(5)) + 1 synthesize
    expect(cliCalls.map(kind)).toEqual(['discover', 'profile', 'profile', 'profile', 'profile', 'directions']);
    const profiled = cliCalls.filter((c) => kind(c) === 'profile').flatMap((c) => namesIn(c.prompt));
    expect(profiled.sort()).toEqual(['Rival 1', 'Rival 2', 'Rival 3', 'Rival 4', 'Rival 5']);
  });

  it('respects the count and clamps it to 3–10', async () => {
    const run = async (count: number | undefined) => {
      const { ctx, store } = makeCtx();
      await runFullAnalysis(ctx, { count });
      return analyzedNames(store.get()).length;
    };
    expect(await run(7)).toBe(7);
    expect(await run(50)).toBe(10);
    expect(await run(1)).toBe(3);
    expect(await run(undefined)).toBe(5);
  });

  it('uses lean CLI settings: web tools for discover/profile, no tools and one turn for directions', async () => {
    const { ctx } = makeCtx();
    await runFullAnalysis(ctx, { focus: 'iOS fitness apps in Scandinavia' });

    const [discover] = cliCalls;
    expect(discover.allowedTools).toEqual(expect.arrayContaining(['WebSearch', 'WebFetch']));
    expect(discover.minimalContext).toBe(true);
    expect(discover.maxTurns).toBe(8);
    expect(discover.prompt).toContain('iOS fitness apps in Scandinavia');
    expect(discover.prompt).toContain('at most 30');

    const profile = cliCalls.find((c) => kind(c) === 'profile');
    expect(profile?.maxTurns).toBe(2 + 2 * namesIn(profile?.prompt ?? '').length);

    const directions = cliCalls.find((c) => kind(c) === 'directions');
    expect(directions?.allowedTools).toEqual([]);
    expect(directions?.restrictTools).toBe(true);
    expect(directions?.maxTurns).toBe(1);
    expect(directions?.prompt).toContain('between 3 and 5 directions');
  });

  it('never runs more profile processes at once than the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const base = cli;
    cli = async (call) => {
      if (kind(call) !== 'profile') return base(call);
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return base(call);
    };
    const { ctx } = makeCtx({ maxConcurrency: 2 });

    await runFullAnalysis(ctx, { count: 10 });

    expect(peak).toBe(2);
    expect(cliCalls.filter((c) => kind(c) === 'profile')).toHaveLength(4);
  });

  it('emits per-competitor progress: queued → running → done, streaming profiles before the process ends', async () => {
    const { ctx, events } = makeCtx();
    const doneBeforeReturn: string[] = [];
    const base = cli;
    cli = async (call) => {
      const result = await base(call);
      if (kind(call) === 'profile') {
        // The process is still "running" here; streamed blocks were already applied
        for (const e of events) if (e.kind === 'competitor' && e.competitor.status === 'done') doneBeforeReturn.push(e.competitor.name);
      }
      return result;
    };

    await runFullAnalysis(ctx);

    const pool = events.find((e) => e.kind === 'competitors');
    expect(pool?.kind === 'competitors' && pool.competitors.filter((c) => c.status === 'queued')).toHaveLength(5);
    const statusesOf = (name: string) =>
      events.flatMap((e) => (e.kind === 'competitor' && e.competitor.name === name ? [e.competitor.status] : []));
    expect(statusesOf('Rival 1')).toEqual(['running', 'done']);
    expect(doneBeforeReturn.length).toBeGreaterThan(0);
    expect(events.filter((e) => e.kind === 'phase').map((e) => e.kind === 'phase' && e.phase)).toEqual([
      'discovering',
      'profiling',
      'synthesizing',
    ]);
  });

  it('keeps going when one competitor fails, and builds directions from analyzed, profiled competitors only', async () => {
    const base = cli;
    cli = async (call) => {
      if (kind(call) === 'profile' && namesIn(call.prompt).includes('Rival 3')) throw new Error('claude CLI failed: boom');
      return base(call);
    };
    const { ctx, store } = makeCtx();

    const outcome = await runFullAnalysis(ctx);

    expect(outcome.success).toBe(true);
    const state = store.get();
    const failed = state.competitors.filter((c) => c.status === 'error');
    expect(failed.map((c) => c.name)).toEqual(['Rival 3']);
    expect(failed[0].error).toContain('boom');

    const synthPrompt = cliCalls.find((c) => kind(c) === 'directions')?.prompt ?? '';
    const listed = JSON.parse(synthPrompt.match(/## Competitors \(\d+\)\n(.+)\n/)?.[1] ?? '[]') as Array<{ name: string }>;
    const listedNames = listed.map((c) => c.name);
    expect(listedNames).not.toContain('Rival 3'); // failed
    expect(listedNames).not.toContain('Rival 6'); // pool
    expect(listedNames).toContain('Rival 1');
    expect(state.directions.map((d) => d.title)).toEqual(['Coach-first', 'Cheapest', 'Community']);
    expect(state.directionsStale).toBe(false);
  });

  it('fails without profiling when discovery returns nothing usable (one retry)', async () => {
    cli = async () => 'no tags';
    const { ctx } = makeCtx();

    const outcome = await runFullAnalysis(ctx);

    expect(outcome.success).toBe(false);
    expect(outcome.error).toContain('Discovery failed');
    expect(cliCalls).toHaveLength(2);
  });

  it('stops on abort: no further profile batches and no synthesis', async () => {
    const controller = new AbortController();
    const base = cli;
    cli = async (call) => {
      if (kind(call) === 'profile') {
        controller.abort();
        throw new Error('Aborted');
      }
      return base(call);
    };
    const { ctx, store } = makeCtx({ abortSignal: controller.signal, maxConcurrency: 1 });

    const outcome = await runFullAnalysis(ctx);

    expect(outcome).toEqual({ success: false, aborted: true });
    expect(cliCalls.filter((c) => kind(c) === 'profile')).toHaveLength(1);
    expect(cliCalls.some((c) => kind(c) === 'directions')).toBe(false);
    expect(store.get().competitors.some((c) => c.status === 'queued' || c.status === 'running')).toBe(false);
  });

  it('skips synthesis when asked (roadmap delegation) and flags existing directions as stale', async () => {
    const { ctx, store } = makeCtx();
    await runFullAnalysis(ctx);
    cliCalls.length = 0;

    await runFullAnalysis(ctx, { synthesize: false });

    expect(cliCalls.some((c) => kind(c) === 'directions')).toBe(false);
    expect(store.get().directionsStale).toBe(true);
  });

  it('keeps manual pool entries across a refresh', async () => {
    const initial = addManualCompetitor(emptyCompetitorState(), { name: 'My Rival', url: 'https://my.example' });
    const { ctx, store } = makeCtx({}, initial);

    await runFullAnalysis(ctx, { count: 3 });

    const manual = store.get().competitors.find((c) => c.name === 'My Rival');
    expect(manual?.source).toBe('manual');
    expect(cliCalls[0].prompt).toContain('My Rival');
  });
});

// =============================================================================
// Pool operations
// =============================================================================

describe('pool operations', () => {
  async function analyzedState() {
    const { ctx, store } = makeCtx();
    await runFullAnalysis(ctx);
    cliCalls.length = 0;
    return { ctx, store };
  }

  it('deep-dives a pool item: one CLI process, then it moves into the analyzed set and directions go stale', async () => {
    const { ctx, store } = await analyzedState();
    const target = store.get().competitors.find((c) => c.name === 'Rival 8');
    expect(target?.analyzed).toBe(false);
    const statuses: string[] = [];
    ctx.onEvent = (e) => {
      if (e.kind === 'competitor' && e.competitor.name === 'Rival 8') statuses.push(`${e.competitor.status}:${e.competitor.analyzed}`);
    };

    const outcome = await profileCompetitor(ctx, target?.id ?? '');

    expect(outcome.success).toBe(true);
    expect(cliCalls.map(kind)).toEqual(['profile']);
    expect(cliCalls[0].maxTurns).toBe(4);
    // Stays in the pool while running, moves up when done
    expect(statuses).toEqual(['running:false', 'done:true']);
    const state = store.get();
    expect(analyzedNames(state)).toContain('Rival 8');
    expect(state.directionsStale).toBe(true);
  });

  it('a failed deep-dive leaves the item in the pool with an error', async () => {
    const { ctx, store } = await analyzedState();
    cli = async () => {
      throw new Error('claude CLI failed: rate limited');
    };
    const id = store.get().competitors.find((c) => c.name === 'Rival 9')?.id ?? '';

    const outcome = await profileCompetitor(ctx, id);

    expect(outcome.success).toBe(false);
    const item = store.get().competitors.find((c) => c.id === id);
    expect(item?.analyzed).toBe(false);
    expect(item?.status).toBe('error');
  });

  it('removes an analyzed competitor back to the pool and promotes it again without a CLI run', async () => {
    const { ctx, store } = await analyzedState();
    const id = store.get().competitors.find((c) => c.name === 'Rival 1')?.id ?? '';

    const moved = moveCompetitorToPool(store.get(), id);
    expect(analyzedNames(moved)).not.toContain('Rival 1');
    expect(moved.directionsStale).toBe(true);
    ctx.store.update(() => moved);

    await profileCompetitor(ctx, id);
    expect(cliCalls).toHaveLength(0);
    expect(analyzedNames(store.get())).toContain('Rival 1');
  });

  it('adds a manual competitor to the pool; duplicates and empty names are ignored', () => {
    const state = addManualCompetitor(emptyCompetitorState(), { name: 'Acme', url: 'https://www.acme.com' });
    expect(state.competitors).toHaveLength(1);
    expect(state.competitors[0]).toMatchObject({ name: 'Acme', analyzed: false, status: 'idle', source: 'manual' });
    expect(addManualCompetitor(state, { name: 'acme' })).toBe(state);
    expect(addManualCompetitor(state, { name: 'Other', url: 'acme.com/pricing' })).toBe(state);
    expect(addManualCompetitor(state, { name: '  ' })).toBe(state);
  });

  it('re-synthesizes from the analyzed set, carrying avoid/note over for same-titled directions', async () => {
    const { ctx, store } = await analyzedState();
    store.update((s) => ({
      ...s,
      directions: s.directions.map((d) => (d.title === 'Cheapest' ? { ...d, avoid: true, note: 'No' } : d)),
      rankingSavedAt: '2026-10-09T00:00:00.000Z',
      directionsStale: true,
    }));

    const outcome = await synthesizeDirections(ctx);

    expect(outcome.success).toBe(true);
    const state = store.get();
    expect(state.directions.find((d) => d.title === 'Cheapest')).toMatchObject({ avoid: true, note: 'No' });
    expect(state.directionsStale).toBe(false);
    // The AI's order is saved as the ranking right away
    expect(state.rankingSavedAt).toBe('2026-10-09T12:00:00.000Z');
  });

  it('records a synthesis failure without touching the profiles', async () => {
    const { ctx, store } = await analyzedState();
    cli = async () => 'nothing';

    const outcome = await synthesizeDirections(ctx);

    expect(outcome.success).toBe(false);
    expect(store.get().directionsError).toContain('strategic_directions');
    expect(analyzedNames(store.get())).toHaveLength(5);
  });
});

import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks — must be declared before any imports that use them
// =============================================================================

/** Responder decides what the fake `claude` CLI prints for a given prompt + args */
type Responder = (prompt: string, args: string[]) => { text: string; code?: number };
let responder: Responder = () => ({ text: '' });

const spawnCalls: Array<{ args: string[]; prompt: string }> = [];

const mockSpawn = vi.fn((_cmd: string, args: string[]) => {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: (s: string) => void; end: () => void };
    kill: () => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  let prompt = '';
  child.stdin = {
    write: (s: string) => {
      prompt += s;
    },
    end: () => {
      spawnCalls.push({ args, prompt });
      const { text, code = 0 } = responder(prompt, args);
      setImmediate(() => {
        const event = { type: 'assistant', message: { content: [{ type: 'text', text }] } };
        child.stdout.emit('data', Buffer.from(`${JSON.stringify(event)}\n`));
        child.emit('close', code);
      });
    },
  };
  return child;
});

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...(args as [string, string[]])),
}));

vi.mock('../../../env-utils', () => ({
  getAugmentedEnvAsync: vi.fn().mockResolvedValue({ PATH: '/usr/bin' }),
  findExecutableAsync: vi.fn().mockResolvedValue('/usr/bin/claude'),
}));

vi.mock('../../../claude-profile-manager', () => ({
  getClaudeProfileManager: () => ({ getActiveProfileEnv: () => ({}) }),
}));

const mockResolveModelId = vi.fn((shorthand: string) => `model-${shorthand}`);
vi.mock('../../config/phase-config', () => ({
  resolveModelId: (shorthand: string) => mockResolveModelId(shorthand),
}));

// Filesystem mocks — an in-memory file set
const files = new Map<string, string>();
const mockMkdirSync = vi.fn();

vi.mock('node:fs', () => ({
  existsSync: (p: string) => p.endsWith('roadmap') || files.has(p),
  readFileSync: (p: string) => files.get(p) ?? '',
  writeFileSync: (p: string, content: string) => {
    files.set(p, content);
  },
  renameSync: (from: string, to: string) => {
    files.set(to, files.get(from) ?? '');
    files.delete(from);
  },
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
}));

// The competitor phase delegates to the Competitors page pipeline
type Store = {
  get: () => Record<string, unknown>;
  update: (fn: (s: Record<string, unknown>) => Record<string, unknown>) => Record<string, unknown>;
};
const mockRunFullAnalysis = vi.fn(
  async (_ctx: { store: Store }, _opts: Record<string, unknown>): Promise<{ success: boolean; aborted: boolean; error?: string }> => ({
    success: true,
    aborted: false,
  }),
);
vi.mock('../competitors/pipeline', () => ({
  runFullAnalysis: (ctx: { store: Store }, opts: Record<string, unknown>) => mockRunFullAnalysis(ctx, opts),
  createMemoryStore: (initial: Record<string, unknown>, onChange?: (s: Record<string, unknown>) => void): Store => {
    let state = initial;
    return {
      get: () => state,
      update: (fn) => {
        state = fn(state);
        onChange?.(state);
        return state;
      },
    };
  },
}));

vi.mock('../../../utils/json-repair', () => ({
  safeParseJson: (text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  },
}));

// tryLoadPrompt — return a stub prompt so the runner's context blocks are appended
vi.mock('../../prompts/prompt-loader', () => ({
  tryLoadPrompt: vi.fn((name: string) => `# ${name} prompt`),
}));

// =============================================================================
// Import after mocking
// =============================================================================

import { runRoadmapGeneration } from '../roadmap';
import type { RoadmapConfig, RoadmapStreamEvent } from '../roadmap';

// =============================================================================
// Helpers
// =============================================================================

const OUT = '/project/.malvy/roadmap';
const DISCOVERY = `${OUT}/roadmap_discovery.json`;
const ROADMAP = `${OUT}/roadmap.json`;
const COMPETITOR = `${OUT}/competitor_analysis.json`;

const VALID_DISCOVERY = {
  project_name: 'TestProject',
  target_audience: 'Developers',
  product_vision: 'Make coding easier',
};

const VALID_ROADMAP = {
  vision: 'Automate everything',
  target_audience: { primary: 'Developers' },
  phases: [{ id: 'p1', name: 'MVP' }],
  features: [
    { id: 'f1', title: 'Feature A', status: 'idea' },
    { id: 'f2', title: 'Feature B', status: 'idea' },
    { id: 'f3', title: 'Feature C', status: 'idea' },
  ],
};

const freshCompetitor = (analyzedAt = new Date().toISOString()) => ({
  analyzed_at: analyzedAt,
  project_context: { project_name: 'TestProject' },
  competitors: [{ id: 'competitor-1', name: 'Rival', pain_points: [{ id: 'pain-1-1', description: 'Slow' }] }],
});

const STRATEGY = `${OUT}/strategy.json`;

/** Pipeline stand-in: profiles one competitor into the store (which persists both files) */
function pipelineProfilesRival() {
  mockRunFullAnalysis.mockImplementationOnce(async (ctx) => {
    ctx.store.update((s) => ({
      ...s,
      analyzedAt: new Date().toISOString(),
      competitors: [
        {
          id: 'c-rival', name: 'Rival', url: 'https://rival.example', oneLiner: 'Rival app', relevanceScore: 90,
          analyzed: true, positioning: 'Rival app', targetAudience: '', keyFeatures: [], pricingModel: '',
          strengths: [], weaknesses: [], differentiator: '', relevance: 'high', painPoints: [], source: 'ai',
          status: 'done', profiledAt: new Date().toISOString(),
        },
      ],
    }));
    return { success: true, aborted: false };
  });
}

/** Default responder: answers each phase with valid tagged JSON */
const happyResponder: Responder = (prompt) => {
  if (prompt.includes('<roadmap_discovery>')) {
    return { text: `<roadmap_discovery>${JSON.stringify(VALID_DISCOVERY)}</roadmap_discovery>` };
  }
  return { text: `<roadmap_features>${JSON.stringify(VALID_ROADMAP)}</roadmap_features>` };
};

function baseConfig(overrides: Partial<RoadmapConfig> = {}): RoadmapConfig {
  return { projectDir: '/project', outputDir: OUT, ...overrides };
}

// =============================================================================
// Tests
// =============================================================================

describe('runRoadmapGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    files.clear();
    spawnCalls.length = 0;
    responder = happyResponder;
  });

  it('runs discovery then features and writes both files', async () => {
    const result = await runRoadmapGeneration(baseConfig());

    expect(result.success).toBe(true);
    expect(result.roadmapPath).toBe(ROADMAP);
    expect(result.phases.map((p) => p.phase)).toEqual(['discovery', 'features']);
    expect(JSON.parse(files.get(DISCOVERY) ?? '{}').project_name).toBe('TestProject');
    expect(JSON.parse(files.get(ROADMAP) ?? '{}').features).toHaveLength(3);
  });

  it('returns failure and skips features when discovery fails after all retries', async () => {
    responder = () => ({ text: 'no tags here' });

    const result = await runRoadmapGeneration(baseConfig());

    expect(result.success).toBe(false);
    expect(result.error).toContain('Discovery failed');
    expect(result.phases).toHaveLength(1);
    expect(spawnCalls).toHaveLength(3);
  });

  it('records the CLI error when the process exits non-zero', async () => {
    responder = () => ({ text: '', code: 1 });

    const result = await runRoadmapGeneration(baseConfig());

    expect(result.success).toBe(false);
    expect(result.phases[0].errors[0]).toContain('claude CLI failed');
  });

  it('skips phases whose output already exists when refresh=false', async () => {
    files.set(DISCOVERY, JSON.stringify(VALID_DISCOVERY));
    files.set(ROADMAP, JSON.stringify(VALID_ROADMAP));

    const result = await runRoadmapGeneration(baseConfig({ refresh: false }));

    expect(result.success).toBe(true);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('emits phase-start/phase-complete events and forwards text deltas', async () => {
    const events: RoadmapStreamEvent[] = [];
    await runRoadmapGeneration(baseConfig(), (e) => events.push(e));

    const starts = events.filter((e) => e.type === 'phase-start').map((e) => (e as { phase: string }).phase);
    expect(starts).toEqual(['discovery', 'features']);
    expect(events.some((e) => e.type === 'text-delta')).toBe(true);
  });

  it('uses sonnet by default and honours a custom modelShorthand', async () => {
    await runRoadmapGeneration(baseConfig());
    expect(mockResolveModelId).toHaveBeenLastCalledWith('sonnet');

    files.clear();
    await runRoadmapGeneration(baseConfig({ modelShorthand: 'haiku' }));
    expect(mockResolveModelId).toHaveBeenLastCalledWith('haiku');
    expect(spawnCalls.at(-1)?.args).toContain('model-haiku');
  });

  it('defaults the output directory to <project>/.malvy/roadmap', async () => {
    const result = await runRoadmapGeneration({ projectDir: '/my/project' });

    expect(result.roadmapPath).toBe('/my/project/.malvy/roadmap/roadmap.json');
  });

  // ---------------------------------------------------------------------------
  // Competitor analysis
  // ---------------------------------------------------------------------------

  describe('competitor analysis', () => {
    it('does not run when disabled', async () => {
      const result = await runRoadmapGeneration(baseConfig());

      expect(result.phases.map((p) => p.phase)).not.toContain('competitor_analysis');
      expect(mockRunFullAnalysis).not.toHaveBeenCalled();
    });

    it('delegates to the Competitors pipeline (with synthesis when no ranking is saved), saves the file and feeds it to features', async () => {
      pipelineProfilesRival();
      const result = await runRoadmapGeneration(baseConfig({ enableCompetitorAnalysis: true }));

      expect(result.success).toBe(true);
      expect(result.phases.map((p) => p.phase)).toEqual(['discovery', 'competitor_analysis', 'features']);
      expect(mockRunFullAnalysis).toHaveBeenCalledTimes(1);
      expect(mockRunFullAnalysis.mock.calls[0][1]).toMatchObject({ synthesize: true });

      const saved = JSON.parse(files.get(COMPETITOR) ?? '{}');
      expect(saved.competitors[0].name).toBe('Rival');
      expect(saved.created_at).toBeDefined();

      const featuresCall = spawnCalls.at(-1);
      expect(featuresCall?.prompt).toContain(COMPETITOR);
      expect(featuresCall?.prompt).toContain('competitor_insight_ids');
    });

    it('reuses a fresh analysis from the Competitors page unless refreshCompetitorAnalysis is set', async () => {
      files.set(COMPETITOR, JSON.stringify(freshCompetitor()));

      await runRoadmapGeneration(baseConfig({ enableCompetitorAnalysis: true, refresh: true }));
      expect(mockRunFullAnalysis).not.toHaveBeenCalled();
      expect(spawnCalls.at(-1)?.prompt).toContain(COMPETITOR);

      await runRoadmapGeneration(
        baseConfig({ enableCompetitorAnalysis: true, refresh: true, refreshCompetitorAnalysis: true }),
      );
      expect(mockRunFullAnalysis).toHaveBeenCalledTimes(1);
    });

    it('re-runs the pipeline when the cached analysis is stale', async () => {
      files.set(COMPETITOR, JSON.stringify(freshCompetitor('2020-01-01T00:00:00.000Z')));

      await runRoadmapGeneration(baseConfig({ enableCompetitorAnalysis: true }));

      expect(mockRunFullAnalysis).toHaveBeenCalledTimes(1);
    });

    it('continues to the features phase when competitor analysis fails', async () => {
      mockRunFullAnalysis.mockResolvedValueOnce({ success: false, aborted: false, error: 'Discovery failed: boom' });
      const events: RoadmapStreamEvent[] = [];

      const result = await runRoadmapGeneration(baseConfig({ enableCompetitorAnalysis: true }), (e) => events.push(e));

      expect(result.success).toBe(true);
      const competitor = result.phases.find((p) => p.phase === 'competitor_analysis');
      expect(competitor?.success).toBe(false);
      expect(files.has(COMPETITOR)).toBe(false);
      expect(spawnCalls.at(-1)?.prompt).not.toContain(COMPETITOR);
      expect(events.some((e) => e.type === 'error')).toBe(true);
    });
  });

  describe('strategy guidance from the Competitors page', () => {
    const ranked = {
      directions: [
        { id: 'dir-coach', title: 'Coach-first', description: 'AI programs', avoid: false, note: 'Our core bet' },
        { id: 'dir-cheap', title: 'Cheapest option', avoid: true, note: 'Race to the bottom' },
      ],
      ranking_saved_at: new Date().toISOString(),
    };

    it('adds the ranked directions to the discovery and features prompts', async () => {
      files.set(STRATEGY, JSON.stringify(ranked));

      await runRoadmapGeneration(baseConfig());

      const [discoveryCall, featuresCall] = spawnCalls;
      for (const call of [discoveryCall, featuresCall]) {
        expect(call.prompt).toContain('STRATEGIC DIRECTION');
        expect(call.prompt).toContain('1. Coach-first');
        expect(call.prompt).toContain('Our core bet');
        expect(call.prompt).toMatch(/Steer away from[\s\S]*Cheapest option/);
      }
    });

    it('adds nothing when no ranking was saved', async () => {
      files.set(STRATEGY, JSON.stringify({ ...ranked, ranking_saved_at: null }));

      await runRoadmapGeneration(baseConfig());

      expect(spawnCalls.every((c) => !c.prompt.includes('STRATEGIC DIRECTION'))).toBe(true);
    });

    it('lists the directions with ids in the features prompt and asks for direction_ids', async () => {
      files.set(STRATEGY, JSON.stringify(ranked));

      await runRoadmapGeneration(baseConfig());

      const [discoveryCall, featuresCall] = spawnCalls;
      expect(featuresCall.prompt).toContain('DIRECTION TAGS');
      expect(featuresCall.prompt).toContain('id "dir-coach" — #1 Coach-first');
      expect(featuresCall.prompt).toContain('id "dir-cheap" — #2 Cheapest option (AVOID)');
      expect(featuresCall.prompt).toContain('"direction_ids"');
      expect(discoveryCall.prompt).not.toContain('DIRECTION TAGS');
    });

    it('drops unknown direction ids from the generated features', async () => {
      files.set(STRATEGY, JSON.stringify(ranked));
      responder = (prompt) =>
        prompt.includes('<roadmap_discovery>')
          ? { text: `<roadmap_discovery>${JSON.stringify(VALID_DISCOVERY)}</roadmap_discovery>` }
          : {
              text: `<roadmap_features>${JSON.stringify({
                ...VALID_ROADMAP,
                features: [
                  { id: 'f1', title: 'A', direction_ids: ['dir-coach', 'dir-ghost'] },
                  { id: 'f2', title: 'B', direction_ids: 'dir-coach' },
                  { id: 'f3', title: 'C' },
                ],
              })}</roadmap_features>`,
            };

      await runRoadmapGeneration(baseConfig());

      const features = JSON.parse(files.get(ROADMAP) ?? '{}').features;
      expect(features.map((f: { direction_ids?: string[] }) => f.direction_ids)).toEqual([['dir-coach'], [], []]);
    });

    it('strips direction_ids when there is no strategy', async () => {
      responder = (prompt) =>
        prompt.includes('<roadmap_discovery>')
          ? { text: `<roadmap_discovery>${JSON.stringify(VALID_DISCOVERY)}</roadmap_discovery>` }
          : {
              text: `<roadmap_features>${JSON.stringify({
                ...VALID_ROADMAP,
                features: VALID_ROADMAP.features.map((f) => ({ ...f, direction_ids: ['dir-x'] })),
              })}</roadmap_features>`,
            };

      await runRoadmapGeneration(baseConfig());

      expect(spawnCalls.every((c) => !c.prompt.includes('DIRECTION TAGS'))).toBe(true);
      const features = JSON.parse(files.get(ROADMAP) ?? '{}').features;
      expect(features.every((f: Record<string, unknown>) => !('direction_ids' in f))).toBe(true);
    });
  });
});

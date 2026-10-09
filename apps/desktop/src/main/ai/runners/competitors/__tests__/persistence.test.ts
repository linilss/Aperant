import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyDirectionRanking,
  competitorFilePath,
  emptyCompetitorState,
  isCompetitorAnalysisFresh,
  loadCompetitorState,
  saveCompetitorState,
  strategyFilePath,
} from '../persistence';
import { buildStrategyGuidance, loadStrategyGuidance, splitRankedDirections } from '../guidance';
import type { CompetitorProfile, CompetitorStrategyState, StrategicDirection } from '../../../../../shared/types/competitors';

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'malvy-competitors-'));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

const competitor = (name: string, overrides: Partial<CompetitorProfile> = {}): CompetitorProfile => ({
  id: `c-${name.toLowerCase()}`,
  name,
  url: `https://${name.toLowerCase()}.example`,
  oneLiner: `${name} one-liner`,
  relevanceScore: 80,
  analyzed: true,
  positioning: `${name} positioning`,
  targetAudience: 'Runners',
  keyFeatures: ['Plans'],
  pricingModel: 'Freemium',
  strengths: ['Brand'],
  weaknesses: ['Price'],
  differentiator: 'AI coach',
  relevance: 'high',
  painPoints: [{ id: `c-${name.toLowerCase()}-pain-1`, description: 'Too expensive', source: 'Reviews', severity: 'medium', frequency: '', opportunity: '' }],
  source: 'ai',
  status: 'done',
  profiledAt: '2026-10-09T10:00:00.000Z',
  ...overrides,
});

const direction = (title: string, overrides: Partial<StrategicDirection> = {}): StrategicDirection => ({
  id: `dir-${title.toLowerCase().replace(/\s+/g, '-')}`,
  title,
  description: `${title} description`,
  occupiedBy: [],
  opportunity: `${title} gap`,
  fit: 'Good',
  fitSources: [],
  risk: 'Some',
  avoid: false,
  note: '',
  ...overrides,
});

function sampleState(): CompetitorStrategyState {
  return {
    ...emptyCompetitorState(),
    projectName: 'FitApp',
    focus: 'iOS',
    competitorCount: 7,
    analyzedAt: '2026-10-09T10:00:00.000Z',
    competitors: [
      competitor('Alpha'),
      competitor('Beta', { analyzed: false, status: 'idle', profiledAt: undefined, relevanceScore: 40 }),
      competitor('Gamma', { analyzed: false, status: 'idle', source: 'manual', profiledAt: undefined }),
    ],
    directions: [direction('Coach first'), direction('Cheapest'), direction('Community'), direction('Pro tool')],
    directionsSynthesizedAt: '2026-10-09T10:05:00.000Z',
  };
}

describe('competitor persistence', () => {
  it('round-trips analyzed set, pool, slider value and directions; writes only under .malvy/roadmap', () => {
    saveCompetitorState(projectDir, sampleState());

    expect(readdirSync(projectDir)).toEqual(['.malvy']);
    expect(readdirSync(join(projectDir, '.malvy', 'roadmap')).sort()).toEqual(['competitor_analysis.json', 'strategy.json']);
    const loaded = loadCompetitorState(projectDir);
    expect(loaded).toEqual({ ...sampleState(), directionsError: undefined });
  });

  it('keeps the roadmap reader contract: competitors = analyzed set, pool separate, gaps/insights derived', () => {
    saveCompetitorState(projectDir, sampleState());

    const raw = JSON.parse(readFileSync(competitorFilePath(projectDir), 'utf-8'));
    expect(raw.competitors.map((c: { name: string }) => c.name)).toEqual(['Alpha']);
    expect(raw.competitor_pool.map((c: { name: string }) => c.name)).toEqual(['Beta', 'Gamma']);
    expect(raw.competitors[0]).toMatchObject({
      description: 'Alpha positioning',
      market_position: 'AI coach',
      pain_points: [{ id: 'c-alpha-pain-1', description: 'Too expensive' }],
    });
    expect(raw.market_gaps.map((g: { suggested_feature: string }) => g.suggested_feature)).toEqual([
      'Coach first',
      'Cheapest',
      'Community',
      'Pro tool',
    ]);
    expect(raw.metadata.created_at).toBe('2026-10-09T10:00:00.000Z');
    expect(raw.competitor_count).toBe(7);
  });

  it('reads the older roadmap-phase format (no status/pool) as fully analyzed', () => {
    mkdirSync(join(projectDir, '.malvy', 'roadmap'), { recursive: true });
    writeFileSync(
      competitorFilePath(projectDir),
      JSON.stringify({
        project_context: { project_name: 'Old' },
        competitors: [{ id: 'competitor-1', name: 'Rival', description: 'Old desc', pain_points: [{ id: 'pain-1-1', description: 'Slow' }] }],
        created_at: '2026-10-01T00:00:00.000Z',
      }),
    );

    const state = loadCompetitorState(projectDir);

    expect(state?.competitors[0]).toMatchObject({ id: 'competitor-1', analyzed: true, status: 'done', positioning: 'Old desc' });
    expect(state?.competitors[0].painPoints[0].id).toBe('pain-1-1');
    expect(state?.analyzedAt).toBe('2026-10-01T00:00:00.000Z');
    expect(state?.competitorCount).toBe(5);
  });

  it('turns interrupted runs into errors (analyzed) or idle (pool) on load', () => {
    const state = sampleState();
    state.competitors[0].status = 'running';
    state.competitors[1].status = 'queued';
    saveCompetitorState(projectDir, state);

    const loaded = loadCompetitorState(projectDir);

    expect(loaded?.competitors[0].status).toBe('error');
    expect(loaded?.competitors[1].status).toBe('idle');
  });

  it('returns null when nothing was saved', () => {
    expect(loadCompetitorState(projectDir)).toBeNull();
    expect(existsSync(strategyFilePath(projectDir))).toBe(false);
  });
});

describe('ranking', () => {
  it('reorders, marks avoided, stores notes and the save time; survives a reload', () => {
    const ranked = applyDirectionRanking(
      sampleState(),
      {
        order: ['dir-community', 'dir-coach-first', 'unknown-id'],
        avoided: ['dir-cheapest'],
        notes: { 'dir-community': '  Our niche  ', 'dir-cheapest': 'x'.repeat(900) },
      },
      new Date('2026-10-09T11:00:00.000Z'),
    );

    expect(ranked.directions.map((d) => d.id)).toEqual(['dir-community', 'dir-coach-first', 'dir-cheapest', 'dir-pro-tool']);
    expect(ranked.directions.find((d) => d.id === 'dir-cheapest')?.avoid).toBe(true);
    expect(ranked.directions[0].note).toBe('Our niche');
    expect(ranked.directions.find((d) => d.id === 'dir-cheapest')?.note).toHaveLength(500);
    expect(ranked.rankingSavedAt).toBe('2026-10-09T11:00:00.000Z');

    saveCompetitorState(projectDir, ranked);
    expect(loadCompetitorState(projectDir)?.directions.map((d) => [d.id, d.avoid, d.note.slice(0, 9)])).toEqual([
      ['dir-community', false, 'Our niche'],
      ['dir-coach-first', false, ''],
      ['dir-cheapest', true, 'xxxxxxxxx'],
      ['dir-pro-tool', false, ''],
    ]);
  });
});

describe('freshness', () => {
  const now = new Date('2026-10-09T12:00:00.000Z');
  it('is fresh within 30 days with at least one analyzed profile', () => {
    expect(isCompetitorAnalysisFresh(sampleState(), now)).toBe(true);
    expect(isCompetitorAnalysisFresh({ ...sampleState(), analyzedAt: '2026-08-01T00:00:00.000Z' }, now)).toBe(false);
    expect(isCompetitorAnalysisFresh({ ...sampleState(), analyzedAt: null }, now)).toBe(false);
    const noneDone = sampleState();
    noneDone.competitors = noneDone.competitors.map((c) => ({ ...c, status: 'error' as const }));
    expect(isCompetitorAnalysisFresh(noneDone, now)).toBe(false);
    expect(isCompetitorAnalysisFresh(null, now)).toBe(false);
  });
});

describe('strategy guidance', () => {
  const rankedState = () =>
    applyDirectionRanking(sampleState(), {
      order: ['dir-community', 'dir-cheapest', 'dir-coach-first', 'dir-pro-tool'],
      avoided: ['dir-cheapest'],
      notes: { 'dir-community': 'Our niche', 'dir-cheapest': 'Race to the bottom' },
    });

  it('is empty until a ranking is saved', () => {
    expect(buildStrategyGuidance(sampleState())).toBe('');
    expect(buildStrategyGuidance(null)).toBe('');
  });

  it('pursues the top 3 non-avoided directions in order, steers away from avoided ones, includes notes', () => {
    const { pursue, avoid } = splitRankedDirections(rankedState());
    expect(pursue.map((d) => d.title)).toEqual(['Community', 'Coach first', 'Pro tool']);
    expect(avoid.map((d) => d.title)).toEqual(['Cheapest']);

    const text = buildStrategyGuidance(rankedState());
    expect(text).toContain('STRATEGIC DIRECTION');
    expect(text).toMatch(/1\. Community — Community description Opportunity: Community gap User note: "Our niche"/);
    expect(text).toContain('2. Coach first');
    expect(text).toContain('3. Pro tool');
    expect(text).toMatch(/Steer away from[^\n]*\n- Cheapest User note: "Race to the bottom"/);
    expect(text).toContain('MoSCoW');
  });

  it('lists directions beyond the top 3 as lower priority', () => {
    const state = applyDirectionRanking(
      { ...sampleState(), directions: [...sampleState().directions, direction('Enterprise')] },
      { order: [], avoided: [], notes: {} },
    );
    expect(buildStrategyGuidance(state)).toContain('Lower priority: Pro tool; Enterprise');
  });

  it('loads from disk', () => {
    saveCompetitorState(projectDir, rankedState());
    expect(loadStrategyGuidance(projectDir)).toContain('1. Community');
    rmSync(join(projectDir, '.malvy'), { recursive: true });
    expect(loadStrategyGuidance(projectDir)).toBe('');
  });
});

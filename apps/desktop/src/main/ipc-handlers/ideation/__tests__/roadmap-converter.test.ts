import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { RawIdea } from '../types';

const mockGetProject = vi.fn();
vi.mock('../../../project-store', () => ({
  projectStore: { getProject: (id: string) => mockGetProject(id) },
}));

import {
  BACKLOG_PHASE_ID,
  addIdeaToRoadmap,
  addIdeaToRoadmapHandler,
  buildFeatureFromIdea,
  suggestRoadmapPriority,
} from '../roadmap-converter';
import { transformRoadmapFromSnakeCase } from '../../roadmap/transformers';

const NOW = new Date('2026-10-09T12:00:00.000Z');

function idea(overrides: Partial<RawIdea> = {}): RawIdea {
  return {
    id: 'idea-1',
    type: 'code_improvements',
    title: 'Cache project index',
    description: 'Avoid re-reading the index',
    rationale: 'Faster startup',
    ...overrides,
  };
}

describe('suggestRoadmapPriority', () => {
  it.each([
    [{ type: 'security_hardening', severity: 'critical' }, 'must'],
    [{ type: 'security_hardening', severity: 'high' }, 'should'],
    [{ type: 'security_hardening', severity: 'medium' }, 'could'],
    [{ type: 'code_quality', severity: 'critical' }, 'must'],
    [{ type: 'code_quality', severity: 'major' }, 'should'],
    [{ type: 'code_quality', severity: 'suggestion' }, 'could'],
    [{ type: 'performance_optimizations', impact: 'high' }, 'should'],
    [{ type: 'performance_optimizations', impact: 'low' }, 'could'],
    [{ type: 'documentation_gaps', priority: 'high' }, 'should'],
    [{ type: 'code_improvements' }, 'could'],
  ] as Array<[Partial<RawIdea>, string]>)('%o → %s', (fields, expected) => {
    expect(suggestRoadmapPriority(idea(fields))).toBe(expected);
  });
});

describe('buildFeatureFromIdea', () => {
  it('copies text, maps effort/impact, keeps known direction ids and links back to the idea', () => {
    const feature = buildFeatureFromIdea(
      idea({
        type: 'performance_optimizations',
        impact: 'high',
        estimated_effort: 'small',
        direction_ids: ['dir-a', 'gone', 'dir-a'],
      }),
      { featureId: 'feature-x', phaseId: 'phase-1', knownDirectionIds: new Set(['dir-a']), now: NOW }
    );
    expect(feature).toEqual({
      id: 'feature-x',
      title: 'Cache project index',
      description: 'Avoid re-reading the index',
      rationale: 'Faster startup',
      priority: 'should',
      complexity: 'low',
      impact: 'high',
      phase_id: 'phase-1',
      dependencies: [],
      status: 'under_review',
      acceptance_criteria: [],
      user_stories: [],
      direction_ids: ['dir-a'],
      source: { provider: 'internal', imported_at: NOW.toISOString() },
      source_idea_id: 'idea-1',
    });
  });

  it('omits direction_ids for untagged ideas or without a strategy', () => {
    const opts = { featureId: 'f', phaseId: 'p', now: NOW };
    expect(buildFeatureFromIdea(idea(), { ...opts, knownDirectionIds: new Set(['dir-a']) })).not.toHaveProperty(
      'direction_ids'
    );
    expect(
      buildFeatureFromIdea(idea({ direction_ids: ['dir-a'] }), { ...opts, knownDirectionIds: new Set() })
    ).not.toHaveProperty('direction_ids');
  });
});

describe('addIdeaToRoadmap', () => {
  it('appends to the first phase and preserves every existing roadmap field', () => {
    const roadmap = {
      id: 'roadmap-1',
      vision: 'Ship it',
      custom_top_level: { keep: true },
      phases: [
        { id: 'phase-2', name: 'Later', order: 2, features: [] },
        { id: 'phase-1', name: 'MVP', order: 1, features: ['f-1'], extra: 1 },
      ],
      features: [{ id: 'f-1', title: 'Existing', some_unknown_field: { nested: true } }],
      metadata: { created_at: '2026-01-01T00:00:00.000Z', generator: 'x' },
    };
    const before = structuredClone(roadmap);

    const feature = addIdeaToRoadmap(roadmap, idea(), { knownDirectionIds: new Set(), now: NOW, featureId: 'f-new' });

    expect(feature.phase_id).toBe('phase-1');
    expect(roadmap.features).toHaveLength(2);
    expect(roadmap.features[0]).toEqual(before.features[0]);
    expect(roadmap.phases[1]).toEqual({ ...before.phases[1], features: ['f-1', 'f-new'] });
    expect(roadmap.phases[0]).toEqual(before.phases[0]);
    expect(roadmap.custom_top_level).toEqual({ keep: true });
    expect(roadmap.metadata).toEqual({ ...before.metadata, updated_at: NOW.toISOString() });
  });

  it('creates a Backlog phase when the roadmap has none', () => {
    const roadmap: Record<string, unknown> & { phases?: Array<Record<string, unknown>> } = { features: [] };
    const feature = addIdeaToRoadmap(roadmap, idea(), { knownDirectionIds: new Set(), now: NOW, featureId: 'f-new' });
    expect(feature.phase_id).toBe(BACKLOG_PHASE_ID);
    expect(roadmap.phases?.[0]).toMatchObject({ id: BACKLOG_PHASE_ID, features: ['f-new'] });
  });
});

describe('addIdeaToRoadmapHandler', () => {
  let projectDir: string;
  const event = {} as IpcMainInvokeEvent;
  const ideationFile = () => path.join(projectDir, '.malvy', 'ideation', 'ideation.json');
  const roadmapFile = () => path.join(projectDir, '.malvy', 'roadmap', 'roadmap.json');
  const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf-8'));

  beforeEach(() => {
    projectDir = mkdtempSync(path.join(tmpdir(), 'idea-roadmap-'));
    mockGetProject.mockReturnValue({ id: 'p1', name: 'Demo', path: projectDir });
    mkdirSync(path.dirname(ideationFile()), { recursive: true });
    writeFileSync(
      ideationFile(),
      JSON.stringify({
        id: 'ideation-1',
        ideas: [
          idea({ type: 'security_hardening', severity: 'critical', direction_ids: ['dir-a', 'stale'] }),
          idea({ id: 'idea-2', title: 'Other' }),
        ],
      })
    );
    mkdirSync(path.dirname(roadmapFile()), { recursive: true });
    writeFileSync(
      path.join(projectDir, '.malvy', 'roadmap', 'strategy.json'),
      JSON.stringify({ directions: [{ id: 'dir-a', title: 'Coach-first' }] })
    );
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('creates a minimal roadmap the roadmap UI accepts when none exists, and links the idea', async () => {
    const result = await addIdeaToRoadmapHandler(event, 'p1', 'idea-1');

    expect(result.success).toBe(true);
    const featureId = result.data?.featureId as string;
    const raw = readJson(roadmapFile());
    const roadmap = transformRoadmapFromSnakeCase(raw, 'p1');
    expect(roadmap.projectName).toBe('Demo');
    expect(roadmap.phases).toHaveLength(1);
    expect(roadmap.features).toHaveLength(1);
    expect(roadmap.features[0]).toMatchObject({
      id: featureId,
      title: 'Cache project index',
      priority: 'must',
      status: 'under_review',
      phaseId: roadmap.phases[0].id,
      directionIds: ['dir-a'],
      sourceIdeaId: 'idea-1',
      source: { provider: 'internal' },
    });

    const ideation = readJson(ideationFile());
    expect(ideation.ideas[0]).toMatchObject({ status: 'converted', roadmap_feature_id: featureId });
    expect(ideation.ideas[1].status).toBeUndefined();
    expect(ideation.ideas[0].linked_task_id).toBeUndefined();
  });

  it('appends to an existing roadmap without touching other fields and is idempotent', async () => {
    const existing = {
      id: 'roadmap-1',
      project_name: 'Demo',
      vision: 'Ship it',
      target_audience: { primary: 'Devs', secondary: [] },
      phases: [{ id: 'phase-1', name: 'MVP', order: 1, features: ['f-1'] }],
      features: [{ id: 'f-1', title: 'Existing', priority: 'must', some_unknown_field: 1 }],
      metadata: { created_at: '2026-01-01T00:00:00.000Z' },
    };
    writeFileSync(roadmapFile(), JSON.stringify(existing));

    const first = await addIdeaToRoadmapHandler(event, 'p1', 'idea-2');
    const second = await addIdeaToRoadmapHandler(event, 'p1', 'idea-2');

    expect(second).toEqual(first);
    const raw = readJson(roadmapFile());
    expect(raw.features).toHaveLength(2);
    expect(raw.features[0]).toEqual(existing.features[0]);
    expect(raw.features[1]).toMatchObject({ title: 'Other', priority: 'could', phase_id: 'phase-1' });
    expect(raw.vision).toBe('Ship it');
    expect(raw.target_audience).toEqual(existing.target_audience);
  });

  it('fails for an unknown idea without creating a roadmap', async () => {
    const result = await addIdeaToRoadmapHandler(event, 'p1', 'nope');
    expect(result).toEqual({ success: false, error: 'Idea not found' });
    expect(existsSync(roadmapFile())).toBe(false);
  });
});

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../../../shared/constants';
import type { RoadmapFeatureRefineInput } from '../../../ai/runners/roadmap-feature-refine';
import type { FeatureRefinement } from '../feature-persistence';
import { createFeatureRefineService, type FeatureRefineServiceDeps } from '../feature-refine-service';

const LINE = 'export streaks to csv';

const refinement: FeatureRefinement = {
  title: 'CSV export of streaks',
  description: 'Download streak history as CSV.',
  rationale: 'Users own their data.',
  complexity: 'low',
  impact: 'high',
  priority: 'could',
  phaseId: 'phase-2',
  acceptanceCriteria: ['Button exists'],
  directionIds: [],
  duplicateOf: null,
};

let dir: string;
let roadmapFile: string;

function writeRoadmap(featureIds: string[]) {
  const roadmap = {
    vision: 'keep me',
    phases: [{ id: 'phase-1', name: 'MVP' }, { id: 'phase-2', name: 'Growth' }],
    features: featureIds.map((id) => ({
      id,
      title: LINE,
      description: LINE,
      rationale: '',
      priority: 'should',
      complexity: 'medium',
      impact: 'medium',
      phase_id: 'phase-1',
      status: 'under_review',
      acceptance_criteria: [],
    })),
  };
  writeFileSync(roadmapFile, JSON.stringify(roadmap, null, 2));
}

const readRoadmap = () => JSON.parse(readFileSync(roadmapFile, 'utf-8'));

function makeDeps(overrides: Partial<FeatureRefineServiceDeps> = {}) {
  const emitted: Array<[string, ...unknown[]]> = [];
  const deps: FeatureRefineServiceDeps = {
    getProjectPath: (id) => (id === 'p1' ? dir : null),
    runRefine: vi.fn(async () => ({ refinement })),
    resolveModelId: () => 'claude-sonnet-test',
    loadKnownDirectionIds: () => new Set(),
    emit: (channel, ...args) => emitted.push([channel, ...args]),
    now: () => new Date('2026-10-09T10:00:00.000Z'),
    ...overrides,
  };
  return { deps, emitted };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'malvy-refine-'));
  mkdirSync(path.join(dir, '.malvy', 'roadmap'), { recursive: true });
  roadmapFile = path.join(dir, '.malvy', 'roadmap', 'roadmap.json');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('feature refine service', () => {
  it('patches roadmap.json, returns the camelCase feature and emits started + refined', async () => {
    writeRoadmap(['f-1', 'f-2']);
    const { deps, emitted } = makeDeps();
    const service = createFeatureRefineService(deps);

    const result = await service.refineFeature('p1', 'f-1', LINE, { suggestPriority: true });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ id: 'f-1', title: 'CSV export of streaks', priority: 'could', phaseId: 'phase-2' });
    const file = readRoadmap();
    expect(file.vision).toBe('keep me');
    expect(file.features[0]).toMatchObject({ title: 'CSV export of streaks', refined_at: '2026-10-09T10:00:00.000Z' });
    expect(file.features[1].title).toBe(LINE);

    const input = (deps.runRefine as ReturnType<typeof vi.fn>).mock.calls[0][0] as RoadmapFeatureRefineInput;
    expect(input.line).toBe(LINE);
    expect(input.existingFeatures).toEqual([{ id: 'f-2', title: LINE }]);
    expect(input.phases.map((p) => p.id)).toEqual(['phase-1', 'phase-2']);
    expect(input.modelId).toBe('claude-sonnet-test');

    expect(emitted.map((e) => e[0])).toEqual([
      IPC_CHANNELS.ROADMAP_FEATURE_REFINE_STARTED,
      IPC_CHANNELS.ROADMAP_FEATURE_REFINED,
    ]);
    expect(emitted[1][1]).toBe('p1');
    expect(emitted[1][2]).toMatchObject({ id: 'f-1', title: 'CSV export of streaks' });
  });

  it('on failure leaves the feature untouched and emits a failure event', async () => {
    writeRoadmap(['f-1']);
    const before = readFileSync(roadmapFile, 'utf-8');
    const { deps, emitted } = makeDeps({
      runRefine: vi.fn(async () => {
        throw new Error('claude CLI failed: rate limited');
      }),
    });
    const service = createFeatureRefineService(deps);

    const result = await service.refineFeature('p1', 'f-1', LINE, { suggestPriority: true });

    expect(result).toEqual({ success: false, error: 'claude CLI failed: rate limited' });
    expect(readFileSync(roadmapFile, 'utf-8')).toBe(before);
    expect(emitted.at(-1)).toEqual([IPC_CHANNELS.ROADMAP_FEATURE_REFINE_FAILED, 'p1', 'f-1', 'claude CLI failed: rate limited']);
  });

  it('emits failure for an unknown project or feature', async () => {
    writeRoadmap(['f-1']);
    const { deps, emitted } = makeDeps();
    const service = createFeatureRefineService(deps);
    expect((await service.refineFeature('nope', 'f-1', LINE, { suggestPriority: true })).success).toBe(false);
    expect((await service.refineFeature('p1', 'gone', LINE, { suggestPriority: true })).success).toBe(false);
    expect(emitted.map((e) => e[0])).toEqual([
      IPC_CHANNELS.ROADMAP_FEATURE_REFINE_FAILED,
      IPC_CHANNELS.ROADMAP_FEATURE_REFINE_FAILED,
    ]);
    expect(deps.runRefine).not.toHaveBeenCalled();
  });

  it('runs at most 2 refinements per project concurrently and patches all of them', async () => {
    const ids = ['f-1', 'f-2', 'f-3', 'f-4', 'f-5'];
    writeRoadmap(ids);
    let running = 0;
    let peak = 0;
    const { deps } = makeDeps({
      runRefine: vi.fn(async (input: RoadmapFeatureRefineInput) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 10));
        running--;
        return { refinement: { ...refinement, title: `Refined ${input.existingFeatures.length}` } };
      }),
    });
    const service = createFeatureRefineService(deps);

    const results = await Promise.all(ids.map((id) => service.refineFeature('p1', id, LINE, { suggestPriority: false })));

    expect(results.every((r) => r.success)).toBe(true);
    expect(peak).toBe(2);
    expect(readRoadmap().features.every((f: Record<string, unknown>) => typeof f.refined_at === 'string')).toBe(true);
  });

  it('drops a second request for a feature that is already refining', async () => {
    writeRoadmap(['f-1']);
    const { deps } = makeDeps();
    const service = createFeatureRefineService(deps);
    const [first, second] = await Promise.all([
      service.refineFeature('p1', 'f-1', LINE, { suggestPriority: true }),
      service.refineFeature('p1', 'f-1', LINE, { suggestPriority: true }),
    ]);
    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    expect(deps.runRefine).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect } from 'vitest';
import {
  applyFeatureRefinement,
  featureToSnakeCase,
  featureFromSnakeCase,
  keepNewerRefinements,
  snapshotRawFeature,
  type FeatureRefinement,
} from '../feature-persistence';

const LINE = 'export streaks to csv';
const NOW = new Date('2026-10-09T10:00:00.000Z');

function makeRoadmap() {
  return {
    phases: [{ id: 'phase-1', name: 'MVP' }, { id: 'phase-2', name: 'Growth' }],
    features: [
      {
        id: 'f-new',
        title: LINE,
        description: LINE,
        rationale: `User-created feature for ${LINE}`,
        priority: 'should',
        complexity: 'medium',
        impact: 'medium',
        phase_id: 'phase-1',
        dependencies: [],
        status: 'under_review',
        acceptance_criteria: [],
        user_stories: [],
        source: { provider: 'internal' },
        some_unknown_field: { keep: true },
      } as Record<string, unknown>,
      { id: 'f-old', title: 'Data export', description: 'x', priority: 'must' } as Record<string, unknown>,
    ],
    metadata: { created_at: '2026-01-01T00:00:00.000Z' } as Record<string, unknown>,
  };
}

const refinement: FeatureRefinement = {
  title: 'CSV export of streaks',
  description: 'Download streak history as CSV.',
  rationale: 'Users own their data.',
  complexity: 'low',
  impact: 'high',
  priority: 'could',
  phaseId: 'phase-2',
  acceptanceCriteria: ['Button exists', 'CSV has a header row', 'One row per day'],
  directionIds: ['dir-a', 'dir-unknown', 'dir-a'],
  duplicateOf: 'f-old',
};

const known = new Set(['dir-a', 'dir-b']);

function apply(roadmap: ReturnType<typeof makeRoadmap>, overrides: Partial<Parameters<typeof applyFeatureRefinement>[3]> = {}) {
  const snapshot = snapshotRawFeature(makeRoadmap().features[0]);
  return applyFeatureRefinement(roadmap, 'f-new', refinement, {
    line: LINE,
    snapshot,
    suggestPriority: true,
    knownDirectionIds: known,
    now: NOW,
    ...overrides,
  });
}

describe('applyFeatureRefinement', () => {
  it('fills an untouched quick-add feature, preserving unknown fields', () => {
    const roadmap = makeRoadmap();
    const result = apply(roadmap);
    expect(result.success).toBe(true);
    const f = roadmap.features[0];
    expect(f).toMatchObject({
      title: 'CSV export of streaks',
      description: 'Download streak history as CSV.',
      rationale: 'Users own their data.',
      complexity: 'low',
      impact: 'high',
      priority: 'could',
      phase_id: 'phase-2',
      acceptance_criteria: refinement.acceptanceCriteria,
      duplicate_of: 'f-old',
      refined_at: NOW.toISOString(),
      status: 'under_review',
      source: { provider: 'internal' },
      some_unknown_field: { keep: true },
    });
    expect(roadmap.features[1]).toEqual(makeRoadmap().features[1]);
    expect(roadmap.metadata.updated_at).toBe(NOW.toISOString());
    if (result.success) {
      expect(result.feature.title).toBe('CSV export of streaks');
      expect(result.feature.refinedAt).toBe(NOW.toISOString());
      expect(result.feature.duplicateOf).toBe('f-old');
      expect(result.feature.directionIds).toEqual(['dir-a']);
    }
  });

  it('drops unknown and duplicate direction ids; leaves direction_ids alone without known ids', () => {
    const roadmap = makeRoadmap();
    apply(roadmap);
    expect(roadmap.features[0].direction_ids).toEqual(['dir-a']);

    const untagged = makeRoadmap();
    apply(untagged, { knownDirectionIds: new Set() });
    expect('direction_ids' in untagged.features[0]).toBe(false);
  });

  it('respects a title the user edited meanwhile: keeps title/description, fills defaults', () => {
    const roadmap = makeRoadmap();
    roadmap.features[0].title = 'Streak CSV (my words)';
    roadmap.features[0].description = 'My own description';
    apply(roadmap);
    const f = roadmap.features[0];
    expect(f.title).toBe('Streak CSV (my words)');
    expect(f.description).toBe('My own description');
    expect(f.rationale).toBe('Users own their data.');
    expect(f.acceptance_criteria).toEqual(refinement.acceptanceCriteria);
    expect(f.complexity).toBe('low');
  });

  it('fills an empty description even when the title was edited', () => {
    const roadmap = makeRoadmap();
    roadmap.features[0].title = 'Edited';
    roadmap.features[0].description = '';
    apply(roadmap);
    expect(roadmap.features[0].description).toBe('Download streak history as CSV.');
  });

  it('keeps fields the user changed meanwhile (rationale, complexity, criteria)', () => {
    const roadmap = makeRoadmap();
    roadmap.features[0].rationale = 'Because I said so';
    roadmap.features[0].complexity = 'high';
    roadmap.features[0].acceptance_criteria = ['mine'];
    apply(roadmap);
    expect(roadmap.features[0].rationale).toBe('Because I said so');
    expect(roadmap.features[0].complexity).toBe('high');
    expect(roadmap.features[0].acceptance_criteria).toEqual(['mine']);
  });

  it('moves phase/priority only with suggestPriority and while still the defaults', () => {
    const noSuggest = makeRoadmap();
    apply(noSuggest, { suggestPriority: false });
    expect(noSuggest.features[0].priority).toBe('should');
    expect(noSuggest.features[0].phase_id).toBe('phase-1');

    const moved = makeRoadmap();
    moved.features[0].priority = 'must';
    moved.features[0].phase_id = 'phase-2';
    const refinementToPhase1 = { ...refinement, phaseId: 'phase-1' };
    applyFeatureRefinement(moved, 'f-new', refinementToPhase1, {
      line: LINE,
      snapshot: snapshotRawFeature(makeRoadmap().features[0]),
      suggestPriority: true,
      knownDirectionIds: known,
      now: NOW,
    });
    expect(moved.features[0].priority).toBe('must');
    expect(moved.features[0].phase_id).toBe('phase-2');

    const unknownPhase = makeRoadmap();
    applyFeatureRefinement(unknownPhase, 'f-new', { ...refinement, phaseId: 'phase-404' }, {
      line: LINE,
      snapshot: snapshotRawFeature(makeRoadmap().features[0]),
      suggestPriority: true,
      knownDirectionIds: known,
    });
    expect(unknownPhase.features[0].phase_id).toBe('phase-1');
  });

  it('explicit refine overwrites content but never moves phase/priority', () => {
    const roadmap = makeRoadmap();
    roadmap.features[0].title = 'User title';
    roadmap.features[0].description = 'User description';
    roadmap.features[0].acceptance_criteria = ['old'];
    roadmap.features[0].direction_ids = ['dir-b'];
    apply(roadmap, { explicit: true, line: 'User title' });
    const f = roadmap.features[0];
    expect(f.title).toBe('CSV export of streaks');
    expect(f.description).toBe('Download streak history as CSV.');
    expect(f.acceptance_criteria).toEqual(refinement.acceptanceCriteria);
    expect(f.direction_ids).toEqual(['dir-a']);
    expect(f.priority).toBe('should');
    expect(f.phase_id).toBe('phase-1');
  });

  it('ignores duplicate_of pointing at itself or a missing feature', () => {
    const self = makeRoadmap();
    applyFeatureRefinement(self, 'f-new', { ...refinement, duplicateOf: 'f-new' }, {
      line: LINE, snapshot: snapshotRawFeature(self.features[0]), suggestPriority: false, knownDirectionIds: known,
    });
    expect('duplicate_of' in self.features[0]).toBe(false);
    const missing = makeRoadmap();
    applyFeatureRefinement(missing, 'f-new', { ...refinement, duplicateOf: 'nope' }, {
      line: LINE, snapshot: snapshotRawFeature(missing.features[0]), suggestPriority: false, knownDirectionIds: known,
    });
    expect('duplicate_of' in missing.features[0]).toBe(false);
  });

  it('fails without touching anything when the feature is gone', () => {
    const roadmap = makeRoadmap();
    const before = structuredClone(roadmap);
    const result = applyFeatureRefinement(roadmap, 'missing', refinement, {
      line: LINE, snapshot: snapshotRawFeature(roadmap.features[0]), suggestPriority: true, knownDirectionIds: known,
    });
    expect(result).toEqual({ success: false, error: 'Feature not found' });
    expect(roadmap).toEqual(before);
  });
});

describe('refinedAt / duplicateOf round trip', () => {
  it('survives featureFromSnakeCase → featureToSnakeCase', () => {
    const raw = { ...makeRoadmap().features[0], refined_at: NOW.toISOString(), duplicate_of: 'f-old' };
    const back = featureToSnakeCase(featureFromSnakeCase(raw));
    expect(back.refined_at).toBe(NOW.toISOString());
    expect(back.duplicate_of).toBe('f-old');
  });
});

describe('keepNewerRefinements', () => {
  it('keeps refined fields from the file when the incoming save is stale', () => {
    const stored = [{ id: 'f-1', title: 'Refined', description: 'R', refined_at: NOW.toISOString(), priority: 'could' }];
    const incoming: Array<Record<string, unknown>> = [{ id: 'f-1', title: 'typed', description: 'typed', priority: 'must', status: 'planned' }];
    keepNewerRefinements(stored, incoming);
    expect(incoming[0]).toMatchObject({ title: 'Refined', description: 'R', refined_at: NOW.toISOString(), priority: 'must', status: 'planned' });
  });

  it('leaves incoming alone when it already has the refinement', () => {
    const stored = [{ id: 'f-1', title: 'Refined', refined_at: NOW.toISOString() }];
    const incoming: Array<Record<string, unknown>> = [{ id: 'f-1', title: 'User edit after refine', refined_at: NOW.toISOString() }];
    keepNewerRefinements(stored, incoming);
    expect(incoming[0].title).toBe('User edit after refine');
  });
});

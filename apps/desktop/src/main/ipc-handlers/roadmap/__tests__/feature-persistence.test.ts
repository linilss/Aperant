import { describe, it, expect } from 'vitest';
import {
  applyFeaturePriorityPatch,
  externalFieldsFromSnakeCase,
  featureToSnakeCase,
} from '../feature-persistence';
import type { RoadmapFeature, RoadmapFeaturePriority } from '../../../../shared/types';

function makeRawRoadmap() {
  return {
    id: 'roadmap-1',
    project_name: 'Demo',
    vision: 'Ship it',
    phases: [{ id: 'phase-1', name: 'MVP', features: ['f-1', 'f-2'] }],
    features: [
      {
        id: 'f-1',
        title: 'Canny import',
        description: 'Imported from Canny',
        rationale: 'Users asked',
        priority: 'could',
        complexity: 'high',
        impact: 'high',
        phase_id: 'phase-1',
        dependencies: ['f-2'],
        status: 'done',
        acceptance_criteria: ['works'],
        user_stories: ['as a user'],
        linked_spec_id: '001-canny',
        task_outcome: 'completed',
        previous_status: 'in_progress',
        competitor_insight_ids: ['pp-1'],
        source: { provider: 'canny', imported_at: '2026-01-01T00:00:00.000Z' },
        external_id: 'canny-123',
        external_url: 'https://canny.io/p/123',
        votes: 42,
        some_unknown_field: { nested: true },
      },
      {
        id: 'f-2',
        title: 'Other',
        description: 'Untouched',
        priority: 'must',
        status: 'planned',
      },
    ],
    metadata: { created_at: '2025-12-01T00:00:00.000Z', updated_at: '2025-12-02T00:00:00.000Z' },
  };
}

describe('applyFeaturePriorityPatch', () => {
  it('changes only the priority of the target feature and preserves all other fields', () => {
    const roadmap = makeRawRoadmap();
    const before = structuredClone(roadmap);
    const now = new Date('2026-10-02T12:00:00.000Z');

    const result = applyFeaturePriorityPatch(roadmap, 'f-1', 'must', now);

    expect(result).toEqual({ success: true });
    expect(roadmap.features[0]).toEqual({ ...before.features[0], priority: 'must' });
    expect(roadmap.features[0].source).toEqual(before.features[0].source);
    expect(roadmap.features[0].external_id).toBe('canny-123');
    expect(roadmap.features[0].external_url).toBe('https://canny.io/p/123');
    expect(roadmap.features[0].votes).toBe(42);
    expect(roadmap.features[1]).toEqual(before.features[1]);
    expect(roadmap.phases).toEqual(before.phases);
    expect(roadmap.vision).toBe(before.vision);
    expect(roadmap.metadata).toEqual({
      created_at: before.metadata.created_at,
      updated_at: now.toISOString(),
    });
  });

  it('creates metadata when missing', () => {
    const roadmap: { features: Array<Record<string, unknown>>; metadata?: Record<string, unknown> } = {
      features: [{ id: 'f-1', priority: 'should' }],
    };
    const now = new Date('2026-10-02T12:00:00.000Z');

    expect(applyFeaturePriorityPatch(roadmap, 'f-1', 'wont', now)).toEqual({ success: true });
    expect(roadmap.features[0].priority).toBe('wont');
    expect(roadmap.metadata).toEqual({ updated_at: now.toISOString() });
  });

  it('fails without mutating when the feature does not exist', () => {
    const roadmap = makeRawRoadmap();
    const before = structuredClone(roadmap);

    expect(applyFeaturePriorityPatch(roadmap, 'missing', 'must')).toEqual({
      success: false,
      error: 'Feature not found',
    });
    expect(roadmap).toEqual(before);
  });

  it('rejects an invalid priority without mutating', () => {
    const roadmap = makeRawRoadmap();
    const before = structuredClone(roadmap);

    const result = applyFeaturePriorityPatch(roadmap, 'f-1', 'urgent' as RoadmapFeaturePriority);

    expect(result).toEqual({ success: false, error: 'Invalid priority' });
    expect(roadmap).toEqual(before);
  });
});

describe('featureToSnakeCase / externalFieldsFromSnakeCase', () => {
  it('persists external integration fields and round-trips them', () => {
    const feature: RoadmapFeature = {
      id: 'f-1',
      title: 'Canny import',
      description: 'Imported',
      rationale: '',
      priority: 'should',
      complexity: 'low',
      impact: 'medium',
      phaseId: 'phase-1',
      dependencies: [],
      status: 'planned',
      acceptanceCriteria: [],
      userStories: [],
      source: { provider: 'canny', importedAt: new Date('2026-01-01T00:00:00.000Z') },
      externalId: 'canny-123',
      externalUrl: 'https://canny.io/p/123',
      votes: 7,
    };

    const raw = featureToSnakeCase(feature);

    expect(raw.external_id).toBe('canny-123');
    expect(raw.external_url).toBe('https://canny.io/p/123');
    expect(raw.votes).toBe(7);
    expect(raw.source).toEqual({
      provider: 'canny',
      imported_at: '2026-01-01T00:00:00.000Z',
      last_synced_at: undefined,
    });

    // Simulate the JSON write/read cycle
    const reread = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
    expect(externalFieldsFromSnakeCase(reread)).toEqual({
      source: { provider: 'canny', importedAt: new Date('2026-01-01T00:00:00.000Z'), lastSyncedAt: undefined },
      externalId: 'canny-123',
      externalUrl: 'https://canny.io/p/123',
      votes: 7,
    });
  });

  it('returns undefined external fields for internal features', () => {
    expect(externalFieldsFromSnakeCase({ id: 'f-2' })).toEqual({
      source: undefined,
      externalId: undefined,
      externalUrl: undefined,
      votes: undefined,
    });
  });
});

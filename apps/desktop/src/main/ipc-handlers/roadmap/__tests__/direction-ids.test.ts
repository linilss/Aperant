import { describe, it, expect } from 'vitest';
import { applyFeaturePriorityPatch, directionIdsFromRaw, featureToSnakeCase } from '../feature-persistence';
import { transformRoadmapFromSnakeCase } from '../transformers';
import type { RoadmapFeature } from '../../../../shared/types';

const baseFeature: RoadmapFeature = {
  id: 'f-1',
  title: 'Offline mode',
  description: 'Works offline',
  rationale: '',
  priority: 'should',
  complexity: 'medium',
  impact: 'high',
  phaseId: 'phase-1',
  dependencies: [],
  status: 'planned',
  acceptanceCriteria: [],
  userStories: [],
};

describe('direction_ids mapping', () => {
  it('round-trips directionIds through save (snake_case) and load', () => {
    const raw = JSON.parse(JSON.stringify(featureToSnakeCase({ ...baseFeature, directionIds: ['dir-1', 'dir-3'] })));
    expect(raw.direction_ids).toEqual(['dir-1', 'dir-3']);
    expect(directionIdsFromRaw(raw)).toEqual(['dir-1', 'dir-3']);
  });

  it('keeps [] distinct from absent (untagged vs. generated before tagging)', () => {
    const tagged = JSON.parse(JSON.stringify(featureToSnakeCase({ ...baseFeature, directionIds: [] })));
    const legacy = JSON.parse(JSON.stringify(featureToSnakeCase(baseFeature)));
    expect(directionIdsFromRaw(tagged)).toEqual([]);
    expect('direction_ids' in legacy).toBe(false);
    expect(directionIdsFromRaw(legacy)).toBeUndefined();
  });

  it('reads tolerantly: camelCase, non-arrays and non-string entries', () => {
    expect(directionIdsFromRaw({ directionIds: ['a'] })).toEqual(['a']);
    expect(directionIdsFromRaw({ direction_ids: 'a' })).toBeUndefined();
    expect(directionIdsFromRaw({ direction_ids: ['a', 3, null, '', 'b'] })).toEqual(['a', 'b']);
  });

  it('transformRoadmapFromSnakeCase maps direction_ids', () => {
    const roadmap = transformRoadmapFromSnakeCase(
      {
        features: [
          { id: 'f-1', title: 'A', description: '', direction_ids: ['dir-2'] },
          { id: 'f-2', title: 'B', description: '' },
        ],
      },
      'p-1',
    );
    expect(roadmap.features[0].directionIds).toEqual(['dir-2']);
    expect(roadmap.features[1].directionIds).toBeUndefined();
  });

  it('priority patch preserves direction_ids', () => {
    const roadmap = { features: [{ id: 'f-1', priority: 'could', direction_ids: ['dir-1'] }] as Array<Record<string, unknown>> };
    expect(applyFeaturePriorityPatch(roadmap, 'f-1', 'must')).toEqual({ success: true });
    expect(roadmap.features[0]).toEqual({ id: 'f-1', priority: 'must', direction_ids: ['dir-1'] });
  });
});

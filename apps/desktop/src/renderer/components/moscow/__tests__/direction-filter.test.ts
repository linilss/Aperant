import { describe, it, expect } from 'vitest';
import {
  UNTAGGED_FILTER,
  filterFeaturesByDirection,
  hasDirectionTagging,
  resolveFeatureDirections,
  toggleDirectionFilter,
} from '../direction-filter';
import type { StrategicDirection } from '../../../../shared/types/competitors';
import type { Idea } from '../../../../shared/types';

const dir = (id: string, avoid = false): StrategicDirection => ({
  id,
  title: id.toUpperCase(),
  description: '',
  occupiedBy: [],
  opportunity: '',
  fit: '',
  fitSources: [],
  risk: '',
  avoid,
  note: '',
});

const directions = [dir('a'), dir('b'), dir('c', true)];
const features = [
  { id: 'f1', directionIds: ['a'] },
  { id: 'f2', directionIds: ['b', 'c'] },
  { id: 'f3', directionIds: [] },
  { id: 'f4', directionIds: ['stale'] },
  { id: 'f5' },
];
const ids = (list: Array<{ id: string }>) => list.map((f) => f.id);

describe('filterFeaturesByDirection', () => {
  it('returns everything for an empty selection (All directions)', () => {
    expect(filterFeaturesByDirection(features, [], directions)).toBe(features);
  });

  it('matches any selected direction', () => {
    expect(ids(filterFeaturesByDirection(features, ['a'], directions))).toEqual(['f1']);
    expect(ids(filterFeaturesByDirection(features, ['a', 'c'], directions))).toEqual(['f1', 'f2']);
  });

  it('treats no / stale ids as untagged', () => {
    expect(ids(filterFeaturesByDirection(features, [UNTAGGED_FILTER], directions))).toEqual(['f3', 'f4', 'f5']);
    expect(ids(filterFeaturesByDirection(features, ['b', UNTAGGED_FILTER], directions))).toEqual(['f2', 'f3', 'f4', 'f5']);
  });
});

describe('direction helpers', () => {
  it('resolves known directions in rank order with 1-based rank', () => {
    const refs = resolveFeatureDirections({ directionIds: ['c', 'stale', 'a'] }, directions);
    expect(refs.map((r) => [r.direction.id, r.rank])).toEqual([
      ['a', 1],
      ['c', 3],
    ]);
    expect(resolveFeatureDirections({}, directions)).toEqual([]);
  });

  it('detects whether the roadmap was generated with tagging', () => {
    expect(hasDirectionTagging([{}, {}])).toBe(false);
    expect(hasDirectionTagging([{}, { directionIds: [] }])).toBe(true);
  });

  it('toggles a token', () => {
    expect(toggleDirectionFilter([], 'a')).toEqual(['a']);
    expect(toggleDirectionFilter(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('shared with Ideation (ideas carry the same directionIds)', () => {
  const idea = (id: string, directionIds?: string[]): Idea => ({
    id,
    type: 'code_improvements',
    title: id,
    description: '',
    rationale: '',
    status: 'draft',
    createdAt: new Date(),
    buildsUpon: [],
    estimatedEffort: 'small',
    affectedFiles: [],
    existingPatterns: [],
    directionIds,
  });
  const ideas = [idea('i1', ['b']), idea('i2', []), idea('i3')];

  it('filters ideas by direction and untagged, keeping the idea type', () => {
    const result: Idea[] = filterFeaturesByDirection(ideas, ['b'], directions);
    expect(ids(result)).toEqual(['i1']);
    expect(ids(filterFeaturesByDirection(ideas, [UNTAGGED_FILTER], directions))).toEqual(['i2', 'i3']);
  });

  it('detects tagging and resolves ranked directions for ideas', () => {
    expect(hasDirectionTagging(ideas)).toBe(true);
    expect(hasDirectionTagging([ideas[2]])).toBe(false);
    expect(resolveFeatureDirections(ideas[0], directions).map((r) => r.rank)).toEqual([2]);
  });
});

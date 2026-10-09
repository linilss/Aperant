import { describe, it, expect } from 'vitest';
import { buildDirectionTaggingSection, sanitizeFeatureDirectionIds } from '../guidance';
import type { CompetitorStrategyState, StrategicDirection } from '../../../../../shared/types/competitors';

function direction(id: string, title: string, avoid = false): StrategicDirection {
  return {
    id,
    title,
    description: '',
    occupiedBy: [],
    opportunity: '',
    fit: '',
    fitSources: [],
    risk: '',
    avoid,
    note: '',
  };
}

function state(directions: StrategicDirection[]): CompetitorStrategyState {
  return {
    projectName: 'Demo',
    projectType: '',
    targetAudience: '',
    focus: '',
    competitorCount: 5,
    analyzedAt: null,
    competitors: [],
    directions,
    directionsSynthesizedAt: null,
    directionsStale: false,
    rankingSavedAt: '2026-10-01T00:00:00.000Z',
  };
}

describe('buildDirectionTaggingSection', () => {
  it('is empty without directions', () => {
    expect(buildDirectionTaggingSection(null)).toBe('');
    expect(buildDirectionTaggingSection(state([]))).toBe('');
  });

  it('lists every direction with id, rank and avoid flag and asks for direction_ids', () => {
    const section = buildDirectionTaggingSection(
      state([direction('dir-a', 'Mobile first'), direction('dir-b', 'Enterprise SSO', true), direction('dir-c', 'AI search')]),
    );
    expect(section).toContain('id "dir-a" — #1 Mobile first');
    expect(section).toContain('id "dir-b" — #2 Enterprise SSO (AVOID)');
    expect(section).toContain('id "dir-c" — #3 AI search');
    expect(section).toContain('"direction_ids"');
    expect(section).toContain('"wont"');
  });
});

describe('sanitizeFeatureDirectionIds', () => {
  const known = new Set(['dir-a', 'dir-b']);

  it('drops unknown and non-string ids and de-duplicates', () => {
    const features: Array<Record<string, unknown>> = [{ id: 'f-1', direction_ids: ['dir-a', 'ghost', 7, 'dir-a', 'dir-b'] }];
    sanitizeFeatureDirectionIds(features, known);
    expect(features[0].direction_ids).toEqual(['dir-a', 'dir-b']);
  });

  it('defaults missing ids to [] for new features, leaves preserved ones alone', () => {
    const generated: Array<Record<string, unknown>> = [{ id: 'f-1' }, { id: 'f-2', directionIds: ['dir-b'] }];
    sanitizeFeatureDirectionIds(generated, known);
    expect(generated[0].direction_ids).toEqual([]);
    expect(generated[1]).toEqual({ id: 'f-2', direction_ids: ['dir-b'] });

    const preserved: Array<Record<string, unknown>> = [{ id: 'f-3' }];
    sanitizeFeatureDirectionIds(preserved, known, false);
    expect('direction_ids' in preserved[0]).toBe(false);
  });

  it('removes direction_ids when there are no known directions', () => {
    const features: Array<Record<string, unknown>> = [{ id: 'f-1', direction_ids: ['dir-a'] }];
    sanitizeFeatureDirectionIds(features, new Set());
    expect('direction_ids' in features[0]).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { transformIdeaFromSnakeCase } from '../transformers';
import {
  buildIdeaDirectionTaggingSection,
  sanitizeFeatureDirectionIds,
} from '../../../ai/runners/competitors/guidance';
import type { RawIdea } from '../types';
import type { CompetitorStrategyState, StrategicDirection } from '../../../../shared/types/competitors';

function rawIdea(overrides: Partial<RawIdea> = {}): RawIdea {
  return {
    id: 'idea-1',
    type: 'security_hardening',
    title: 'Rotate secrets',
    description: 'd',
    rationale: 'r',
    severity: 'high',
    ...overrides,
  };
}

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
    valuesFit: '',
    conflictsWithValues: false,
    avoid,
    note: '',
  };
}

describe('idea direction_ids mapping', () => {
  it('maps snake_case direction_ids to directionIds', () => {
    expect(transformIdeaFromSnakeCase(rawIdea({ direction_ids: ['dir-a', 'dir-b'] })).directionIds).toEqual([
      'dir-a',
      'dir-b',
    ]);
  });

  it('accepts camelCase directionIds and drops non-strings', () => {
    const idea = rawIdea({ directionIds: ['dir-a', 3 as unknown as string, ''] });
    expect(transformIdeaFromSnakeCase(idea).directionIds).toEqual(['dir-a']);
  });

  it('leaves directionIds undefined for ideas generated before tagging', () => {
    expect(transformIdeaFromSnakeCase(rawIdea()).directionIds).toBeUndefined();
    expect('directionIds' in transformIdeaFromSnakeCase(rawIdea())).toBe(false);
  });

  it('maps the task and roadmap links for every idea type', () => {
    const idea = transformIdeaFromSnakeCase(
      rawIdea({ type: 'code_quality', linked_task_id: '003-x', roadmap_feature_id: 'feature-9' })
    );
    expect(idea.taskId).toBe('003-x');
    expect(idea.roadmapFeatureId).toBe('feature-9');
  });

  it('drops ids unknown to strategy.json and dedupes; untagged ideas get [] after a tagged run', () => {
    const ideas: RawIdea[] = [
      rawIdea({ id: 'a', direction_ids: ['dir-a', 'gone', 'dir-a'] }),
      rawIdea({ id: 'b' }),
    ];
    sanitizeFeatureDirectionIds(ideas, new Set(['dir-a']));
    expect(ideas[0].direction_ids).toEqual(['dir-a']);
    expect(ideas[1].direction_ids).toEqual([]);
    expect(transformIdeaFromSnakeCase(ideas[0]).directionIds).toEqual(['dir-a']);
  });

  it('keeps old ideas untagged when sanitizing on load (defaultMissing=false)', () => {
    const ideas: RawIdea[] = [rawIdea({ id: 'b' })];
    sanitizeFeatureDirectionIds(ideas, new Set(['dir-a']), false);
    expect(ideas[0].direction_ids).toBeUndefined();
  });

  it('removes direction_ids when there is no strategy', () => {
    const ideas: RawIdea[] = [rawIdea({ direction_ids: ['dir-a'] })];
    sanitizeFeatureDirectionIds(ideas, new Set());
    expect(transformIdeaFromSnakeCase(ideas[0]).directionIds).toBeUndefined();
  });
});

describe('buildIdeaDirectionTaggingSection', () => {
  const state = (directions: StrategicDirection[]) =>
    ({ directions }) as unknown as CompetitorStrategyState;

  it('is empty without directions', () => {
    expect(buildIdeaDirectionTaggingSection(null)).toBe('');
    expect(buildIdeaDirectionTaggingSection(state([]))).toBe('');
  });

  it('lists ids in rank order and asks for direction_ids', () => {
    const section = buildIdeaDirectionTaggingSection(
      state([direction('dir-a', 'Coach-first'), direction('dir-b', 'Cheapest', true)])
    );
    expect(section).toContain('"dir-a" #1 Coach-first; "dir-b" #2 Cheapest (AVOID)');
    expect(section).toContain('"direction_ids"');
  });
});

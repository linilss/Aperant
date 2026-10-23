import { describe, it, expect, vi } from 'vitest';
import type { RawIdea } from '../types';

vi.mock('../../../project-store', () => ({ projectStore: { getProject: vi.fn() } }));

import { transformConfigFromSnakeCase, transformIdeaFromSnakeCase } from '../transformers';
import { buildTaskDescription, buildTaskMetadata } from '../task-converter';
import { buildFeatureFromIdea } from '../roadmap-converter';
import { ideationTypeFileName } from '../../../agent/ideation-consolidation';
import { DEFAULT_IDEATION_CONFIG } from '../../../../shared/constants/ideation';
import type { FeatureIdea } from '../../../../shared/types';

function featureIdea(overrides: Partial<RawIdea> = {}): RawIdea {
  return {
    id: 'feat-001',
    type: 'features',
    title: 'Sticker book',
    description: 'Earn a sticker for each finished game',
    rationale: 'Gives a reason to come back',
    user_value: 'A visible collection that grows',
    target_users: 'Kids aged 2-4',
    complexity: 'medium',
    impact: 'high',
    direction_ids: ['dir-a', 'unknown'],
    ...overrides,
  };
}

describe('features ideation type wiring', () => {
  it('is the first type and enabled by default', () => {
    expect(DEFAULT_IDEATION_CONFIG.enabledTypes[0]).toBe('features');
  });

  it('writes to features_ideas.json', () => {
    expect(ideationTypeFileName('features')).toBe('features_ideas.json');
  });
});

describe('transformConfigFromSnakeCase', () => {
  it('treats features as enabled in configs saved before it existed', () => {
    const config = transformConfigFromSnakeCase({ enabled_types: ['code_improvements', 'security_hardening'] });
    expect(config.enabledTypes).toEqual(['features', 'code_improvements', 'security_hardening']);
  });

  it('keeps features off when the saved config knew it and left it off', () => {
    const config = transformConfigFromSnakeCase({
      enabled_types: ['code_improvements'],
      known_types: ['features', 'code_improvements', 'ui_ux_improvements', 'documentation_gaps', 'security_hardening', 'performance_optimizations', 'code_quality'],
    });
    expect(config.enabledTypes).toEqual(['code_improvements']);
  });

  it('uses the defaults without a saved config and drops unknown types', () => {
    expect(transformConfigFromSnakeCase(undefined).enabledTypes).toEqual([...DEFAULT_IDEATION_CONFIG.enabledTypes]);
    expect(transformConfigFromSnakeCase({ enabled_types: ['bogus', 'code_quality'] }).enabledTypes).toEqual([
      'features',
      'code_quality',
    ]);
  });

  it('restores the focus trimmed and capped, and omits an empty one', () => {
    expect(transformConfigFromSnakeCase({ focus: '  offline  ' }).focus).toBe('offline');
    expect(transformConfigFromSnakeCase({ focus: 'x'.repeat(1200) }).focus).toHaveLength(1000);
    expect(transformConfigFromSnakeCase({ focus: '   ' })).not.toHaveProperty('focus');
  });
});

describe('FeatureIdea transform', () => {
  it('maps the snake_case fields', () => {
    const idea = transformIdeaFromSnakeCase(featureIdea()) as FeatureIdea;
    expect(idea).toMatchObject({
      id: 'feat-001',
      type: 'features',
      title: 'Sticker book',
      userValue: 'A visible collection that grows',
      targetUsers: 'Kids aged 2-4',
      complexity: 'medium',
      impact: 'high',
      status: 'draft',
      directionIds: ['dir-a', 'unknown'],
    });
  });

  it('accepts camelCase and falls back to medium for unknown levels', () => {
    const idea = transformIdeaFromSnakeCase(
      featureIdea({ user_value: undefined, userValue: 'v', complexity: 'huge', impact: undefined }),
    ) as FeatureIdea;
    expect(idea.userValue).toBe('v');
    expect(idea.complexity).toBe('medium');
    expect(idea.impact).toBe('medium');
  });
});

describe('feature idea → task', () => {
  it('describes the user value and target users', () => {
    const description = buildTaskDescription(featureIdea());
    expect(description).toContain('## User Value\nA visible collection that grows');
    expect(description).toContain('## Target Users\nKids aged 2-4');
  });

  it('maps category, complexity, impact and priority', () => {
    expect(buildTaskMetadata(featureIdea())).toMatchObject({
      sourceType: 'ideation',
      ideationType: 'features',
      category: 'feature',
      complexity: 'medium',
      estimatedEffort: 'medium',
      impact: 'high',
      priority: 'high',
      targetAudience: 'Kids aged 2-4',
    });
    expect(buildTaskMetadata(featureIdea({ complexity: 'low', impact: 'low' }))).toMatchObject({
      complexity: 'small',
      priority: 'low',
    });
  });
});

describe('feature idea → roadmap feature', () => {
  const options = {
    featureId: 'feature-1',
    phaseId: 'phase-1',
    knownDirectionIds: new Set(['dir-a']),
    now: new Date('2026-10-11T00:00:00.000Z'),
  };

  it('keeps complexity/impact, derives priority from impact and adds a user story', () => {
    const feature = buildFeatureFromIdea(featureIdea({ complexity: 'high' }), options);
    expect(feature).toMatchObject({
      title: 'Sticker book',
      priority: 'should',
      complexity: 'high',
      impact: 'high',
      user_stories: ['Kids aged 2-4: A visible collection that grows'],
      direction_ids: ['dir-a'],
      source_idea_id: 'feat-001',
    });
  });

  it('low impact becomes "could" and no user value means no stories', () => {
    const feature = buildFeatureFromIdea(featureIdea({ impact: 'low', user_value: '' }), options);
    expect(feature.priority).toBe('could');
    expect(feature.impact).toBe('low');
    expect(feature.user_stories).toEqual([]);
  });
});

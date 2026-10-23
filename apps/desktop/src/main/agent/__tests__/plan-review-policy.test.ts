import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readAssessedComplexity, shouldRequirePlanReview } from '../plan-review-policy';

describe('shouldRequirePlanReview', () => {
  it('requires review for complex tasks when the option is unset', () => {
    expect(shouldRequirePlanReview(undefined, 'complex')).toBe(true);
  });

  it('auto-approves simple, standard and unassessed tasks when the option is unset', () => {
    expect(shouldRequirePlanReview(undefined, 'simple')).toBe(false);
    expect(shouldRequirePlanReview(undefined, 'standard')).toBe(false);
    expect(shouldRequirePlanReview(undefined, null)).toBe(false);
  });

  it('respects an explicit per-task setting', () => {
    expect(shouldRequirePlanReview(false, 'complex')).toBe(false);
    expect(shouldRequirePlanReview(true, 'simple')).toBe(true);
  });
});

describe('readAssessedComplexity', () => {
  let specDir: string;

  beforeEach(() => {
    specDir = mkdtempSync(path.join(tmpdir(), 'plan-review-'));
  });

  afterEach(() => {
    rmSync(specDir, { recursive: true, force: true });
  });

  const writeAssessment = (data: unknown) =>
    writeFileSync(path.join(specDir, 'complexity_assessment.json'), JSON.stringify(data));

  it('returns null when no assessment exists', () => {
    expect(readAssessedComplexity(specDir)).toBeNull();
  });

  it('reads the complexity tier', () => {
    writeAssessment({ complexity: 'complex', confidence: 0.9, reasoning: 'many files' });
    expect(readAssessedComplexity(specDir)).toBe('complex');
  });

  it('normalizes LLM variations like "high"', () => {
    writeAssessment({ level: 'high', confidence: 80 });
    expect(readAssessedComplexity(specDir)).toBe('complex');
  });

  it('returns null for unreadable JSON', () => {
    writeFileSync(path.join(specDir, 'complexity_assessment.json'), 'not json at all {{{');
    expect(readAssessedComplexity(specDir)).toBeNull();
  });
});

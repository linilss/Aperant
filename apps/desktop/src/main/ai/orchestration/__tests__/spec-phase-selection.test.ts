import { describe, expect, it } from 'vitest';
import { selectSpecPhases } from '../spec-orchestrator';

describe('selectSpecPhases', () => {
  it('runs a single quick_spec pass for simple tasks (no critique, no AI validation)', () => {
    expect(selectSpecPhases('simple')).toEqual(['quick_spec']);
  });

  it('ignores research/self-critique flags for simple tasks', () => {
    expect(selectSpecPhases('simple', { needs_research: true, needs_self_critique: true })).toEqual(['quick_spec']);
  });

  it('keeps the standard pipeline unchanged', () => {
    expect(selectSpecPhases('standard')).toEqual(['discovery', 'requirements', 'spec_writing', 'planning', 'validation']);
  });

  it('adds research and self-critique to standard when the assessor flags them', () => {
    expect(selectSpecPhases('standard', { needs_research: true, needs_self_critique: true })).toEqual([
      'discovery',
      'requirements',
      'research',
      'spec_writing',
      'self_critique',
      'planning',
      'validation',
    ]);
  });

  it('keeps the complex pipeline unchanged and does not duplicate phases', () => {
    const complex = [
      'discovery',
      'requirements',
      'research',
      'context',
      'spec_writing',
      'self_critique',
      'planning',
      'validation',
    ];
    expect(selectSpecPhases('complex')).toEqual(complex);
    expect(selectSpecPhases('complex', { needs_research: true, needs_self_critique: true })).toEqual(complex);
  });

  it('returns a fresh array each call', () => {
    selectSpecPhases('standard').push('research');
    expect(selectSpecPhases('standard')).not.toContain('research');
  });
});

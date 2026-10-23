import { describe, it, expect } from 'vitest';
import { buildGuidanceSection } from '../roadmap';

describe('buildGuidanceSection', () => {
  it('adds nothing when no guidance is given', () => {
    expect(buildGuidanceSection(undefined)).toBe('');
    expect(buildGuidanceSection('')).toBe('');
    expect(buildGuidanceSection('   \n  ')).toBe('');
  });

  it('includes the trimmed guidance under a priority heading', () => {
    const section = buildGuidanceSection('  Less enterprise admin, more mobile onboarding.\n');
    expect(section).toContain('DIRECTION FROM THE USER');
    expect(section).toContain('takes priority');
    expect(section).toContain('Less enterprise admin, more mobile onboarding.\n');
    expect(section).not.toMatch(/^\s{2}Less/m);
  });
});

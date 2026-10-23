import { describe, expect, it } from 'vitest';

import { buildFixFeedback, parseQaReport } from '../qa-report';

const REPORT = `# QA Report

Status: FAILED

## Acceptance Criteria
- ✅ Eye icon in the field — LoginPage.xaml:70
- ❌ Toggling keeps text and focus — not verified in simulator
- ❌ Icons tinted in light and dark mode

## Blocking
1. **Part 1 unverified at runtime.** The spec says
   XAML changes need simulator verification.
2. **Ineffective iOS mitigation.** Fix: AppendToMapping(nameof(IEntry.IsPassword)).

## Recommended Fixes
- (minor) Revert unrelated test edits.

## Skipped (decided earlier)
- Not adding toggle tests.
`;

describe('parseQaReport', () => {
  it('pulls unmet criteria, blocking items (with continuation lines) and recommendations', () => {
    const s = parseQaReport(REPORT);
    expect(s.status).toBe('FAILED');
    expect(s.unmet).toEqual(['Toggling keeps text and focus — not verified in simulator', 'Icons tinted in light and dark mode']);
    expect(s.blocking).toHaveLength(2);
    expect(s.blocking[0]).toContain('XAML changes need simulator verification.');
    expect(s.recommended).toEqual(['(minor) Revert unrelated test edits.']);
  });

  it('builds fixer feedback from the findings', () => {
    const text = buildFixFeedback(parseQaReport(REPORT));
    expect(text).toContain('1. **Part 1 unverified at runtime.**');
    expect(text).toContain('- Icons tinted in light and dark mode');
    expect(text).not.toContain('Not adding toggle tests');
  });
});

import { describe, expect, it } from 'vitest';

import { buildLensSection, countCriteria, parseLensFindings, runReviewLenses } from '../qa-lenses';

describe('parseLensFindings', () => {
  it('reads the last block, defaults unknown severities to minor, drops empty issues', () => {
    const text =
      '<qa_findings>[]</qa_findings> later <qa_findings>[{"severity":"critical","file":"a.ts","line":3,"issue":"Null deref","fix":"Guard"},' +
      '{"severity":"weird","file":"b.ts","issue":"Odd","fix":"x"},{"severity":"major","issue":""}]</qa_findings>';
    expect(parseLensFindings(text)).toEqual([
      { severity: 'critical', file: 'a.ts', line: 3, issue: 'Null deref', fix: 'Guard' },
      { severity: 'minor', file: 'b.ts', line: undefined, issue: 'Odd', fix: 'x' },
    ]);
  });
});

describe('runReviewLenses', () => {
  it('runs risk on the deep model and scan on the fast one; a failing lens is reported, not fatal', async () => {
    const seen: string[] = [];
    const results = await runReviewLenses('diff', 'spec', async ({ lens, model }) => {
      seen.push(`${lens}:${model}`);
      if (lens === 'scan') throw new Error('rate limited');
      return '<qa_findings>[{"severity":"critical","file":"a.ts","issue":"Data loss","fix":"Keep a copy"}]</qa_findings>';
    });
    expect(seen.sort()).toEqual(['risk:opus', 'scan:haiku']);
    const section = buildLensSection(results);
    expect(section).toContain('[critical] a.ts — Data loss');
    expect(section).toContain('did not run: rate limited');
  });
});

describe('countCriteria', () => {
  it('counts met and unmet criteria in the report section only', () => {
    const report = '## Summary\n- ✅ not a criterion\n## Acceptance Criteria\n- ✅ A — test x\n- ❌ B — missing\n- ✅ C — file\n## Verdict\n- ✅ ignored';
    expect(countCriteria(report)).toEqual({ met: 2, total: 3 });
    expect(countCriteria('## Summary')).toBeNull();
  });
});

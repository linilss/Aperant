import { describe, expect, it } from 'vitest';
import { sideBySideDiff, unifiedDiff } from '../line-diff';

describe('sideBySideDiff', () => {
  it('pairs changed lines and keeps unchanged ones aligned', () => {
    const rows = sideBySideDiff('a\nb\nc\n', 'a\nB\nc\nd\n');

    expect(rows.map((r) => [r.left?.kind ?? null, r.left?.text ?? null, r.right?.kind ?? null, r.right?.text ?? null])).toEqual([
      ['same', 'a', 'same', 'a'],
      ['removed', 'b', 'added', 'B'],
      ['same', 'c', 'same', 'c'],
      [null, null, 'added', 'd'],
    ]);
  });

  it('treats a missing "before" as an all-new file', () => {
    const rows = sideBySideDiff(null, 'x\ny');
    expect(rows.every((r) => r.left === null && r.right?.kind === 'added')).toBe(true);
    expect(rows.map((r) => r.right?.lineNo)).toEqual([1, 2]);
  });
});

describe('unifiedDiff', () => {
  it('lists removed lines before added lines within a changed block', () => {
    const cells = unifiedDiff(sideBySideDiff('a\nb\nc\nd\n', 'a\nB\nC\nd\ne\n'));
    expect(cells.map((c) => `${c.kind[0]}${c.text}`)).toEqual(['sa', 'rb', 'rc', 'aB', 'aC', 'sd', 'ae']);
  });
});

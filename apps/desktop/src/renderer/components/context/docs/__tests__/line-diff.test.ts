import { describe, expect, it } from 'vitest';
import { sideBySideDiff } from '../line-diff';

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

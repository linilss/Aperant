/**
 * Minimal line-based diff (LCS) for the side-by-side proposal review.
 */

export interface DiffCell {
  lineNo: number;
  text: string;
  kind: 'same' | 'removed' | 'added';
}

export interface DiffRow {
  left: DiffCell | null;
  right: DiffCell | null;
}

type Op = { type: 'same' | 'removed' | 'added'; text: string };

function diffOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = LCS length of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type: 'removed', text: a[i++] });
    } else {
      ops.push({ type: 'added', text: b[j++] });
    }
  }
  while (i < n) ops.push({ type: 'removed', text: a[i++] });
  while (j < m) ops.push({ type: 'added', text: b[j++] });
  return ops;
}

function toLines(text: string | null | undefined): string[] {
  if (!text) return [];
  const trimmed = text.endsWith('\n') ? text.slice(0, -1) : text;
  return trimmed.split('\n');
}

/**
 * Build side-by-side rows. Adjacent removed/added blocks are paired line by
 * line so a changed line shows next to its replacement.
 */
export function sideBySideDiff(before: string | null | undefined, after: string | null | undefined): DiffRow[] {
  const ops = diffOps(toLines(before), toLines(after));
  const rows: DiffRow[] = [];
  let leftNo = 0;
  let rightNo = 0;
  let k = 0;

  while (k < ops.length) {
    if (ops[k].type === 'same') {
      leftNo++;
      rightNo++;
      rows.push({
        left: { lineNo: leftNo, text: ops[k].text, kind: 'same' },
        right: { lineNo: rightNo, text: ops[k].text, kind: 'same' },
      });
      k++;
      continue;
    }
    const removed: string[] = [];
    const added: string[] = [];
    while (k < ops.length && ops[k].type !== 'same') {
      if (ops[k].type === 'removed') removed.push(ops[k].text);
      else added.push(ops[k].text);
      k++;
    }
    for (let r = 0; r < Math.max(removed.length, added.length); r++) {
      rows.push({
        left: r < removed.length ? { lineNo: ++leftNo, text: removed[r], kind: 'removed' } : null,
        right: r < added.length ? { lineNo: ++rightNo, text: added[r], kind: 'added' } : null,
      });
    }
  }
  return rows;
}

/**
 * Single-column (unified) diff for narrow screens, derived from the side-by-side rows:
 * within each changed block all removed lines come first, then the added lines.
 * Each cell keeps its own side's line number (old for same/removed, new for added).
 */
export function unifiedDiff(rows: DiffRow[]): DiffCell[] {
  const out: DiffCell[] = [];
  let added: DiffCell[] = [];
  const flush = () => {
    out.push(...added);
    added = [];
  };
  for (const row of rows) {
    if (row.left?.kind === 'same') {
      flush();
      out.push(row.left);
      continue;
    }
    if (row.left) out.push(row.left);
    if (row.right) added.push(row.right);
  }
  flush();
  return out;
}

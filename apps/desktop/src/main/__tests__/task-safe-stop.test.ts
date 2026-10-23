import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { SAFE_STOP_FILE, consumeSafeStop } from '../ai/orchestration/pause-handler';
import { requestSafeStop, takeSafeStop } from '../task-safe-stop';

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'safe-stop-'));
  dirs.push(d);
  return d;
};

describe('safe stop', () => {
  it('is consumed by the build between subtasks, then reported as consumed', () => {
    const main = tmp();
    const worktree = tmp();
    requestSafeStop('t1', [main, worktree]);
    expect(existsSync(path.join(main, SAFE_STOP_FILE))).toBe(true);

    expect(consumeSafeStop(worktree, main)).toBe(true);
    expect(consumeSafeStop(worktree, main)).toBe(false);
    expect(takeSafeStop('t1')).toEqual({ pending: true, consumed: true });
  });

  it('is not consumed when the build ended on its own, and leaves no markers', () => {
    const main = tmp();
    requestSafeStop('t2', [main]);
    expect(takeSafeStop('t2')).toEqual({ pending: true, consumed: false });
    expect(existsSync(path.join(main, SAFE_STOP_FILE))).toBe(false);
    expect(takeSafeStop('t2').pending).toBe(false);
  });
});

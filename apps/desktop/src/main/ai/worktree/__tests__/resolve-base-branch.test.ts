import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveBaseBranch } from '../worktree-manager';

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function repo(branch: string) {
  dir = mkdtempSync(path.join(tmpdir(), 'base-branch-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', branch);
  writeFileSync(path.join(dir, 'a.txt'), 'a');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
}

describe('resolveBaseBranch', () => {
  it('keeps a branch that exists', async () => {
    repo('main');
    expect(await resolveBaseBranch(dir, 'main')).toBe('main');
  });

  it('falls back to the checked-out branch when the base branch does not exist', async () => {
    repo('main');
    expect(await resolveBaseBranch(dir, 'dev')).toBe('main');
  });
});

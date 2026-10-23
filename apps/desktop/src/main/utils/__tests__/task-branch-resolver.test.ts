import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../cli-tool-manager', () => ({
  getToolPath: () => 'git',
}));

import { findExistingTaskBranch, resolveTaskBranch } from '../task-branch-resolver';
import { getIsolatedGitEnv } from '../git-isolation';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: getIsolatedGitEnv(),
  }).trim();
}

describe('task-branch-resolver', () => {
  let repo: string;
  const settings = { branchPrefix: 'feature/' };

  beforeEach(() => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'malvy-task-branch-'));
    git(repo, ['init', '-q']);
    writeFileSync(path.join(repo, 'README.md'), '# test\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'init']);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('returns null when no task branch exists', () => {
    expect(findExistingTaskBranch(repo, '001-x', settings)).toBeNull();
  });

  it('falls back to the configured name when nothing exists', () => {
    expect(resolveTaskBranch(repo, '001-x', settings)).toBe('feature/001-x');
  });

  it('finds a legacy malvy/ branch after the prefix changed', () => {
    git(repo, ['branch', 'malvy/001-x']);
    expect(findExistingTaskBranch(repo, '001-x', settings)).toBe('malvy/001-x');
    expect(resolveTaskBranch(repo, '001-x', settings)).toBe('malvy/001-x');
  });

  it('prefers the configured prefix over legacy branches', () => {
    git(repo, ['branch', 'malvy/001-x']);
    git(repo, ['branch', 'feature/001-x']);
    expect(findExistingTaskBranch(repo, '001-x', settings)).toBe('feature/001-x');
  });

  it('uses the branch checked out in the task worktree', () => {
    const worktree = path.join(repo, '.malvy', 'worktrees', 'tasks', '001-x');
    git(repo, ['worktree', 'add', '-q', '-b', 'malvy/001-x', worktree]);
    git(repo, ['branch', 'feature/001-x']);
    expect(resolveTaskBranch(repo, '001-x', settings, worktree)).toBe('malvy/001-x');
  });
});

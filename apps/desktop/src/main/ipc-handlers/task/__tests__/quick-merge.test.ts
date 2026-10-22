/**
 * Quick merge git steps against real repos (project checkout + task worktree + bare origin).
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../cli-tool-manager', () => ({ getToolPath: () => 'git' }));
vi.mock('../../../app-logger', () => ({ appLog: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../../ai/runners/merge-resolver', () => ({ resolveMergeConflict: vi.fn() }));

import type { resolveMergeConflict } from '../../../ai/runners/merge-resolver';
import { pickMergeTarget, runQuickMergeGit, type QuickMergeGitInput } from '../quick-merge';

let root: string;
let project: string;
let worktree: string;

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function commitFile(cwd: string, file: string, content: string, msg: string): void {
  writeFileSync(path.join(cwd, file), content);
  gitIn(cwd, 'add', file);
  gitIn(cwd, 'commit', '-q', '-m', msg);
}

function input(overrides: Partial<QuickMergeGitInput> = {}): QuickMergeGitInput {
  return {
    projectPath: project,
    worktreePath: worktree,
    featureBranch: 'malvy/001-task',
    targetBranch: 'main',
    commitMessage: 'Task one',
    specId: '001-task',
    emitProgress: () => undefined,
    ...overrides
  };
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'quick-merge-'));
  const origin = path.join(root, 'origin.git');
  project = path.join(root, 'project');
  worktree = path.join(root, 'wt');
  gitIn(root, 'init', '-q', '--bare', '-b', 'main', origin);
  gitIn(root, 'init', '-q', '-b', 'main', project);
  gitIn(project, 'config', 'user.email', 't@t');
  gitIn(project, 'config', 'user.name', 't');
  gitIn(project, 'config', 'commit.gpgsign', 'false');
  gitIn(project, 'remote', 'add', 'origin', origin);
  commitFile(project, 'app.txt', 'line 1\n', 'base');
  gitIn(project, 'push', '-q', 'origin', 'main');
  gitIn(project, 'worktree', 'add', '-q', '-b', 'malvy/001-task', worktree);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('runQuickMergeGit', () => {
  it('merges a clean feature branch into the local target with a merge commit', async () => {
    commitFile(worktree, 'feature.txt', 'new\n', 'feature work');

    const result = await runQuickMergeGit(input());

    expect(result).toEqual({ ok: true });
    expect(gitIn(project, 'log', '-1', '--format=%s')).toBe('Task one');
    expect(readFileSync(path.join(project, 'feature.txt'), 'utf-8')).toBe('new\n');
  });

  it('syncs with local main (ahead of origin) so conflicts are resolved in the worktree, not the project', async () => {
    // Local main is ahead of origin/main with a change that conflicts with the task
    commitFile(project, 'app.txt', 'line 1 from main\n', 'earlier local merge');
    commitFile(worktree, 'app.txt', 'line 1 from task\n', 'feature work');
    const resolve = vi.fn<typeof resolveMergeConflict>().mockResolvedValue({ success: true, text: 'line 1 from main and task' });

    const result = await runQuickMergeGit(input({ resolve }));

    expect(result).toEqual({ ok: true });
    expect(resolve).toHaveBeenCalledTimes(1);
    // The conflict was resolved on the feature branch (worktree side), before the final merge
    expect(gitIn(worktree, 'log', '-1', '--format=%P').split(' ')).toHaveLength(2);
    expect(readFileSync(path.join(worktree, 'app.txt'), 'utf-8')).toBe('line 1 from main and task\n');
    expect(readFileSync(path.join(project, 'app.txt'), 'utf-8')).toBe('line 1 from main and task\n');
    expect(gitIn(project, 'status', '--porcelain')).toBe('');
  });

  it('aborts cleanly when the AI cannot resolve, leaving the project checkout untouched', async () => {
    commitFile(project, 'app.txt', 'line 1 from main\n', 'earlier local merge');
    commitFile(worktree, 'app.txt', 'line 1 from task\n', 'feature work');
    const mainBefore = gitIn(project, 'rev-parse', 'main');
    const featureBefore = gitIn(project, 'rev-parse', 'malvy/001-task');
    const resolve = vi.fn<typeof resolveMergeConflict>().mockResolvedValue({
      success: false,
      text: '',
      error: 'Refresh token expired'
    });

    const result = await runQuickMergeGit(input({ resolve }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('sync-worktree');
    expect(result.message).toContain('app.txt (AI resolution failed: Refresh token expired)');
    expect(gitIn(project, 'rev-parse', 'main')).toBe(mainBefore);
    expect(gitIn(project, 'rev-parse', 'malvy/001-task')).toBe(featureBefore);
    expect(gitIn(project, 'status', '--porcelain')).toBe('');
    expect(gitIn(worktree, 'status', '--porcelain')).toBe('');
    expect(existsSync(path.join(worktree, '.git'))).toBe(true);
  });

  it('without a task worktree, syncs in a temporary worktree and leaves the project on the target', async () => {
    commitFile(worktree, 'feature.txt', 'new\n', 'feature work');
    gitIn(project, 'worktree', 'remove', '--force', worktree);
    commitFile(project, 'other.txt', 'main only\n', 'local main work');

    const result = await runQuickMergeGit(input({ worktreePath: null }));

    expect(result).toEqual({ ok: true });
    expect(gitIn(project, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(gitIn(project, 'worktree', 'list').split('\n')).toHaveLength(1);
    expect(readFileSync(path.join(project, 'feature.txt'), 'utf-8')).toBe('new\n');
  });

  it('creates a missing local target from origin', async () => {
    gitIn(project, 'checkout', '-q', '-b', 'dev');
    gitIn(project, 'push', '-q', 'origin', 'dev');
    gitIn(project, 'checkout', '-q', 'main');
    gitIn(project, 'branch', '-D', 'dev');
    commitFile(worktree, 'feature.txt', 'new\n', 'feature work');

    const result = await runQuickMergeGit(input({ targetBranch: 'dev' }));

    expect(result).toEqual({ ok: true });
    expect(gitIn(project, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('dev');
  });

  it('fails with a clear message when the target does not exist anywhere', async () => {
    const result = await runQuickMergeGit(input({ targetBranch: 'nope' }));

    expect(result).toEqual({ ok: false, stage: 'prepare-target', message: 'Target branch nope does not exist.' });
  });
});

describe('pickMergeTarget', () => {
  const pick = (opts: { task?: string; setting?: string; local?: string[]; remote?: string[] }) =>
    pickMergeTarget({
      taskBaseBranch: opts.task,
      projectMainBranch: opts.setting,
      isValidBranch: (name) => /^[\w./-]+$/.test(name),
      hasLocalBranch: (name) => (opts.local ?? []).includes(name),
      hasRemoteBranch: (name) => (opts.remote ?? []).includes(name)
    });

  it('uses the task base branch first', () => {
    expect(pick({ task: 'feat/x', setting: 'main', local: ['main', 'dev'] })).toBe('feat/x');
  });

  it('uses the project main branch setting over any detection', () => {
    expect(pick({ setting: 'main', local: ['main', 'dev'], remote: ['dev'] })).toBe('main');
    expect(pick({ setting: 'dev', local: ['main', 'dev'], remote: ['dev'] })).toBe('dev');
  });

  it('prefers a local main over origin/dev when nothing is configured', () => {
    expect(pick({ local: ['main'], remote: ['main', 'dev'] })).toBe('main');
    expect(pick({ local: ['main', 'dev'] })).toBe('main');
  });

  it('falls back to local master, then local dev, then origin/dev, then main', () => {
    expect(pick({ local: ['master', 'dev'] })).toBe('master');
    expect(pick({ local: ['dev'] })).toBe('dev');
    expect(pick({ remote: ['dev'] })).toBe('dev');
    expect(pick({})).toBe('main');
  });

  it('ignores a blank or invalid setting', () => {
    expect(pick({ setting: '  ', local: ['main'] })).toBe('main');
    expect(pick({ setting: 'bad name', local: ['dev'] })).toBe('dev');
  });
});

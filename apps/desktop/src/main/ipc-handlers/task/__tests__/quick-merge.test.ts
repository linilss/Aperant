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

import type { MergeAgentInput } from '../../../ai/runners/merge-conflict-agent';
import type { resolveMergeConflict } from '../../../ai/runners/merge-resolver';
import {
  AGENT_CONFLICT_THRESHOLD,
  pickMergeTarget,
  pushMergedTarget,
  runQuickMergeGit,
  shouldUseMergeAgent,
  type QuickMergeGitInput
} from '../quick-merge';

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

function agentSays(status: 'resolved' | 'failed', notes = '', verify = 'none'): string {
  return `work...\n<merge_result>${JSON.stringify({ status, notes, verify })}</merge_result>`;
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
    const mergeAgent = vi.fn(async () => agentSays('failed', 'Not logged in'));

    const result = await runQuickMergeGit(input({ resolve, mergeAgent }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('sync-worktree');
    expect(mergeAgent).toHaveBeenCalledTimes(1); // per-file leftovers fall back to the agent
    expect(result.message).toContain('Not logged in');
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

describe('stale task branch: agent fallback and verify gate', () => {
  const passed = { passed: true, exitCode: 0, timedOut: false, output: 'ok', durationMs: 1 };
  const failed = { passed: false, exitCode: 1, timedOut: false, output: 'error TS2307: Cannot find module ./gone', durationMs: 1 };

  /** A file both the task branch and main have, so each side can change or delete it */
  function shareFile(file: string, content: string): void {
    commitFile(project, file, content, `add ${file}`);
    gitIn(worktree, 'merge', '-q', '--ff-only', 'main');
  }

  /** Task deletes lib.txt, main changes it (modify/delete, DU in the worktree) */
  function modifyDelete(): void {
    shareFile('lib.txt', 'lib v1\n');
    gitIn(worktree, 'rm', '-q', 'lib.txt');
    gitIn(worktree, 'commit', '-q', '-m', 'task removes lib');
    commitFile(project, 'lib.txt', 'lib v2\n', 'main changes lib');
  }

  function snapshot() {
    return { main: gitIn(project, 'rev-parse', 'main'), feature: gitIn(project, 'rev-parse', 'malvy/001-task') };
  }

  function expectUntouched(before: { main: string; feature: string }): void {
    expect(gitIn(project, 'rev-parse', 'main')).toBe(before.main);
    expect(gitIn(project, 'rev-parse', 'malvy/001-task')).toBe(before.feature);
    expect(gitIn(project, 'status', '--porcelain')).toBe('');
    expect(gitIn(worktree, 'status', '--porcelain')).toBe('');
    expect(existsSync(path.join(worktree, '.git'))).toBe(true);
  }

  it('picks the agent for many conflicts or any modify/delete, the per-file resolver otherwise', () => {
    const uu = (n: number) => Array.from({ length: n }, (_, i) => ({ file: `f${i}`, code: 'UU' }));
    expect(shouldUseMergeAgent(uu(AGENT_CONFLICT_THRESHOLD))).toBe(false);
    expect(shouldUseMergeAgent(uu(AGENT_CONFLICT_THRESHOLD + 1))).toBe(true);
    expect(shouldUseMergeAgent([{ file: 'a', code: 'DU' }])).toBe(true);
    expect(shouldUseMergeAgent([{ file: 'a', code: 'UD' }])).toBe(true);
    expect(shouldUseMergeAgent([{ file: 'a', code: 'AA' }])).toBe(false);
  });

  it('sends a modify/delete straight to the agent, verifies and commits the merge in the worktree', async () => {
    modifyDelete();
    const resolve = vi.fn<typeof resolveMergeConflict>();
    const mergeAgent = vi.fn(async ({ cwd }: MergeAgentInput) => {
      gitIn(cwd, 'rm', '-q', 'lib.txt');
      return agentSays('resolved', 'kept lib deleted', 'passed');
    });
    const verify = vi.fn().mockResolvedValue(passed);
    const progress: string[] = [];

    const result = await runQuickMergeGit(
      input({ resolve, mergeAgent, verify, verifyCommand: 'npm test', emitProgress: (_s, _p, m) => progress.push(m) })
    );

    expect(result).toEqual({ ok: true });
    expect(resolve).not.toHaveBeenCalled();
    expect(mergeAgent).toHaveBeenCalledTimes(1);
    const agentInput = mergeAgent.mock.calls[0][0];
    expect(agentInput.cwd).toBe(worktree);
    expect(agentInput.conflicts).toEqual([{ file: 'lib.txt', code: 'DU' }]);
    expect(agentInput.verifyCommand).toBe('npm test');
    expect(agentInput.targetBranch).toBe('main');
    expect(verify).toHaveBeenCalledWith('npm test', worktree, undefined);
    expect(progress).toContain('Resolving 1 conflict with an agent…');
    expect(progress).toContain('Running checks…');
    expect(gitIn(worktree, 'log', '-1', '--format=%P').split(' ')).toHaveLength(2);
    expect(existsSync(path.join(project, 'lib.txt'))).toBe(false);
    expect(gitIn(project, 'status', '--porcelain')).toBe('');
  });

  it('sends many both-changed files to one agent and stages files it resolved without git add', async () => {
    const files = Array.from({ length: AGENT_CONFLICT_THRESHOLD + 1 }, (_, i) => `f${i}.txt`);
    for (const f of files) shareFile(f, 'base\n');
    for (const f of files) commitFile(worktree, f, 'task\n', `task ${f}`);
    for (const f of files) commitFile(project, f, 'main\n', `main ${f}`);
    const resolve = vi.fn<typeof resolveMergeConflict>();
    const mergeAgent = vi.fn(async ({ cwd, conflicts }: MergeAgentInput) => {
      for (const c of conflicts) writeFileSync(path.join(cwd, c.file), 'task and main\n');
      return agentSays('resolved');
    });

    const result = await runQuickMergeGit(input({ resolve, mergeAgent }));

    expect(result).toEqual({ ok: true });
    expect(resolve).not.toHaveBeenCalled();
    expect(mergeAgent.mock.calls[0][0].conflicts).toHaveLength(files.length);
    for (const f of files) expect(readFileSync(path.join(project, f), 'utf-8')).toBe('task and main\n');
  });

  it('runs verify after a per-file resolution and aborts the worktree merge when it fails', async () => {
    commitFile(project, 'app.txt', 'line 1 from main\n', 'main change');
    commitFile(worktree, 'app.txt', 'line 1 from task\n', 'feature work');
    const before = snapshot();
    const resolve = vi.fn<typeof resolveMergeConflict>().mockResolvedValue({ success: true, text: 'merged' });
    const mergeAgent = vi.fn();
    const verify = vi.fn().mockResolvedValue(failed);

    const result = await runQuickMergeGit(input({ resolve, mergeAgent, verify, verifyCommand: 'npm run typecheck' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('sync-worktree');
    expect(result.message).toContain('verify failed after resolving');
    expect(result.message).toContain('Cannot find module ./gone');
    expect(mergeAgent).not.toHaveBeenCalled();
    expectUntouched(before);
  });

  it('does not run verify for a clean merge', async () => {
    commitFile(project, 'other.txt', 'main\n', 'main work');
    commitFile(worktree, 'feature.txt', 'task\n', 'feature work');
    const verify = vi.fn();

    expect(await runQuickMergeGit(input({ verify, verifyCommand: 'npm test' }))).toEqual({ ok: true });
    expect(verify).not.toHaveBeenCalled();
  });

  it('aborts when the agent staged a file that still has conflict markers', async () => {
    modifyDelete();
    commitFile(project, 'app.txt', 'line 1 from main\n', 'main change');
    commitFile(worktree, 'app.txt', 'line 1 from task\n', 'feature work');
    const before = snapshot();
    const mergeAgent = vi.fn(async ({ cwd }: MergeAgentInput) => {
      gitIn(cwd, 'rm', '-q', 'lib.txt');
      gitIn(cwd, 'add', 'app.txt');
      return agentSays('resolved');
    });

    const result = await runQuickMergeGit(input({ mergeAgent }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('Conflict markers remain in: app.txt');
    expectUntouched(before);
  });

  it('reports what the agent left unresolved and removes files it created', async () => {
    modifyDelete();
    writeFileSync(path.join(worktree, 'notes.local'), 'mine\n');
    const before = snapshot();
    const mergeAgent = vi.fn(async ({ cwd }: MergeAgentInput) => {
      writeFileSync(path.join(cwd, 'scratch.txt'), 'agent temp\n');
      return agentSays('resolved', 'done');
    });

    const result = await runQuickMergeGit(input({ mergeAgent }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('left files unresolved');
    expect(result.message).toContain('lib.txt');
    expect(existsSync(path.join(worktree, 'scratch.txt'))).toBe(false);
    expect(readFileSync(path.join(worktree, 'notes.local'), 'utf-8')).toBe('mine\n');
    gitIn(worktree, 'clean', '-q', '-f', 'notes.local');
    expectUntouched(before);
  });

  it('passes the agent notes on when it gives up', async () => {
    modifyDelete();
    const before = snapshot();
    const mergeAgent = vi.fn(async () => agentSays('failed', 'lib.txt is needed by the new billing code'));

    const result = await runQuickMergeGit(input({ mergeAgent }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('could not resolve the merge: lib.txt is needed by the new billing code');
    expectUntouched(before);
  });

  it('aborts cleanly when the agent runs past the time limit', async () => {
    modifyDelete();
    const before = snapshot();
    const mergeAgent = vi.fn(async ({ cwd }: MergeAgentInput) => {
      gitIn(cwd, 'rm', '-q', 'lib.txt');
      return new Promise<string>(() => undefined);
    });

    const result = await runQuickMergeGit(input({ mergeAgent, agentTimeoutMs: 50 }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('The merge agent did not finish (timed out');
    expect(mergeAgent.mock.calls[0][0].abortSignal?.aborted).toBe(true);
    expectUntouched(before);
  });

  it('stops the agent when the merge is cancelled', async () => {
    modifyDelete();
    const before = snapshot();
    const controller = new AbortController();
    const mergeAgent = vi.fn(async () => {
      controller.abort();
      return new Promise<string>(() => undefined);
    });

    const result = await runQuickMergeGit(input({ mergeAgent, abortSignal: controller.signal }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('cancelled');
    expectUntouched(before);
  });

  it('discards the work of an agent that committed the merge itself', async () => {
    modifyDelete();
    const before = snapshot();
    const mergeAgent = vi.fn(async ({ cwd }: MergeAgentInput) => {
      gitIn(cwd, 'rm', '-q', 'lib.txt');
      gitIn(cwd, 'commit', '-q', '--no-edit');
      return agentSays('resolved');
    });

    const result = await runQuickMergeGit(input({ mergeAgent }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('committed or aborted the merge itself');
    expectUntouched(before);
  });

  it("takes main's version of generated artefacts without the resolver, the agent or verify", async () => {
    execFileSync('mkdir', ['-p', path.join(project, 'obj')]);
    shareFile('obj/project.assets.json', '{"v":1}\n');
    commitFile(worktree, 'obj/project.assets.json', '{"v":"task"}\n', 'task build');
    commitFile(project, 'obj/project.assets.json', '{"v":"main"}\n', 'main build');
    const resolve = vi.fn<typeof resolveMergeConflict>();
    const mergeAgent = vi.fn();
    const verify = vi.fn();

    const result = await runQuickMergeGit(input({ resolve, mergeAgent, verify, verifyCommand: 'npm test' }));

    expect(result).toEqual({ ok: true });
    expect(resolve).not.toHaveBeenCalled();
    expect(mergeAgent).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(readFileSync(path.join(project, 'obj/project.assets.json'), 'utf-8')).toBe('{"v":"main"}\n');
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

describe('pushMergedTarget', () => {
  it('pushes the target to origin', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'qm-push-'));
    try {
      const origin = path.join(dir, 'origin.git');
      const repo = path.join(dir, 'repo');
      execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
      execFileSync('git', ['clone', '-q', origin, repo], { stdio: 'pipe' });
      gitIn(repo, 'config', 'user.email', 't@t');
      gitIn(repo, 'config', 'user.name', 't');
      gitIn(repo, 'checkout', '-q', '-b', 'main');
      commitFile(repo, 'a.txt', 'a', 'first');
      expect(pushMergedTarget(repo, 'main', () => undefined)).toBe(' and pushed');
      expect(gitIn(origin, 'rev-parse', 'main')).toBe(gitIn(repo, 'rev-parse', 'HEAD'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a failed push without throwing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'qm-push-'));
    try {
      gitIn(dir, 'init', '-q', '-b', 'main');
      gitIn(dir, 'remote', 'add', 'origin', path.join(dir, 'missing.git'));
      const log = vi.fn();
      expect(pushMergedTarget(dir, 'main', log)).toMatch(/Push to origin failed/);
      expect(log).toHaveBeenCalledWith('push', expect.any(String));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

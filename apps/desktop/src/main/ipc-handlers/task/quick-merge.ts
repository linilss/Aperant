/**
 * Git steps of the quick merge (Merge buttons on pending_merge tasks):
 *
 *   1. Fetch origin (best effort)
 *   2. Merge the local <target> into the feature branch, in the task worktree (or a temporary
 *      one), resolving conflicts with AI there — never in the user's project checkout
 *   3. In the project checkout: checkout <target>, merge --no-ff the feature branch (clean after
 *      step 2), commit
 *
 * Local <target> is what gets merged into, and it is routinely ahead of origin (merges are
 * local, nothing pushes), so step 2 must use it rather than origin/<target>.
 *
 * Every failure aborts its merge so the project checkout is left as it was. Setting the user's
 * uncommitted work aside is the caller's job.
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { getToolPath } from '../../cli-tool-manager';
import { getIsolatedGitEnv } from '../../utils/git-isolation';
import {
  assertAllConflictsResolved,
  conflictFailureMessage,
  listUnmergedFiles,
  resolveAllConflictsOrThrow,
  type ResolveConflictsOptions
} from './git-conflict-resolution';

export type QuickMergeStage = 'prepare-target' | 'sync-worktree' | 'checkout-target' | 'final-merge' | 'commit';

export type QuickMergeGitResult = { ok: true } | { ok: false; stage: QuickMergeStage; message: string };

export interface QuickMergeGitInput {
  projectPath: string;
  /** The task's existing worktree (checked out on the feature branch), if any */
  worktreePath: string | null;
  featureBranch: string;
  targetBranch: string;
  commitMessage: string;
  specId: string;
  emitProgress: (stage: string, percent: number, message: string) => void;
  /** Injectable for tests */
  resolve?: ResolveConflictsOptions['resolve'];
}

function errMsg(err: unknown): string {
  if (err && typeof err === 'object' && 'stderr' in err) {
    const stderr = String((err as { stderr?: unknown }).stderr ?? '').trim();
    if (stderr) return stderr;
  }
  return err instanceof Error ? err.message : String(err);
}

function makeGit(cwd: string, extraEnv: Record<string, string> = {}) {
  return (args: string[]) =>
    execFileSync(getToolPath('git'), args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...getIsolatedGitEnv(), ...extraEnv }
    });
}

export function refExists(cwd: string, ref: string): boolean {
  try {
    makeGit(cwd)(['rev-parse', '--verify', '--quiet', ref]);
    return true;
  } catch {
    return false;
  }
}

function mergeInProgress(cwd: string): boolean {
  return refExists(cwd, 'MERGE_HEAD');
}

function abortMerge(cwd: string): void {
  try {
    if (mergeInProgress(cwd)) makeGit(cwd)(['merge', '--abort']);
  } catch {
    /* ignore */
  }
}

/**
 * Merge `ref` into the branch checked out in `cwd`, resolving conflicts with AI.
 * Returns an error message (the merge aborted) or null.
 */
async function mergeWithAI(
  cwd: string,
  ref: string,
  projectPath: string,
  options: ResolveConflictsOptions,
  mergeArgs: string[],
  commitAfter: boolean
): Promise<string | null> {
  const git = makeGit(cwd);
  try {
    git(['merge', ...mergeArgs, ref]);
  } catch (mergeErr) {
    if (listUnmergedFiles(cwd).length === 0) {
      // Not a content conflict (dirty tree, unrelated histories, ...)
      abortMerge(cwd);
      return `git merge ${ref} failed: ${errMsg(mergeErr)}`;
    }
    try {
      await resolveAllConflictsOrThrow(cwd, projectPath, options);
    } catch (resolveErr) {
      abortMerge(cwd);
      return conflictFailureMessage(resolveErr);
    }
  }
  if (!commitAfter) return null;
  try {
    assertAllConflictsResolved(cwd, []);
    if (mergeInProgress(cwd)) makeGit(cwd, { GIT_EDITOR: 'true' })(['merge', '--continue']);
    return null;
  } catch (err) {
    abortMerge(cwd);
    return conflictFailureMessage(err);
  }
}

/**
 * Which branch the Merge buttons merge into. Priority:
 *   1. The task's own base branch (task_metadata.json)
 *   2. The project's main branch setting
 *   3. A local main, master or dev branch (in that order; deploys ship main/master)
 *   4. origin/dev when only the remote has it
 *   5. 'main'
 */
export function pickMergeTarget(opts: {
  taskBaseBranch?: string;
  projectMainBranch?: string;
  isValidBranch: (name: string) => boolean;
  hasLocalBranch: (name: string) => boolean;
  hasRemoteBranch: (name: string) => boolean;
}): string {
  if (opts.taskBaseBranch) return opts.taskBaseBranch;
  const configured = opts.projectMainBranch?.trim();
  if (configured && opts.isValidBranch(configured)) return configured;
  const local = ['main', 'master', 'dev'].find((b) => opts.hasLocalBranch(b));
  if (local) return local;
  if (opts.hasRemoteBranch('dev')) return 'dev';
  return 'main';
}

export async function runQuickMergeGit(input: QuickMergeGitInput): Promise<QuickMergeGitResult> {
  const { projectPath, featureBranch, targetBranch, commitMessage, specId, emitProgress, resolve } = input;
  const git = makeGit(projectPath);
  const logTag = `[QUICK_MERGE] ${specId}`;

  // Step 1: fetch (only used to create a missing local target branch)
  emitProgress('updating', 10, 'Fetching latest from origin');
  try {
    git(['fetch', 'origin']);
  } catch {
    /* offline or no remote — non-fatal */
  }

  if (!refExists(projectPath, `refs/heads/${targetBranch}`)) {
    if (!refExists(projectPath, `refs/remotes/origin/${targetBranch}`)) {
      return { ok: false, stage: 'prepare-target', message: `Target branch ${targetBranch} does not exist.` };
    }
    try {
      git(['branch', '--track', targetBranch, `origin/${targetBranch}`]);
    } catch (err) {
      return { ok: false, stage: 'prepare-target', message: `Could not create ${targetBranch} from origin: ${errMsg(err)}` };
    }
  }

  // Step 2: bring the feature branch up to date with the local target, in a worktree
  emitProgress('updating', 30, `Bringing ${featureBranch} up to date with ${targetBranch}`);
  let syncDir = input.worktreePath && existsSync(input.worktreePath) ? input.worktreePath : null;
  let tempDir: string | null = null;
  try {
    if (!syncDir) {
      tempDir = mkdtempSync(path.join(tmpdir(), 'malvy-merge-'));
      const dir = path.join(tempDir, 'wt');
      try {
        git(['worktree', 'add', '--quiet', dir, featureBranch]);
      } catch (err) {
        return {
          ok: false,
          stage: 'sync-worktree',
          message: `Could not check out ${featureBranch} to update it: ${errMsg(err)}`
        };
      }
      syncDir = dir;
    }
    const syncError = await mergeWithAI(
      syncDir,
      targetBranch,
      projectPath,
      {
        targetSide: 'theirs',
        logTag,
        resolve,
        onProgress: (msg) => emitProgress('resolving', 45, msg)
      },
      ['--no-edit'],
      true
    );
    if (syncError) {
      return {
        ok: false,
        stage: 'sync-worktree',
        message: `${syncError} Resolve them in the task worktree manually; ${targetBranch} was not changed.`
      };
    }
  } finally {
    if (tempDir) {
      try {
        git(['worktree', 'remove', '--force', path.join(tempDir, 'wt')]);
      } catch {
        /* removed below */
      }
      rmSync(tempDir, { recursive: true, force: true });
      try {
        git(['worktree', 'prune']);
      } catch {
        /* ignore */
      }
    }
  }

  // Step 3: merge the feature branch into the target in the project checkout
  emitProgress('resolving', 70, `Merging ${featureBranch} into ${targetBranch}`);
  try {
    git(['checkout', targetBranch]);
  } catch (err) {
    return { ok: false, stage: 'checkout-target', message: `Could not check out ${targetBranch}: ${errMsg(err)}` };
  }
  const finalError = await mergeWithAI(
    projectPath,
    featureBranch,
    projectPath,
    {
      targetSide: 'ours',
      logTag,
      resolve,
      onProgress: (msg) => emitProgress('resolving', 85, msg)
    },
    ['--no-ff', '--no-commit'],
    false
  );
  if (finalError) {
    return { ok: false, stage: 'final-merge', message: `${finalError} The merge into ${targetBranch} was aborted.` };
  }

  // Never commit with unmerged files left (git's own error names no files or reason)
  try {
    assertAllConflictsResolved(projectPath, []);
  } catch (err) {
    abortMerge(projectPath);
    return { ok: false, stage: 'commit', message: `${conflictFailureMessage(err)} The merge into ${targetBranch} was aborted.` };
  }
  if (!mergeInProgress(projectPath)) return { ok: true }; // already up to date
  try {
    git(['commit', '--no-edit', '-m', commitMessage]);
  } catch (err) {
    const msg = errMsg(err);
    if (!msg.includes('nothing to commit') && !msg.includes('nothing added')) {
      abortMerge(projectPath);
      return { ok: false, stage: 'commit', message: `Commit failed: ${msg}` };
    }
  }
  return { ok: true };
}

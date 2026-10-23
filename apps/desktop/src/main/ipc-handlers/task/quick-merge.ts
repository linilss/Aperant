/**
 * Git steps of the quick merge (Merge buttons on pending_merge tasks):
 *
 *   1. Fetch origin (best effort)
 *   2. Merge the local <target> into the feature branch, in the task worktree (or a temporary
 *      one), resolving conflicts there — never in the user's project checkout:
 *        - generated artefacts (__pycache__, bin/, obj/, ...) take the target's version
 *        - a few both-changed files: the per-file AI resolver
 *        - many files, any modify/delete, or whatever the per-file resolver left: one agent
 *          (merge-conflict-agent.ts) that sees the whole merge and fixes its fallout
 *      then a gate (no unmerged files, no new conflict markers, verify command passes) before
 *      the merge is committed in the worktree. A merge that doesn't build never reaches <target>.
 *   3. In the project checkout: checkout <target>, merge --no-ff the feature branch (clean after
 *      step 2), commit
 *
 * Local <target> is what gets merged into. It can be ahead of origin (a push failed or was
 * done by hand), so step 2 must use it rather than origin/<target>. After a merge the caller
 * pushes <target> (pushMergedTarget).
 *
 * Every failure aborts its merge so the project checkout is left as it was. Setting the user's
 * uncommitted work aside is the caller's job.
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { runVerifyCommand, tailOutput, type VerifyCommandResult } from '../../ai/orchestration/verify-command';
import {
  isModifyDeleteCode,
  parseMergeResult,
  runMergeConflictAgent,
  type MergeAgentRunner
} from '../../ai/runners/merge-conflict-agent';
import { appLog } from '../../app-logger';
import { getToolPath } from '../../cli-tool-manager';
import { getIsolatedGitEnv } from '../../utils/git-isolation';
import {
  assertAllConflictsResolved,
  conflictFailureMessage,
  describeUnresolved,
  findNewConflictMarkers,
  hasConflictMarkers,
  listConflicts,
  listUnmergedFiles,
  resolveAllConflictsOrThrow,
  resolveGitConflictsWithAI,
  takeGeneratedArtifacts,
  type ConflictEntry,
  type ResolveConflictsOptions,
  type UnresolvedConflict
} from './git-conflict-resolution';

/** More conflicted files than this go straight to the agent (one agent sees the whole picture) */
export const AGENT_CONFLICT_THRESHOLD = 8;
/** Overall time limit for the merge agent */
export const MERGE_AGENT_TIMEOUT_MS = 20 * 60 * 1000;

export type VerifyRunner = (command: string, cwd: string, abortSignal?: AbortSignal) => Promise<VerifyCommandResult>;

export type QuickMergeStage = 'prepare-target' | 'sync-worktree' | 'checkout-target' | 'final-merge' | 'commit';

/** `note`: something the user should know about a successful merge (e.g. work set aside) */
export type QuickMergeGitResult = { ok: true; note?: string } | { ok: false; stage: QuickMergeStage; message: string };

export interface QuickMergeGitInput {
  projectPath: string;
  /** The task's existing worktree (checked out on the feature branch), if any */
  worktreePath: string | null;
  featureBranch: string;
  targetBranch: string;
  commitMessage: string;
  specId: string;
  emitProgress: (stage: string, percent: number, message: string) => void;
  /** Project verify command (resolveVerifyCommand); gates a merge that needed conflict resolution */
  verifyCommand?: string;
  /** The task's spec.md, given to the merge agent so it knows the task's intent */
  specPath?: string;
  /** Cancels the merge agent and verify run; the worktree merge is then aborted */
  abortSignal?: AbortSignal;
  /** Injectable for tests */
  resolve?: ResolveConflictsOptions['resolve'];
  mergeAgent?: MergeAgentRunner;
  verify?: VerifyRunner;
  agentTimeoutMs?: number;
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
 * Agent or per-file resolver: the agent for many conflicts or any modify/delete (the per-file
 * resolver can't do those and is slow one file at a time), the per-file resolver otherwise.
 */
export function shouldUseMergeAgent(conflicts: ConflictEntry[]): boolean {
  return conflicts.length > AGENT_CONFLICT_THRESHOLD || conflicts.some((c) => isModifyDeleteCode(c.code));
}

function listUntracked(cwd: string): string[] {
  return makeGit(cwd)(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
}

function readSpec(specPath: string | undefined): string | undefined {
  if (!specPath) return undefined;
  try {
    return readFileSync(specPath, 'utf-8');
  } catch {
    return undefined;
  }
}

/** Run the agent with an overall timeout; rejects on timeout/cancel even if the runner ignores the signal */
async function runAgentBounded(
  run: (signal: AbortSignal) => Promise<string>,
  timeoutMs: number,
  outer?: AbortSignal
): Promise<string> {
  const controller = new AbortController();
  let reason = '';
  const stop = (why: string) => {
    if (!reason) reason = why;
    controller.abort();
  };
  const timer = setTimeout(() => stop(`timed out after ${Math.round(timeoutMs / 60_000)} min`), timeoutMs);
  const onOuterAbort = () => stop('cancelled');
  if (outer?.aborted) stop('cancelled');
  outer?.addEventListener('abort', onOuterAbort, { once: true });
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error(reason)), { once: true });
  });
  try {
    if (controller.signal.aborted) throw new Error(reason);
    return await Promise.race([run(controller.signal), aborted]);
  } catch (err) {
    if (reason) throw new Error(reason);
    throw err;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}

interface SyncContext {
  cwd: string;
  input: QuickMergeGitInput;
  logTag: string;
}

/**
 * Step 2: merge the local target into the feature branch in `cwd` and commit it there.
 * Returns an error message (the merge aborted, the worktree back as it was) or null.
 */
async function syncWithTarget({ cwd, input, logTag }: SyncContext): Promise<string | null> {
  const { projectPath, targetBranch, featureBranch, specId, emitProgress, resolve } = input;
  const git = makeGit(cwd);
  const headBefore = git(['rev-parse', 'HEAD']).trim();
  const untrackedBefore = new Set(listUntracked(cwd));
  // Uncommitted edits that were already there are not the agent's and stay out of the merge commit
  const dirtyBefore = new Set(git(['diff', '--name-only']).split('\n').filter(Boolean));
  try {
    // --no-commit: a clean merge is checked (verify) before it is committed
    git(['merge', '--no-edit', '--no-commit', '--no-ff', targetBranch]);
    if (!mergeInProgress(cwd)) return null; // already up to date
  } catch (mergeErr) {
    if (listUnmergedFiles(cwd).length === 0) {
      // Not a content conflict (dirty tree, unrelated histories, ...)
      abortMerge(cwd);
      return `git merge ${targetBranch} failed: ${errMsg(mergeErr)}`;
    }
  }

  /** Abort the merge and remove files the agent created, so the worktree is as it was */
  const fail = (message: string): string => {
    abortMerge(cwd);
    try {
      if (git(['rev-parse', 'HEAD']).trim() !== headBefore) git(['reset', '--hard', headBefore]);
      for (const file of listUntracked(cwd)) {
        if (!untrackedBefore.has(file)) rmSync(path.join(cwd, file), { force: true });
      }
    } catch {
      /* best effort */
    }
    return message;
  };

  takeGeneratedArtifacts(cwd, 'theirs');
  let conflicts = listConflicts(cwd);
  let unresolved: UnresolvedConflict[] = [];
  const hadRealConflicts = conflicts.length > 0;

  if (conflicts.length > 0 && !shouldUseMergeAgent(conflicts)) {
    unresolved = await resolveGitConflictsWithAI(cwd, projectPath, {
      targetSide: 'theirs',
      logTag,
      resolve,
      onProgress: (msg) => emitProgress('resolving', 45, msg)
    });
    conflicts = listConflicts(cwd);
  }

  /** One agent pass over the merge in progress; returns a failure message or null */
  const agentPass = async (verifyFailure?: string): Promise<string | null> => {
    emitProgress('resolving', 50, verifyFailure ? 'Fixing what the merge broke with an agent…' : `Resolving ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} with an agent…`);
    const runner = input.mergeAgent ?? runMergeConflictAgent;
    let mergeBase = headBefore;
    try {
      mergeBase = git(['merge-base', 'HEAD', 'MERGE_HEAD']).trim();
    } catch {
      /* keep HEAD */
    }
    let text: string;
    try {
      text = await runAgentBounded(
        (signal) =>
          runner({
            cwd,
            projectPath,
            targetBranch,
            featureBranch,
            mergeBase,
            conflicts,
            specText: readSpec(input.specPath),
            verifyCommand: input.verifyCommand,
            verifyFailure,
            abortSignal: signal
          }),
        input.agentTimeoutMs ?? MERGE_AGENT_TIMEOUT_MS,
        input.abortSignal
      );
    } catch (err) {
      const msg = errMsg(err);
      appLog.warn(`${logTag} stage=agent-resolve error=${msg}`);
      return (`The merge agent did not finish (${msg}). ${describeUnresolved(conflicts.map((c) => c.file), unresolved)}.`);
    }
    const result = parseMergeResult(text);
    const notes = result?.notes || 'no notes';

    if (git(['rev-parse', 'HEAD']).trim() !== headBefore || !mergeInProgress(cwd)) {
      appLog.warn(`${logTag} stage=agent-resolve error=agent changed git history notes=${notes}`);
      return ('The merge agent committed or aborted the merge itself, so its work was discarded.');
    }

    // Stage what the agent fixed but didn't add: tracked edits outside the conflicts, and
    // both-sides files without markers. A modify/delete it left is not a decision, so it stays.
    const stillUnmerged = new Set(listUnmergedFiles(cwd));
    const edited = git(['diff', '--name-only']).split('\n').filter((f) => f && !stillUnmerged.has(f) && !dirtyBefore.has(f));
    if (edited.length > 0) git(['add', '--', ...edited]);
    for (const c of listConflicts(cwd)) {
      if (c.code !== 'UU' && c.code !== 'AA') continue;
      try {
        if (!hasConflictMarkers(readFileSync(path.join(cwd, c.file), 'utf-8'))) git(['add', '--', c.file]);
      } catch {
        /* unreadable: stays unmerged */
      }
    }

    const left = listUnmergedFiles(cwd);
    if (left.length > 0 || result?.status !== 'resolved') {
      const why = result ? (result.status === 'resolved' ? 'left files unresolved' : 'could not resolve the merge') : 'gave no result';
      appLog.warn(`${logTag} stage=agent-resolve error=${why} remaining=${left.join(',')} notes=${notes}`);
      const remaining = left.length > 0 ? ` ${describeUnresolved(left, unresolved)}.` : '';
      return (`The merge agent ${why}: ${notes}.${remaining}`);
    }
    appLog.info(`${logTag} stage=agent-resolve resolved=${conflicts.length} verify=${result.verify} notes=${notes}`);
    return null;
  };

  if (conflicts.length > 0) {
    const agentError = await agentPass();
    if (agentError) return fail(agentError);
  }

  try {
    assertAllConflictsResolved(cwd, unresolved);
  } catch (err) {
    return fail(conflictFailureMessage(err));
  }
  const markers = findNewConflictMarkers(cwd);
  if (markers.length > 0) {
    appLog.warn(`${logTag} stage=markers files=${markers.join(',')}`);
    return fail(`Conflict markers remain in: ${markers.join(', ')}.`);
  }

  // Always check when the target brought in commits: two tasks that each pass can still
  // break each other without a textual conflict (a signature changed under a caller)
  const verifyCommand = input.verifyCommand?.trim();
  if (verifyCommand) {
    emitProgress('validating', 60, 'Running checks…');
    const verify = input.verify ?? ((cmd, dir, signal) => runVerifyCommand(cmd, dir, { abortSignal: signal }));
    let res = await verify(verifyCommand, cwd, input.abortSignal);
    if (input.abortSignal?.aborted) return fail('Merge cancelled.');
    if (!res.passed && !hadRealConflicts) {
      // Clean merge that doesn't build: give the agent one go at the fallout
      const tail = tailOutput(res.output, 40, 4_000);
      appLog.warn(`${logTag} stage=verify-clean-merge command=${verifyCommand} output=${tailOutput(res.output, 15, 1_500)}`);
      const agentError = await agentPass(tail);
      if (agentError) return fail(`The merge doesn't pass verify and the agent couldn't fix it: ${agentError}`);
      res = await verify(verifyCommand, cwd, input.abortSignal);
      if (input.abortSignal?.aborted) return fail('Merge cancelled.');
    }
    if (!res.passed) {
      const tail = tailOutput(res.output, 15, 1_500);
      appLog.warn(`${logTag} stage=verify command=${verifyCommand} output=${tail}`);
      return fail(`verify failed after merging ${targetBranch}: ${tail}`);
    }
  }

  try {
    makeGit(cwd, { GIT_EDITOR: 'true' })(['merge', '--continue']);
  } catch (err) {
    appLog.warn(`${logTag} stage=commit-sync spec=${specId} error=${errMsg(err)}`);
    return fail(`Could not commit the merge in the worktree: ${errMsg(err)}`);
  }
  return null;
}

/**
 * Step 3: merge `ref` into the branch checked out in `cwd` without committing. Clean after
 * step 2; the per-file resolver only covers a target that moved meanwhile.
 * Returns an error message (the merge aborted) or null.
 */
async function mergeWithAI(
  cwd: string,
  ref: string,
  projectPath: string,
  options: ResolveConflictsOptions,
  mergeArgs: string[]
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
  return null;
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
  let setAsideNote = '';
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
    // Uncommitted edits left in the task worktree (an agent that never committed them)
    // would block the merge; only committed work is merged, so set them aside
    if (!tempDir) {
      const dirty = makeGit(syncDir)(['status', '--porcelain', '--untracked-files=no', '--', '.', ':(exclude).malvy']).trim();
      if (dirty) {
        const label = `malvy: uncommitted changes set aside before merging ${specId}`;
        try {
          makeGit(syncDir)(['stash', 'push', '-m', label, '--', '.', ':(exclude).malvy']);
          setAsideNote = ` (${dirty.split('\n').length} uncommitted change(s) in the task worktree were not part of the merge; they are in git stash "${label}")`;
        } catch (err) {
          return { ok: false, stage: 'sync-worktree', message: `The task worktree has uncommitted changes that could not be set aside: ${errMsg(err)}` };
        }
      }
    }
    const syncError = await syncWithTarget({ cwd: syncDir, input, logTag });
    if (syncError) {
      return {
        ok: false,
        stage: 'sync-worktree',
        message: `${syncError} The task worktree was left as it was and ${targetBranch} was not changed; merge ${targetBranch} into the task by hand to finish.`
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
    ['--no-ff', '--no-commit']
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
  if (!mergeInProgress(projectPath)) return { ok: true, note: setAsideNote || undefined }; // already up to date
  try {
    git(['commit', '--no-edit', '-m', commitMessage]);
  } catch (err) {
    const msg = errMsg(err);
    if (!msg.includes('nothing to commit') && !msg.includes('nothing added')) {
      abortMerge(projectPath);
      return { ok: false, stage: 'commit', message: `Commit failed: ${msg}` };
    }
  }
  return { ok: true, note: setAsideNote || undefined };
}

/** Push `target` to origin after a quick merge; returns a note for the toast ('' when pushed) */
export function pushMergedTarget(projectPath: string, target: string, log: (stage: string, msg: string) => void): string {
  try {
    const remotes = execFileSync(getToolPath('git'), ['remote'], { cwd: projectPath, encoding: 'utf-8', env: getIsolatedGitEnv() });
    if (!remotes.split(/\s+/).includes('origin')) return ' (no origin remote, not pushed)';
    execFileSync(getToolPath('git'), ['push', 'origin', target], {
      cwd: projectPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], env: getIsolatedGitEnv(), timeout: 120_000
    });
    return ' and pushed';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('push', msg);
    return `. Push to origin failed: ${msg.split('\n').find((l) => l.trim()) ?? msg}`;
  }
}

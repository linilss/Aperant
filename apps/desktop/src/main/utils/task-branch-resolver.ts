/**
 * Git-backed lookup of task branches.
 *
 * Task branches are named `{prefix}{specId}` where the prefix is configurable
 * per project. Because the prefix can change after branches were created (and
 * older versions used `malvy/` / `auto-claude/`), lookups try every candidate
 * prefix instead of assuming a single name.
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { getToolPath } from '../cli-tool-manager';
import { getIsolatedGitEnv } from './git-isolation';
import {
  getTaskBranchCandidates,
  getTaskBranchName,
  type TaskBranchSettings
} from '../../shared/utils/task-branch';

function branchExists(projectPath: string, branch: string): boolean {
  try {
    execFileSync(getToolPath('git'), ['rev-parse', '--verify', '--quiet', branch], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: getIsolatedGitEnv()
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the first existing branch for a task (configured prefix first, then legacy prefixes).
 * Returns null when no candidate branch exists.
 */
export function findExistingTaskBranch(
  projectPath: string,
  specId: string,
  settings?: TaskBranchSettings | null
): string | null {
  for (const candidate of getTaskBranchCandidates(specId, settings)) {
    if (branchExists(projectPath, candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Resolve the branch a task is (or will be) on.
 *
 * Order: the branch checked out in the task worktree (if it is one of the task's
 * candidate names), then the first existing candidate branch, then the
 * configured branch name.
 */
export function resolveTaskBranch(
  projectPath: string,
  specId: string,
  settings?: TaskBranchSettings | null,
  worktreePath?: string | null
): string {
  const candidates = getTaskBranchCandidates(specId, settings);

  if (worktreePath && existsSync(worktreePath)) {
    try {
      const head = execFileSync(getToolPath('git'), ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: worktreePath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: getIsolatedGitEnv()
      }).trim();
      if (candidates.includes(head)) {
        return head;
      }
    } catch {
      // Fall through to branch lookup
    }
  }

  return findExistingTaskBranch(projectPath, specId, settings) ?? getTaskBranchName(specId, settings);
}

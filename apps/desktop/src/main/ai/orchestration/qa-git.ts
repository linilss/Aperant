/**
 * Git helpers for the QA fix safety net: checkpoint before a fix, revert a fix
 * that turned green tests red. Only ever used inside a task worktree.
 */

import { execFileSync } from 'node:child_process';
import { sep } from 'node:path';

const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** True for Malvy task worktrees (`.malvy/worktrees/tasks/<spec>`) */
export function isTaskWorktree(dir: string): boolean {
  return dir.includes(`${sep}.malvy${sep}worktrees${sep}tasks${sep}`);
}

/** Commit pending work (Malvy files excluded by git) and return HEAD; null on failure */
export function gitCheckpoint(dir: string): string | null {
  try {
    if (git(dir, ['status', '--porcelain', '--untracked-files=all'])) {
      git(dir, ['add', '-A', '.']);
      git(dir, ['commit', '--no-verify', '-m', 'QA checkpoint before fixes']);
    }
    return git(dir, ['rev-parse', 'HEAD']);
  } catch {
    return null;
  }
}

/** Hard-reset tracked files to `commit`; untracked files are left alone */
export function gitResetHard(dir: string, commit: string): boolean {
  try {
    git(dir, ['reset', '--hard', commit]);
    return true;
  } catch {
    return false;
  }
}

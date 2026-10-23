/**
 * Local (untracked) git ignore handling.
 *
 * Malvy must be pluggable into a repository without leaving any trace that
 * other developers can see. Instead of writing to the tracked `.gitignore`,
 * entries are appended to `<git-dir>/info/exclude`, which git honours but
 * never commits.
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { getToolPath } from './cli-tool-manager';
import { getIsolatedGitEnv } from './utils/git-isolation';

/** Header line written once above Malvy's entries in info/exclude */
export const GIT_EXCLUDE_HEADER = '# malvy (local)';

/** Entries Malvy keeps out of git in every project it is plugged into */
export const MALVY_GIT_EXCLUDE_ENTRIES = ['.malvy/', 'CLAUDE.local.md'];

/**
 * Resolve the absolute path of the exclude file git actually reads for a
 * project. Uses `--git-path` rather than `--git-dir` so that linked worktrees
 * resolve to the shared `<common-dir>/info/exclude` (git ignores a per-worktree
 * info/exclude). Relative output is resolved against the project path.
 */
export function resolveGitExcludePath(projectPath: string): string {
  const excludePath = execFileSync(getToolPath('git'), ['rev-parse', '--git-path', 'info/exclude'], {
    cwd: projectPath,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: getIsolatedGitEnv()
  }).trim();
  return path.resolve(projectPath, excludePath);
}

function normalizeEntry(entry: string): string {
  return entry.trim().replace(/^\//, '').replace(/\/$/, '');
}

/**
 * Ensure the given entries exist in `<git-dir>/info/exclude`.
 *
 * Idempotent: only missing entries are appended, the header comment is added
 * once, and the file always ends with a newline. Never touches `.gitignore`.
 *
 * @returns the entries that were added
 */
export function ensureGitExcludeEntries(projectPath: string, entries: string[]): string[] {
  const excludePath = resolveGitExcludePath(projectPath);
  const infoDir = path.dirname(excludePath);

  if (!existsSync(infoDir)) {
    mkdirSync(infoDir, { recursive: true });
  }

  let content = '';
  try {
    content = readFileSync(excludePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const existingLines = content.split(/\r?\n/).map((line) => line.trim());
  const existing = new Set(existingLines.map(normalizeEntry));

  const entriesToAdd = entries.filter((entry) => !existing.has(normalizeEntry(entry)));
  if (entriesToAdd.length === 0) {
    return [];
  }

  let appendContent = '';
  if (content && !content.endsWith('\n')) {
    appendContent += '\n';
  }
  if (!existingLines.includes(GIT_EXCLUDE_HEADER)) {
    appendContent += `${GIT_EXCLUDE_HEADER}\n`;
  }
  appendContent += `${entriesToAdd.join('\n')}\n`;

  writeFileSync(excludePath, content + appendContent, 'utf-8');
  return entriesToAdd;
}

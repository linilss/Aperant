/**
 * CLAUDE.local.md wiring for invisible mode.
 *
 * Claude CLI loads `CLAUDE.local.md` from the project root. Malvy appends
 * import lines for its own doc layer and pointers there so the CLI sees them
 * too, and keeps the file out of git via `<git-dir>/info/exclude`.
 * Existing user content is never removed.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureGitExcludeEntries } from './git-exclude';

export const CLAUDE_LOCAL_FILE = 'CLAUDE.local.md';
export const CLAUDE_LOCAL_IMPORTS = ['@.malvy/docs/CLAUDE.md', '@.malvy/pointers.md'];

/**
 * Ensure `CLAUDE.local.md` contains Malvy's import lines (idempotent) and that
 * `.malvy/` and `CLAUDE.local.md` are git-excluded.
 *
 * @returns the import lines that were added
 */
export function ensureClaudeLocalImports(projectPath: string): string[] {
  const filePath = path.join(projectPath, CLAUDE_LOCAL_FILE);
  const content = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
  const existing = new Set(content.split(/\r?\n/).map((line) => line.trim()));
  const missing = CLAUDE_LOCAL_IMPORTS.filter((line) => !existing.has(line));

  if (missing.length > 0) {
    let next = content;
    if (next && !next.endsWith('\n')) next += '\n';
    if (next) next += '\n';
    next += `${missing.join('\n')}\n`;
    writeFileSync(filePath, next, 'utf-8');
  }

  try {
    ensureGitExcludeEntries(projectPath, ['.malvy/', CLAUDE_LOCAL_FILE]);
  } catch {
    // Not a git repository (or git unavailable) — nothing to exclude from
  }
  return missing;
}

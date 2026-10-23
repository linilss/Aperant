/**
 * CLAUDE.local.md wiring for invisible mode.
 *
 * Claude CLI loads `CLAUDE.local.md` from the project root. Malvy adds import
 * lines for its core values, its own doc layer and pointers there so the CLI
 * sees them too, and keeps the file out of git via `<git-dir>/info/exclude`.
 * Existing user content is never removed.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CORE_VALUES_IMPORT } from './core-values';
import { ensureGitExcludeEntries } from './git-exclude';

export const CLAUDE_LOCAL_FILE = 'CLAUDE.local.md';
/** In priority order: core values first, so they are read before anything else */
export const CLAUDE_LOCAL_IMPORTS = [CORE_VALUES_IMPORT, '@.malvy/docs/CLAUDE.md', '@.malvy/pointers.md'];

/**
 * Add the missing import lines to `content`, keeping CLAUDE_LOCAL_IMPORTS order:
 * a missing line goes right before the first later import already present,
 * otherwise it is appended at the end (exported for tests).
 */
export function addClaudeLocalImports(content: string): { next: string; added: string[] } {
  const lines = content ? content.split(/\r?\n/) : [];
  const present = new Set(lines.map((line) => line.trim()));
  const added = CLAUDE_LOCAL_IMPORTS.filter((line) => !present.has(line));
  if (added.length === 0) return { next: content, added };

  const appended: string[] = [];
  for (const line of added) {
    const later = CLAUDE_LOCAL_IMPORTS.slice(CLAUDE_LOCAL_IMPORTS.indexOf(line) + 1);
    const at = lines.findIndex((l) => later.includes(l.trim()));
    if (at === -1) appended.push(line);
    else lines.splice(at, 0, line);
  }

  let next = lines.join('\n');
  if (appended.length > 0) {
    if (next && !next.endsWith('\n')) next += '\n';
    if (next) next += '\n';
    next += `${appended.join('\n')}\n`;
  }
  return { next, added };
}

/**
 * Ensure `CLAUDE.local.md` contains Malvy's import lines (idempotent) and that
 * `.malvy/` and `CLAUDE.local.md` are git-excluded.
 *
 * @returns the import lines that were added
 */
export function ensureClaudeLocalImports(projectPath: string): string[] {
  const filePath = path.join(projectPath, CLAUDE_LOCAL_FILE);
  const content = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
  const { next, added } = addClaudeLocalImports(content);
  if (added.length > 0) writeFileSync(filePath, next, 'utf-8');

  try {
    ensureGitExcludeEntries(projectPath, ['.malvy/', CLAUDE_LOCAL_FILE]);
  } catch {
    // Not a git repository (or git unavailable) — nothing to exclude from
  }
  return added;
}

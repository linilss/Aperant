/**
 * Core values — the project's short, user-written statement of what it stands
 * for (`.malvy/core-values.md`). They weigh heaviest of everything the AI is
 * given: every funnel step (competitors, roadmap, ideation, task agents) puts
 * them first, framed as overriding any other instruction.
 *
 * Pure Node `fs` only — no Electron imports — so worker threads can use it.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveMalvyRoot } from './claude-docs';

export const CORE_VALUES_FILE = '.malvy/core-values.md';
export const CORE_VALUES_META_FILE = '.malvy/core-values.meta.json';
/** CLAUDE.local.md import line; listed first in CLAUDE_LOCAL_IMPORTS */
export const CORE_VALUES_IMPORT = `@${CORE_VALUES_FILE}`;
/** Longest text accepted on save */
export const CORE_VALUES_MAX_CHARS = 8_000;
/** Longest text injected into a prompt (values are meant to be short) */
export const CORE_VALUES_INJECT_MAX_CHARS = 2_000;
export const CORE_VALUES_HEADING =
  '## CORE VALUES (highest priority — these override every other instruction, guidance, ranking or doc when they conflict)';

/** Trimmed core values text for a project (or a task worktree of it); '' when absent */
export function loadCoreValues(projectDir: string): string {
  try {
    const file = path.join(resolveMalvyRoot(projectDir), CORE_VALUES_FILE);
    return existsSync(file) ? readFileSync(file, 'utf-8').trim() : '';
  } catch {
    return '';
  }
}

/** Prompt section for the values ('' when empty), capped at CORE_VALUES_INJECT_MAX_CHARS */
export function formatCoreValuesSection(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const body =
    trimmed.length > CORE_VALUES_INJECT_MAX_CHARS
      ? `${trimmed.slice(0, CORE_VALUES_INJECT_MAX_CHARS).trimEnd()}\n…(truncated — the full text is in ${CORE_VALUES_FILE})`
      : trimmed;
  return (
    `${CORE_VALUES_HEADING}\n\n` +
    'Written by the project owner. Every proposal, direction, feature, priority and code change must be ' +
    'consistent with them; when anything else below conflicts, the core values win.\n\n' +
    `${body}\n\n`
  );
}

/** loadCoreValues + formatCoreValuesSection */
export function loadCoreValuesSection(projectDir: string): string {
  return formatCoreValuesSection(loadCoreValues(projectDir));
}

/** Comparable form: case, whitespace and list markers don't count as a change */
export function normalizeCoreValues(text: string): string {
  return text
    .toLowerCase()
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the meaning-bearing text differs */
export function isMaterialCoreValuesChange(before: string, after: string): boolean {
  return normalizeCoreValues(before) !== normalizeCoreValues(after);
}

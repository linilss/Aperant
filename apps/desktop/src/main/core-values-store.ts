/**
 * Read/save `.malvy/core-values.md` for the Context page.
 *
 * Saving also wires the file into Claude CLI (CLAUDE.local.md import, listed
 * first) and, when the text materially changed, flags the synthesized
 * competitor directions as stale so the Competitors page offers a re-synthesis.
 * Writes stay under `<project>/.malvy/` plus the CLAUDE.local.md import (invisible mode).
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CoreValues, SaveCoreValuesResult } from '../shared/types';
import { markDirectionsStale } from './ai/runners/competitors/persistence';
import { ensureClaudeLocalImports } from './claude-local';
import {
  CORE_VALUES_FILE,
  CORE_VALUES_MAX_CHARS,
  CORE_VALUES_META_FILE,
  isMaterialCoreValuesChange,
  loadCoreValues,
} from './core-values';

function readUpdatedAt(projectDir: string): string | null {
  try {
    const file = path.join(projectDir, CORE_VALUES_META_FILE);
    if (!existsSync(file)) return null;
    const meta = JSON.parse(readFileSync(file, 'utf-8')) as { updatedAt?: unknown };
    return typeof meta.updatedAt === 'string' ? meta.updatedAt : null;
  } catch {
    return null;
  }
}

/** Current values + when they were last saved */
export function readCoreValues(projectDir: string): CoreValues {
  const text = loadCoreValues(projectDir);
  return { text, updatedAt: text ? readUpdatedAt(projectDir) : null };
}

/**
 * Save (empty text removes the file). Idempotent for unchanged text: no stale flag,
 * `updatedAt` kept.
 */
export function saveCoreValues(projectDir: string, rawText: string, now: Date = new Date()): SaveCoreValuesResult {
  const text = (typeof rawText === 'string' ? rawText : '').replace(/\r\n/g, '\n').trim().slice(0, CORE_VALUES_MAX_CHARS);
  const previous = loadCoreValues(projectDir);
  const changed = text !== previous;
  const material = isMaterialCoreValuesChange(previous, text);

  const file = path.join(projectDir, CORE_VALUES_FILE);
  const metaFile = path.join(projectDir, CORE_VALUES_META_FILE);
  if (changed) {
    mkdirSync(path.dirname(file), { recursive: true });
    if (text) {
      writeFileSync(file, `${text}\n`, 'utf-8');
      writeFileSync(metaFile, JSON.stringify({ updatedAt: now.toISOString() }, null, 2), 'utf-8');
    } else {
      rmSync(file, { force: true });
      rmSync(metaFile, { force: true });
    }
  }

  try {
    ensureClaudeLocalImports(projectDir);
  } catch {
    // Non-fatal: the values are saved; CLI wiring is retried on the next save or docs apply
  }

  let directionsMarkedStale = false;
  if (material) {
    try {
      directionsMarkedStale = markDirectionsStale(projectDir);
    } catch {
      // Non-fatal: the user can still re-synthesize manually
    }
  }

  return { values: readCoreValues(projectDir), directionsMarkedStale };
}

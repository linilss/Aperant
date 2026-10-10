/**
 * Persists the outcome of the last docs-optimizer run so it survives switching
 * project tabs or restarting the app: proposals waiting for review, or the error
 * if the run failed. Lives at `.malvy/docs/.pending.json` (Malvy-only, untracked).
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import type { PendingDocsRun } from '../shared/types/claude-docs';
import { MALVY_DOCS_DIR } from './claude-docs';

export const PENDING_FILE = '.pending.json';

export type { PendingDocsRun };

function pendingPath(projectPath: string): string {
  return path.join(projectPath, MALVY_DOCS_DIR, PENDING_FILE);
}

export function readPendingDocsRun(projectPath: string): PendingDocsRun | null {
  try {
    const raw = JSON.parse(readFileSync(pendingPath(projectPath), 'utf-8')) as Partial<PendingDocsRun>;
    if (!Array.isArray(raw.proposals)) return null;
    return {
      finishedAt: typeof raw.finishedAt === 'string' ? raw.finishedAt : new Date(0).toISOString(),
      proposals: raw.proposals,
      projectSummary: raw.projectSummary ?? null,
      ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
    };
  } catch {
    return null;
  }
}

export function writePendingDocsRun(projectPath: string, run: Omit<PendingDocsRun, 'finishedAt'>): void {
  const file = pendingPath(projectPath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ finishedAt: new Date().toISOString(), ...run }, null, 2), 'utf-8');
}

export function clearPendingDocsRun(projectPath: string): void {
  rmSync(pendingPath(projectPath), { force: true });
}

/** Drop proposals that were applied; removes the file once nothing is left to review. */
export function removeAppliedFromPending(projectPath: string, appliedPaths: string[]): void {
  const pending = readPendingDocsRun(projectPath);
  if (!pending) return;
  const applied = new Set(appliedPaths);
  const remaining = pending.proposals.filter((p) => !applied.has(p.path));
  if (remaining.length === 0) {
    clearPendingDocsRun(projectPath);
  } else {
    writePendingDocsRun(projectPath, { ...pending, proposals: remaining });
  }
}

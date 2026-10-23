/**
 * Merges running per project right now: shown on project tabs, and written to
 * userData/MERGING (total count) so the safe-restart script waits for them.
 */

import { unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

export const MERGING_FILE = 'MERGING';

const merges = new Map<string, number>();

function writeMarker(): void {
  try {
    const file = path.join(app.getPath('userData'), MERGING_FILE);
    const total = [...merges.values()].reduce((a, b) => a + b, 0);
    if (total > 0) writeFileSync(file, String(total));
    else unlinkSync(file);
  } catch {
    // best effort (missing file on unlink, no userData in tests)
  }
}

/** Count a merge as running; call the returned function when it ends */
export function beginMerge(projectId: string): () => void {
  merges.set(projectId, (merges.get(projectId) ?? 0) + 1);
  writeMarker();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const left = (merges.get(projectId) ?? 1) - 1;
    if (left > 0) merges.set(projectId, left);
    else merges.delete(projectId);
    writeMarker();
  };
}

export function activeMergeCount(projectId: string): number {
  return merges.get(projectId) ?? 0;
}

/** A merge that Malvy was killed in the middle of leaves the marker behind */
export function clearMergeMarker(): void {
  merges.clear();
  writeMarker();
}

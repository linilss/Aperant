/**
 * Safe stop: stop a running build between subtasks instead of killing it mid-edit.
 * Main writes a SAFE_STOP marker in the task's spec dirs; the subtask iterator
 * consumes it before starting the next subtask and ends the build; the exit
 * handler then treats that exit as a user stop.
 */

import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { SAFE_STOPPED_FILE, SAFE_STOP_FILE } from './ai/orchestration/pause-handler';

const pending = new Map<string, string[]>();

/** Ask the task's build to stop before its next subtask */
export function requestSafeStop(taskId: string, specDirs: string[]): void {
  const dirs = specDirs.filter((dir) => existsSync(dir));
  for (const dir of dirs) writeFileSync(path.join(dir, SAFE_STOP_FILE), new Date().toISOString(), 'utf-8');
  pending.set(taskId, dirs);
}

export function isSafeStopPending(taskId: string): boolean {
  return pending.has(taskId);
}

/**
 * Forget a pending safe stop and remove its markers. `consumed` is true when the
 * build saw a marker (and removed it), i.e. it stopped because of the request.
 */
export function takeSafeStop(taskId: string): { pending: boolean; consumed: boolean } {
  const dirs = pending.get(taskId);
  if (!dirs) return { pending: false, consumed: false };
  pending.delete(taskId);
  let left = 0;
  for (const dir of dirs) {
    const file = path.join(dir, SAFE_STOP_FILE);
    if (!existsSync(file)) continue;
    left++;
    try {
      unlinkSync(file);
    } catch {
      // best effort
    }
  }
  return { pending: true, consumed: left < dirs.length };
}

/**
 * True when the build left SAFE_STOPPED in the task's main spec dir (a safe stop
 * requested from the app or by a safe restart); the marker is removed.
 */
export function consumeSafeStoppedMarker(mainSpecDir: string): boolean {
  const file = path.join(mainSpecDir, SAFE_STOPPED_FILE);
  if (!existsSync(file)) return false;
  try {
    unlinkSync(file);
  } catch {
    // best effort
  }
  return true;
}

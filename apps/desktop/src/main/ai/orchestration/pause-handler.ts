/**
 * Pause Handler
 * =============
 *
 * Handles rate-limit and authentication pause/resume signalling via
 * filesystem sentinel files.
 *
 * The build orchestrator creates a pause
 * file when it hits a rate limit or auth failure. The frontend removes this
 * file (or creates a RESUME file) to signal that execution can continue.
 */

import { existsSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// =============================================================================
// Constants
// =============================================================================

/** Created in specDir when the provider returns HTTP 429. */
export const RATE_LIMIT_PAUSE_FILE = 'RATE_LIMIT_PAUSE';

/** Created in specDir when the provider returns HTTP 401. */
export const AUTH_FAILURE_PAUSE_FILE = 'AUTH_PAUSE';

/** Created by the frontend UI to signal that the user wants to resume. */
export const RESUME_FILE = 'RESUME';

/** Written by main for a "safe stop": the build stops before its next subtask */
export const SAFE_STOP_FILE = 'SAFE_STOP';

/** Left by the build when it stopped for a safe stop, so main treats the exit as a user stop */
export const SAFE_STOPPED_FILE = 'SAFE_STOPPED';

/**
 * True (and the marker removed) when a safe stop was requested in either spec dir.
 * Leaves SAFE_STOPPED in both dirs as proof for the exit handler.
 */
export function consumeSafeStop(specDir: string, sourceSpecDir?: string): boolean {
  const dirs = [specDir, sourceSpecDir].filter((d): d is string => !!d);
  let requested = false;
  for (const dir of dirs) {
    const file = join(dir, SAFE_STOP_FILE);
    if (existsSync(file)) {
      requested = true;
      try { unlinkSync(file); } catch { /* ignore */ }
    }
  }
  if (requested) {
    for (const dir of dirs) {
      try { writeFileSync(join(dir, SAFE_STOPPED_FILE), new Date().toISOString(), 'utf8'); } catch { /* ignore */ }
    }
  }
  return requested;
}

/** Maximum time to wait for rate-limit reset (2 hours). */
/** Longest a known reset time is waited for (a weekly limit can be days away) */
const MAX_RATE_LIMIT_WAIT_MS = 8 * 24 * 60 * 60 * 1000;

/** Interval for polling RESUME file during rate-limit wait (30 s). */
const RATE_LIMIT_CHECK_INTERVAL_MS = 30_000;

/** Interval for polling during auth-failure wait (10 s). */
const AUTH_RESUME_CHECK_INTERVAL_MS = 10_000;

/** Maximum time to wait for user to re-authenticate (24 hours). */
const AUTH_RESUME_MAX_WAIT_MS = 86_400_000;

// =============================================================================
// Types
// =============================================================================

/** Data written to RATE_LIMIT_PAUSE file. */
export interface RateLimitPauseData {
  pausedAt: string;
  resetTimestamp: string | null;
  error: string;
}

/** Data written to AUTH_FAILURE_PAUSE file. */
export interface AuthPauseData {
  pausedAt: string;
  error: string;
  requiresAction: 're-authenticate';
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Check if a RESUME file exists at either the primary or fallback location.
 * If found, deletes the RESUME file and the associated pause file.
 *
 * @returns true if a RESUME file was found (early resume requested).
 */
function checkAndClearResumeFile(
  resumeFile: string,
  pauseFile: string,
  fallbackResumeFile?: string,
): boolean {
  let found = existsSync(resumeFile);

  if (!found && fallbackResumeFile && existsSync(fallbackResumeFile)) {
    found = true;
    try { unlinkSync(fallbackResumeFile); } catch { /* ignore */ }
  }

  if (found) {
    try { unlinkSync(resumeFile); } catch { /* ignore */ }
    try { unlinkSync(pauseFile); } catch { /* ignore */ }
  }

  return found;
}

/**
 * Promise-based delay that resolves when either the timeout expires
 * or the abort signal fires.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) { resolve(); return; }

    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

// =============================================================================
// Pause file creation
// =============================================================================

/**
 * Write a RATE_LIMIT_PAUSE sentinel file to the spec directory.
 * The frontend reads this file to show a countdown UI.
 */
export function writeRateLimitPauseFile(
  specDir: string,
  error: string,
  resetTimestamp: string | null,
): void {
  const data: RateLimitPauseData = {
    pausedAt: new Date().toISOString(),
    resetTimestamp,
    error,
  };
  writeFileSync(join(specDir, RATE_LIMIT_PAUSE_FILE), JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Write an AUTH_FAILURE_PAUSE sentinel file to the spec directory.
 * The frontend reads this file to show a re-authentication prompt.
 */
export function writeAuthPauseFile(specDir: string, error: string): void {
  const data: AuthPauseData = {
    pausedAt: new Date().toISOString(),
    error,
    requiresAction: 're-authenticate',
  };
  writeFileSync(join(specDir, AUTH_FAILURE_PAUSE_FILE), JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Read and parse the contents of a pause file.
 * Returns null if the file does not exist or cannot be parsed.
 */
export function readPauseFile(specDir: string, fileName: string): Record<string, unknown> | null {
  const filePath = join(specDir, fileName);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Remove a pause file if it exists (cleanup).
 */
export function removePauseFile(specDir: string, fileName: string): void {
  const filePath = join(specDir, fileName);
  try { if (existsSync(filePath)) unlinkSync(filePath); } catch { /* ignore */ }
}

// =============================================================================
// Wait functions
// =============================================================================

/**
 * Wait for a rate-limit reset, polling for an early RESUME signal.
 *
 * Mirrors Python `wait_for_rate_limit_reset()` in coder.py.
 *
 * @param specDir        Spec directory that holds the pause/resume files.
 * @param waitMs         Maximum milliseconds to wait.
 * @param sourceSpecDir  Optional fallback dir to also check for RESUME file.
 * @param signal         AbortSignal for cancellation.
 * @returns true if the user signalled an early resume, false if we waited out the full duration.
 */
export async function waitForRateLimitResume(
  specDir: string,
  waitMs: number,
  sourceSpecDir?: string,
  signal?: AbortSignal,
): Promise<boolean> {
  // Cap at maximum
  const effectiveWait = Math.min(waitMs, MAX_RATE_LIMIT_WAIT_MS);

  const resumeFile = join(specDir, RESUME_FILE);
  const pauseFile = join(specDir, RATE_LIMIT_PAUSE_FILE);
  const fallbackResume = sourceSpecDir ? join(sourceSpecDir, RESUME_FILE) : undefined;

  const deadline = Date.now() + effectiveWait;

  while (Date.now() < deadline) {
    if (signal?.aborted) break;

    if (checkAndClearResumeFile(resumeFile, pauseFile, fallbackResume)) {
      return true;
    }
    // A safe stop (or safe restart) must not wait out a long limit: the loop stops right after this
    if (existsSync(join(specDir, SAFE_STOP_FILE)) || (sourceSpecDir && existsSync(join(sourceSpecDir, SAFE_STOP_FILE)))) {
      break;
    }

    const remaining = deadline - Date.now();
    const interval = Math.min(RATE_LIMIT_CHECK_INTERVAL_MS, remaining);
    if (interval <= 0) break;
    await sleep(interval, signal);
  }

  // Clean up pause file after wait completes
  removePauseFile(specDir, RATE_LIMIT_PAUSE_FILE);
  return false;
}

/**
 * Wait for the user to complete re-authentication.
 *
 * Mirrors Python `wait_for_auth_resume()` in coder.py.
 *
 * Blocks until:
 * - A RESUME file appears (user completed re-auth in UI)
 * - The AUTH_PAUSE file is deleted externally (alternative signal)
 * - The maximum wait timeout (24 h) is reached
 *
 * @param specDir        Spec directory that holds the pause/resume files.
 * @param sourceSpecDir  Optional fallback dir to also check for RESUME file.
 * @param signal         AbortSignal for cancellation.
 */
export async function waitForAuthResume(
  specDir: string,
  sourceSpecDir?: string,
  signal?: AbortSignal,
): Promise<void> {
  const resumeFile = join(specDir, RESUME_FILE);
  const pauseFile = join(specDir, AUTH_FAILURE_PAUSE_FILE);
  const fallbackResume = sourceSpecDir ? join(sourceSpecDir, RESUME_FILE) : undefined;

  const deadline = Date.now() + AUTH_RESUME_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    if (signal?.aborted) break;

    // Check for explicit RESUME file
    if (checkAndClearResumeFile(resumeFile, pauseFile, fallbackResume)) {
      return;
    }

    // Check if pause file was deleted externally (alternative resume signal)
    if (!existsSync(pauseFile)) {
      // Also clean up resume file if it exists
      try { if (existsSync(resumeFile)) unlinkSync(resumeFile); } catch { /* ignore */ }
      return;
    }

    await sleep(AUTH_RESUME_CHECK_INTERVAL_MS, signal);
  }

  // Timeout reached — clean up and return so the build can continue / fail
  removePauseFile(specDir, AUTH_FAILURE_PAUSE_FILE);
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * When a usage limit resets, read from the limit message: an epoch after "|"
 * ("usage limit reached|1760000000"), an ISO time, or the CLI's
 * "resets 3pm" / "resets Mon 9:30am" (next occurrence, local time). Null when unknown.
 */
export function parseLimitReset(message: string, now: Date = new Date()): Date | null {
  const epoch = message.match(/\|(\d{10,13})\b/);
  if (epoch) {
    const n = Number(epoch[1]);
    const at = new Date(epoch[1].length === 13 ? n : n * 1000);
    if (at > now) return at;
  }
  const iso = message.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})/);
  if (iso) {
    const at = new Date(iso[0]);
    if (!Number.isNaN(at.getTime()) && at > now) return at;
  }
  const m = message.toLowerCase().match(/resets?\s+(?:at\s+)?(?:(sun|mon|tue|wed|thu|fri|sat)\w*\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (!m) return null;
  let hour = Number(m[2]) % 12;
  if (m[4] === 'pm') hour += 12;
  const at = new Date(now);
  at.setHours(hour, Number(m[3] ?? 0), 0, 0);
  if (m[1]) {
    const days = (WEEKDAYS.indexOf(m[1]) - at.getDay() + 7) % 7;
    at.setDate(at.getDate() + days);
    if (at <= now) at.setDate(at.getDate() + 7);
  } else if (at <= now) {
    at.setDate(at.getDate() + 1);
  }
  return at;
}

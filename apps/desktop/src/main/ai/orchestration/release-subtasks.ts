/**
 * Release-step sanitizer for implementation plans.
 *
 * Planners sometimes add subtasks like "./deploy.sh then scripts/smoke-prod.sh" or
 * "Commit and push to main". Agents never release (see security/release-guard.ts), so
 * such subtasks are closed before coding with a reason, instead of blocking completion.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { isReleaseStepText } from '../security/release-guard';
import { safeParseJson } from '../../utils/json-repair';

export const RELEASE_SKIP_REASON = 'Release is done by the user via Deploy';

interface SanitizableSubtask {
  id?: string;
  title?: string;
  description?: string;
  status?: string;
  skipped?: boolean;
  skip_reason?: string;
}

interface SanitizablePlan {
  phases?: { subtasks?: SanitizableSubtask[] }[];
}

/** True when the subtask's title or description is a release step. */
export function isReleaseSubtask(subtask: Pick<SanitizableSubtask, 'title' | 'description'>): boolean {
  return [subtask.title, subtask.description].some((text) => typeof text === 'string' && isReleaseStepText(text));
}

/**
 * Marks open release subtasks as skipped (status `completed` + `skipped` + `skip_reason`,
 * so progress and completion checks treat them as done). Mutates `plan`; returns the
 * ids of the subtasks it changed.
 */
export function skipReleaseSubtasks(plan: SanitizablePlan): string[] {
  const skipped: string[] = [];
  for (const phase of plan.phases ?? []) {
    for (const subtask of phase.subtasks ?? []) {
      if (subtask.status === 'completed' || !isReleaseSubtask(subtask)) continue;
      subtask.status = 'completed';
      subtask.skipped = true;
      subtask.skip_reason = RELEASE_SKIP_REASON;
      skipped.push(subtask.id ?? subtask.title ?? '?');
    }
  }
  return skipped;
}

/** Applies skipReleaseSubtasks() to an implementation_plan.json file. Non-fatal. */
export async function skipReleaseSubtasksInFile(planPath: string): Promise<string[]> {
  try {
    const plan = safeParseJson<SanitizablePlan>(await readFile(planPath, 'utf-8'));
    if (!plan) return [];
    const skipped = skipReleaseSubtasks(plan);
    if (skipped.length > 0) {
      await writeFile(planPath, JSON.stringify(plan, null, 2));
    }
    return skipped;
  } catch {
    return [];
  }
}

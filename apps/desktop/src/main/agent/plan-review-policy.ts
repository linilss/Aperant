/**
 * Plan review policy: decides whether a finished spec/plan waits for human
 * approval (plan_review) before coding starts.
 *
 * - The per-task option (TaskMetadata.requireReviewBeforeCoding) wins when set.
 * - Otherwise complex tasks (complexity_assessment.json → "complex") need approval;
 *   simple/standard tasks, or tasks without an assessment, auto-approve.
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';

import { ComplexityAssessmentSchema } from '../ai/schema/complexity-assessment';
import { safeParseJson } from '../utils/json-repair';

export type ComplexityTier = 'simple' | 'standard' | 'complex';

/** Read the assessed complexity tier from `<specDir>/complexity_assessment.json`. */
export function readAssessedComplexity(specDir: string): ComplexityTier | null {
  const assessmentPath = path.join(specDir, 'complexity_assessment.json');
  if (!existsSync(assessmentPath)) return null;
  try {
    const raw = safeParseJson<unknown>(readFileSync(assessmentPath, 'utf-8'));
    const parsed = ComplexityAssessmentSchema.safeParse(raw);
    return parsed.success ? parsed.data.complexity : null;
  } catch {
    return null;
  }
}

/** Whether the plan must be approved by a human before coding starts. */
export function shouldRequirePlanReview(
  explicitSetting: boolean | undefined,
  complexity: ComplexityTier | null,
): boolean {
  if (typeof explicitSetting === 'boolean') return explicitSetting;
  return complexity === 'complex';
}

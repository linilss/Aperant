/**
 * Plan-funnel progress for a project: which of the six steps (core values →
 * context → design → competitors → roadmap → ideation) have produced their
 * output under `<project>/.malvy/`.
 *
 * Cheap by design — existsSync and small file reads only (no AI, no git), so
 * the renderer can poll it for every open project tab. A malformed or
 * unreadable file counts as "not done" for its step.
 *
 * Pure Node `fs` only — no Electron imports.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { AUTO_BUILD_PATHS } from '../shared/constants/config';
import { FUNNEL_STEP_IDS, type FunnelProgress, type FunnelStep, type FunnelStepId } from '../shared/types/funnel';
import { loadCoreValues } from './core-values';
import { readDocsMeta, readProjectSummary } from './claude-docs';
import { DESIGN_INDEX_FILE, DESIGN_SNAPSHOT_DIR, detectDesignSystem, readDesignConfig } from './design-system';
import { loadCompetitorState } from './ai/runners/competitors/persistence';

type StepResult = Omit<FunnelStep, 'id'>;

function readJsonObject(file: string): Record<string, unknown> | null {
  try {
    if (!existsSync(file)) return null;
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function hasEntries(dir: string): boolean {
  try {
    return statSync(dir).isDirectory() && readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

function isDesignSourceDir(abs: string): boolean {
  return existsSync(path.join(abs, 'tokens.json')) || existsSync(path.join(abs, DESIGN_INDEX_FILE));
}

/** 1. `.malvy/core-values.md` has text */
function coreValuesStep(projectPath: string): StepResult {
  return { done: loadCoreValues(projectPath).length > 0 };
}

/** 2. Docs were optimized (`.malvy/docs/.meta.json` lastOptimizedAt) or a project summary exists */
function contextStep(projectPath: string): StepResult {
  const { lastOptimizedAt } = readDocsMeta(projectPath);
  if (lastOptimizedAt) return { done: true, detail: lastOptimizedAt };
  return { done: readProjectSummary(projectPath) !== null };
}

/**
 * 3. A design system with content: a synced snapshot (`.malvy/design-system/`), a
 * source folder holding tokens.json / design-system.json, or an artifact link with
 * detected token files.
 */
function designStep(projectPath: string): StepResult {
  if (hasEntries(path.join(projectPath, DESIGN_SNAPSHOT_DIR))) return { done: true };
  const detection = detectDesignSystem(projectPath, readDesignConfig(projectPath));
  const detail = detection.name ?? undefined;
  if (detection.sourceDir && isDesignSourceDir(path.join(projectPath, detection.sourceDir))) {
    return { done: true, detail };
  }
  return { done: Boolean(detection.artifactUrl && detection.tokenFiles.length > 0), detail };
}

/** 4. At least one analyzed competitor and a saved direction ranking */
function competitorsStep(projectPath: string): StepResult {
  const state = loadCompetitorState(projectPath);
  if (!state) return { done: false };
  const analyzed = state.competitors.filter((c) => c.analyzed && c.status === 'done').length;
  return { done: analyzed > 0 && Boolean(state.rankingSavedAt), detail: String(analyzed) };
}

function countArray(file: string, key: string): number {
  const raw = readJsonObject(file);
  const list = raw?.[key];
  return Array.isArray(list) ? list.length : 0;
}

/** 5. `.malvy/roadmap/roadmap.json` has a feature */
function roadmapStep(projectPath: string): StepResult {
  const count = countArray(path.join(projectPath, AUTO_BUILD_PATHS.ROADMAP_DIR, AUTO_BUILD_PATHS.ROADMAP_FILE), 'features');
  return { done: count > 0, detail: String(count) };
}

/** 6. `.malvy/ideation/ideation.json` has an idea */
function ideationStep(projectPath: string): StepResult {
  const count = countArray(path.join(projectPath, AUTO_BUILD_PATHS.IDEATION_DIR, AUTO_BUILD_PATHS.IDEATION_FILE), 'ideas');
  return { done: count > 0, detail: String(count) };
}

const STEP_CHECKS: Record<FunnelStepId, (projectPath: string) => StepResult> = {
  coreValues: coreValuesStep,
  context: contextStep,
  design: designStep,
  competitors: competitorsStep,
  roadmap: roadmapStep,
  ideation: ideationStep,
};

export function getFunnelProgress(projectPath: string): FunnelProgress {
  const steps: FunnelStep[] = FUNNEL_STEP_IDS.map((id) => {
    try {
      const { done, detail } = STEP_CHECKS[id](projectPath);
      return detail === undefined ? { id, done } : { id, done, detail };
    } catch {
      return { id, done: false };
    }
  });
  return { steps, completed: steps.filter((s) => s.done).length, total: steps.length };
}

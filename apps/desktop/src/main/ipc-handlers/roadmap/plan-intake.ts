/**
 * Planning intake: a roadmap feature moved to Planned is proofread by an agent
 * (still relevant? gaps filled?), then turned into a backlog task and moved to
 * In Progress. Obsolete features go back to Under Review with the reason.
 *
 * Runs in main, so it finishes when the window closes. Progress goes out on the
 * quick-refine events (STARTED → REFINED / FAILED), which already drive the
 * card spinner and store patch.
 */

import path from 'node:path';

import { AUTO_BUILD_PATHS, IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult, RoadmapFeatureStatus, Task } from '../../../shared/types';
import type { FeatureProofread, FeatureProofreadInput } from '../../ai/runners/roadmap-feature-proofread';
import { readFileWithRetry, writeFileWithRetry } from '../../utils/atomic-file';
import { withFileLock } from '../../utils/file-lock';
import { featureFromSnakeCase } from './feature-persistence';
import { createKeyedLimiter, type KeyedLimiter } from './refine-queue';

/** Proofreads per project at once; the rest wait their turn */
export const MAX_CONCURRENT_INTAKES_PER_PROJECT = 2;

type RawRoadmap = { features?: Array<Record<string, unknown>>; metadata?: Record<string, unknown> };

export interface PlanIntakeDeps {
  getProjectPath: (projectId: string) => string | null;
  runProofread: (input: FeatureProofreadInput) => Promise<FeatureProofread>;
  resolveModelId: () => string;
  convert: (projectId: string, featureId: string, status: RoadmapFeatureStatus) => Promise<IPCResult<Task>>;
  emit: (channel: string, ...args: unknown[]) => void;
  queue?: KeyedLimiter;
  now?: () => Date;
}

const roadmapPathOf = (projectDir: string) =>
  path.join(projectDir, AUTO_BUILD_PATHS.ROADMAP_DIR, AUTO_BUILD_PATHS.ROADMAP_FILE);

async function readRoadmap(file: string): Promise<RawRoadmap> {
  return JSON.parse((await readFileWithRetry(file, { encoding: 'utf-8' })) as string) as RawRoadmap;
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Features a save moves into Planned without a task yet */
export function newlyPlannedFeatureIds(
  existing: Array<Record<string, unknown>>,
  incoming: Array<Record<string, unknown>>
): string[] {
  const before = new Map(existing.map((f) => [f.id, f.status]));
  return incoming
    .filter((f) => f.status === 'planned' && !f.linked_spec_id && before.has(f.id) && before.get(f.id) !== 'planned')
    .map((f) => String(f.id));
}

/** Apply a proofread to a raw feature (mutates it) */
export function applyProofread(feature: Record<string, unknown>, result: FeatureProofread, at: string): void {
  feature.intake_at = at;
  if (result.verdict === 'obsolete') {
    feature.status = 'under_review';
    feature.proofread_note = `Not planned: ${result.note}`;
    return;
  }
  if (result.title) feature.title = result.title;
  if (result.description) feature.description = result.description;
  if (result.rationale) feature.rationale = result.rationale;
  if (result.acceptanceCriteria.length > 0) feature.acceptance_criteria = result.acceptanceCriteria;
  if (result.userStories.length > 0) feature.user_stories = result.userStories;
  feature.proofread_note = result.note || 'Proofread before planning';
}

export function createPlanIntake(deps: PlanIntakeDeps) {
  const queue = deps.queue ?? createKeyedLimiter(MAX_CONCURRENT_INTAKES_PER_PROJECT);
  const inFlight = new Set<string>();
  const stamp = () => (deps.now?.() ?? new Date()).toISOString();

  /** Patch one raw feature under the file lock; returns it, or null when it's gone */
  async function patch(roadmapPath: string, featureId: string, mutate: (f: Record<string, unknown>) => void) {
    return withFileLock(roadmapPath, async () => {
      const roadmap = await readRoadmap(roadmapPath);
      const feature = roadmap.features?.find((f) => f.id === featureId);
      if (!feature) return null;
      mutate(feature);
      roadmap.metadata = { ...(roadmap.metadata ?? {}), updated_at: stamp() };
      await writeFileWithRetry(roadmapPath, JSON.stringify(roadmap, null, 2), { encoding: 'utf-8' });
      return feature;
    });
  }

  async function run(projectId: string, featureId: string): Promise<void> {
    const key = `${projectId}:${featureId}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    const projectDir = deps.getProjectPath(projectId);
    const roadmapPath = projectDir ? roadmapPathOf(projectDir) : '';
    const failed = (error: string) => deps.emit(IPC_CHANNELS.ROADMAP_FEATURE_REFINE_FAILED, projectId, featureId, error);
    const refined = (raw: Record<string, unknown> | null) =>
      raw ? deps.emit(IPC_CHANNELS.ROADMAP_FEATURE_REFINED, projectId, featureFromSnakeCase(raw)) : failed('Feature not found');

    try {
      if (!projectDir) return;
      const start = (await readRoadmap(roadmapPath)).features?.find((f) => f.id === featureId);
      if (!start || start.status !== 'planned' || start.linked_spec_id) return;
      deps.emit(IPC_CHANNELS.ROADMAP_FEATURE_REFINE_STARTED, projectId, featureId);

      await queue.run(projectId, async () => {
        let result: FeatureProofread;
        try {
          result = await deps.runProofread({
            projectDir,
            feature: {
              title: String(start.title ?? ''),
              description: String(start.description ?? ''),
              rationale: String(start.rationale ?? ''),
              acceptanceCriteria: strings(start.acceptance_criteria),
              userStories: strings(start.user_stories),
            },
            modelId: deps.resolveModelId(),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Proofread failed';
          refined(await patch(roadmapPath, featureId, (f) => {
            f.proofread_note = `Proofread failed: ${message}. Move it to Planned again to retry.`;
            f.intake_at = stamp();
          }));
          return;
        }

        // The user may have moved it on (or built it) while the agent ran
        let skipped = false;
        const proofread = await patch(roadmapPath, featureId, (f) => {
          if (f.status !== 'planned' || f.linked_spec_id) {
            skipped = true;
            return;
          }
          applyProofread(f, result, stamp());
        });
        if (!proofread || skipped || result.verdict === 'obsolete') {
          if (skipped) failed('Feature moved during proofread');
          else refined(proofread);
          return;
        }

        const converted = await deps.convert(projectId, featureId, 'in_progress');
        if (!converted.success) {
          refined(await patch(roadmapPath, featureId, (f) => {
            f.proofread_note = `Couldn't create the task: ${converted.error ?? 'unknown error'}`;
            f.intake_at = stamp();
          }));
          return;
        }
        // Stamp again so a stale renderer save can't undo the status/link the conversion wrote
        refined(await patch(roadmapPath, featureId, (f) => {
          f.intake_at = stamp();
        }));
        if (converted.data) deps.emit(IPC_CHANNELS.TASK_REFINE_APPLIED, converted.data.specId, projectId);
      });
    } catch (error) {
      failed(error instanceof Error ? error.message : 'Planning intake failed');
    } finally {
      inFlight.delete(key);
    }
  }

  return { run };
}

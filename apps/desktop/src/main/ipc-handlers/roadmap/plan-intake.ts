/**
 * Planning intake: a roadmap feature moved to Planned is proofread by an agent
 * (still relevant? gaps filled? too big? overlapping?), then turned into a
 * backlog task and moved to In Progress. Too-big features are split into parts
 * (each gets its own task, in build order); obsolete ones go back to Under
 * Review with the reason.
 *
 * Runs in main, so it finishes when the window closes. Progress goes out on the
 * quick-refine events (STARTED → REFINED / FAILED), which already drive the
 * card spinner and store patch; a REFINED for a feature the renderer doesn't
 * have yet (a split part) makes it reload the roadmap.
 */

import path from 'node:path';

import { AUTO_BUILD_PATHS, IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult, RoadmapFeatureStatus, Task } from '../../../shared/types';
import type {
  FeatureProofread,
  FeatureProofreadInput,
  FeatureProofreadPart,
} from '../../ai/runners/roadmap-feature-proofread';
import { readFileWithRetry, writeFileWithRetry } from '../../utils/atomic-file';
import { withFileLock } from '../../utils/file-lock';
import { featureFromSnakeCase } from './feature-persistence';
import { createKeyedLimiter, type KeyedLimiter } from './refine-queue';

/** Proofreads per project at once; the rest wait their turn */
export const MAX_CONCURRENT_INTAKES_PER_PROJECT = 2;
/** A save that doesn't list a split part this young hasn't loaded it yet (not a delete) */
export const SPLIT_PART_GRACE_MS = 2 * 60_000;

type RawFeature = Record<string, unknown>;
type RawRoadmap = { features?: RawFeature[]; metadata?: Record<string, unknown> };

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
export function newlyPlannedFeatureIds(existing: RawFeature[], incoming: RawFeature[]): string[] {
  const before = new Map(existing.map((f) => [f.id, f.status]));
  return incoming
    .filter((f) => f.status === 'planned' && !f.linked_spec_id && before.has(f.id) && before.get(f.id) !== 'planned')
    .map((f) => String(f.id));
}

/**
 * Split parts the saving renderer can't know about yet (created moments ago):
 * appended to `incoming` so the save doesn't drop them.
 */
export function keepFreshSplitParts(existing: RawFeature[], incoming: RawFeature[], now = Date.now()): void {
  const listed = new Set(incoming.map((f) => f.id));
  for (const f of existing) {
    if (listed.has(f.id) || !f.split_from || typeof f.intake_at !== 'string') continue;
    if (now - Date.parse(f.intake_at) < SPLIT_PART_GRACE_MS) incoming.push(f);
  }
}

function applyPart(feature: RawFeature, part: FeatureProofreadPart): void {
  if (part.title) feature.title = part.title;
  if (part.description) feature.description = part.description;
  if (part.acceptanceCriteria.length > 0) feature.acceptance_criteria = part.acceptanceCriteria;
  if (part.userStories.length > 0) feature.user_stories = part.userStories;
  if (part.relevantFiles.length > 0) feature.relevant_files = part.relevantFiles;
}

/**
 * Apply a proofread to the roadmap (mutates it). Returns the ids of new split
 * parts, in build order (each depends on the one before).
 */
export function applyProofread(roadmap: RawRoadmap, featureId: string, result: FeatureProofread, at: string): string[] {
  const features = roadmap.features ?? [];
  const feature = features.find((f) => f.id === featureId);
  if (!feature) return [];
  feature.intake_at = at;
  if (result.verdict === 'obsolete') {
    feature.status = 'under_review';
    feature.proofread_note = `Not planned: ${result.note}`;
    return [];
  }

  applyPart(feature, result);
  if (result.rationale) feature.rationale = result.rationale;
  const known = new Set(features.map((f) => f.id));
  const deps = result.dependsOn.filter((id) => id !== featureId && known.has(id));
  if (deps.length > 0) feature.dependencies = [...new Set([...strings(feature.dependencies), ...deps])];
  feature.proofread_note = [result.note || 'Proofread before planning', result.overlap].filter(Boolean).join(' ');

  const partIds: string[] = [];
  let previous = featureId;
  result.parts.forEach((part, i) => {
    let id = `${featureId}-part-${i + 2}`;
    while (known.has(id)) id = `${id}x`;
    known.add(id);
    const created: RawFeature = {
      id,
      title: part.title,
      description: part.description,
      rationale: String(feature.rationale ?? ''),
      priority: feature.priority,
      complexity: 'medium',
      impact: feature.impact,
      phase_id: feature.phase_id,
      dependencies: [previous],
      status: 'planned',
      acceptance_criteria: part.acceptanceCriteria,
      user_stories: part.userStories,
      relevant_files: part.relevantFiles,
      direction_ids: feature.direction_ids,
      source: { provider: 'internal' },
      split_from: featureId,
      proofread_note: `Part ${i + 2} of "${String(feature.title)}" (split by the planning proofread)`,
      intake_at: at,
    };
    features.push(created);
    partIds.push(id);
    previous = id;
  });
  if (partIds.length > 0) feature.proofread_note = `Split into ${partIds.length + 1} parts. ${feature.proofread_note}`;
  roadmap.features = features;
  return partIds;
}

export function createPlanIntake(deps: PlanIntakeDeps) {
  const queue = deps.queue ?? createKeyedLimiter(MAX_CONCURRENT_INTAKES_PER_PROJECT);
  const inFlight = new Set<string>();
  const stamp = () => (deps.now?.() ?? new Date()).toISOString();

  /** Mutate the roadmap under the file lock; returns the mutator's result, or null without a file */
  async function update<T>(roadmapPath: string, mutate: (roadmap: RawRoadmap) => T): Promise<T> {
    return withFileLock(roadmapPath, async () => {
      const roadmap = await readRoadmap(roadmapPath);
      const result = mutate(roadmap);
      roadmap.metadata = { ...(roadmap.metadata ?? {}), updated_at: stamp() };
      await writeFileWithRetry(roadmapPath, JSON.stringify(roadmap, null, 2), { encoding: 'utf-8' });
      return result;
    });
  }

  async function run(projectId: string, featureId: string): Promise<void> {
    const key = `${projectId}:${featureId}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    const projectDir = deps.getProjectPath(projectId);
    const roadmapPath = projectDir ? roadmapPathOf(projectDir) : '';
    const failed = (id: string, error: string) => deps.emit(IPC_CHANNELS.ROADMAP_FEATURE_REFINE_FAILED, projectId, id, error);

    /** Re-read one feature (stamping it, so a stale renderer save can't undo it) and send it out */
    const publish = async (id: string, mutate?: (f: RawFeature) => void) => {
      const raw = await update(roadmapPath, (roadmap) => {
        const f = roadmap.features?.find((x) => x.id === id);
        if (f) {
          mutate?.(f);
          f.intake_at = stamp();
        }
        return f ?? null;
      });
      if (raw) deps.emit(IPC_CHANNELS.ROADMAP_FEATURE_REFINED, projectId, featureFromSnakeCase(raw));
      else failed(id, 'Feature not found');
    };

    /** Create the task for one feature and move it to In Progress */
    const convert = async (id: string) => {
      const converted = await deps.convert(projectId, id, 'in_progress');
      if (!converted.success) {
        await publish(id, (f) => {
          f.proofread_note = `Couldn't create the task: ${converted.error ?? 'unknown error'}`;
        });
        return;
      }
      await publish(id);
      if (converted.data) deps.emit(IPC_CHANNELS.TASK_REFINE_APPLIED, converted.data.specId, projectId);
    };

    try {
      if (!projectDir) return;
      const initial = await readRoadmap(roadmapPath);
      const start = initial.features?.find((f) => f.id === featureId);
      if (!start || start.status !== 'planned' || start.linked_spec_id) return;
      deps.emit(IPC_CHANNELS.ROADMAP_FEATURE_REFINE_STARTED, projectId, featureId);

      await queue.run(projectId, async () => {
        // Re-read: other features may have been planned while this waited
        const current = await readRoadmap(roadmapPath);
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
              isSplitPart: Boolean(start.split_from),
            },
            otherFeatures: (current.features ?? [])
              .filter((f) => f.id !== featureId && (f.status === 'planned' || f.status === 'in_progress'))
              .map((f) => ({ id: String(f.id), title: String(f.title ?? ''), status: String(f.status) })),
            modelId: deps.resolveModelId(),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Proofread failed';
          await publish(featureId, (f) => {
            f.proofread_note = `Proofread failed: ${message}. Move it to Planned again to retry.`;
          });
          return;
        }

        // The user may have moved it on (or built it) while the agent ran
        const outcome = await update(roadmapPath, (roadmap) => {
          const f = roadmap.features?.find((x) => x.id === featureId);
          if (!f || f.status !== 'planned' || f.linked_spec_id) return null;
          return { parts: applyProofread(roadmap, featureId, result, stamp()) };
        });
        if (!outcome) {
          failed(featureId, 'Feature moved during proofread');
          return;
        }
        if (result.verdict === 'obsolete') {
          await publish(featureId);
          return;
        }
        // Parts in build order: part 1 (this feature), then the new ones
        for (const id of [featureId, ...outcome.parts]) await convert(id);
      });
    } catch (error) {
      failed(featureId, error instanceof Error ? error.message : 'Planning intake failed');
    } finally {
      inFlight.delete(key);
    }
  }

  return { run };
}

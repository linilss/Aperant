/**
 * Background AI refinement of single roadmap features (quick add → proper feature).
 *
 * Each request snapshots the feature, waits for a slot in its project's queue
 * (max 2 concurrent CLI runs per project), runs the refiner, then patches
 * roadmap.json under the file lock and emits the result. Failures are non-fatal:
 * the feature stays as typed and a failure event is emitted.
 *
 * Electron-free (deps injected) so it can be unit tested.
 */

import path from 'node:path';

import { AUTO_BUILD_PATHS, IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult, RoadmapFeature, RoadmapFeatureRefineOptions } from '../../../shared/types';
import type { RoadmapFeatureRefineInput, RoadmapFeatureRefineOutput } from '../../ai/runners/roadmap-feature-refine';
import { readFileWithRetry, writeFileWithRetry } from '../../utils/atomic-file';
import { withFileLock } from '../../utils/file-lock';
import { applyFeatureRefinement, snapshotRawFeature } from './feature-persistence';
import { createKeyedLimiter, type KeyedLimiter } from './refine-queue';

export const MAX_CONCURRENT_REFINES_PER_PROJECT = 2;
const MAX_LINE_CHARS = 2_000;

type RawRoadmap = {
  features?: Array<Record<string, unknown>>;
  phases?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
};

export interface FeatureRefineServiceDeps {
  getProjectPath: (projectId: string) => string | null;
  runRefine: (input: RoadmapFeatureRefineInput) => Promise<RoadmapFeatureRefineOutput>;
  resolveModelId: () => string;
  loadKnownDirectionIds: (projectDir: string) => Set<string>;
  emit: (channel: string, ...args: unknown[]) => void;
  queue?: KeyedLimiter;
  now?: () => Date;
}

export interface FeatureRefineService {
  refineFeature: (
    projectId: string,
    featureId: string,
    line: string,
    options: RoadmapFeatureRefineOptions,
  ) => Promise<IPCResult<RoadmapFeature>>;
}

const roadmapPathOf = (projectDir: string) =>
  path.join(projectDir, AUTO_BUILD_PATHS.ROADMAP_DIR, AUTO_BUILD_PATHS.ROADMAP_FILE);

async function readRoadmap(file: string): Promise<RawRoadmap> {
  return JSON.parse((await readFileWithRetry(file, { encoding: 'utf-8' })) as string) as RawRoadmap;
}

export function createFeatureRefineService(deps: FeatureRefineServiceDeps): FeatureRefineService {
  const queue = deps.queue ?? createKeyedLimiter(MAX_CONCURRENT_REFINES_PER_PROJECT);
  const inFlight = new Set<string>();

  async function refineFeature(
    projectId: string,
    featureId: string,
    line: string,
    options: RoadmapFeatureRefineOptions,
  ): Promise<IPCResult<RoadmapFeature>> {
    const key = `${projectId}:${featureId}`;
    // A second request for a feature already being refined is dropped; the first one reports
    if (inFlight.has(key)) return { success: false, error: 'Already refining this feature' };
    inFlight.add(key);

    const fail = (error: string): IPCResult<RoadmapFeature> => {
      deps.emit(IPC_CHANNELS.ROADMAP_FEATURE_REFINE_FAILED, projectId, featureId, error);
      return { success: false, error };
    };

    try {
      const projectDir = deps.getProjectPath(projectId);
      if (!projectDir) return fail('Project not found');
      const roadmapPath = roadmapPathOf(projectDir);

      const initial = await readRoadmap(roadmapPath);
      const rawFeature = initial.features?.find((f) => f.id === featureId);
      if (!rawFeature) return fail('Feature not found');
      const snapshot = snapshotRawFeature(rawFeature);
      const idea = (line.trim() || snapshot.title).slice(0, MAX_LINE_CHARS);

      deps.emit(IPC_CHANNELS.ROADMAP_FEATURE_REFINE_STARTED, projectId, featureId);

      return await queue.run(projectId, async () => {
        // Re-read: features added while this waited count for duplicate detection
        const current = await readRoadmap(roadmapPath);
        const { refinement } = await deps.runRefine({
          projectDir,
          line: idea,
          existingFeatures: (current.features ?? [])
            .filter((f) => f.id !== featureId && typeof f.title === 'string')
            .map((f) => ({ id: String(f.id), title: String(f.title) })),
          phases: (current.phases ?? []).map((p) => ({
            id: String(p.id),
            name: String(p.name ?? ''),
            description: typeof p.description === 'string' ? p.description : undefined,
          })),
          suggestPriority: options.suggestPriority && !options.explicit,
          modelId: deps.resolveModelId(),
        });

        const knownDirectionIds = deps.loadKnownDirectionIds(projectDir);
        const patched = await withFileLock(roadmapPath, async () => {
          const roadmap = await readRoadmap(roadmapPath);
          const result = applyFeatureRefinement(roadmap, featureId, refinement, {
            // Explicit refines start from the title; quick adds from the typed line
            line: options.explicit ? snapshot.title : idea,
            snapshot,
            suggestPriority: options.suggestPriority,
            explicit: options.explicit,
            knownDirectionIds,
            now: deps.now?.(),
          });
          if (result.success) {
            await writeFileWithRetry(roadmapPath, JSON.stringify(roadmap, null, 2), { encoding: 'utf-8' });
          }
          return result;
        });
        if (!patched.success) return fail(patched.error);

        deps.emit(IPC_CHANNELS.ROADMAP_FEATURE_REFINED, projectId, patched.feature);
        return { success: true, data: patched.feature };
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Refinement failed');
    } finally {
      inFlight.delete(key);
    }
  }

  return { refineFeature };
}

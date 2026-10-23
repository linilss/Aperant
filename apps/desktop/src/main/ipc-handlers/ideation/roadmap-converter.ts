/**
 * "Add to roadmap": turn an ideation idea into a roadmap feature in roadmap.json
 * and link the idea back to it. The pure helpers are unit tested; the handler
 * does the locked file I/O.
 */

import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { IpcMainInvokeEvent } from 'electron';
import { AUTO_BUILD_PATHS } from '../../../shared/constants';
import type { IPCResult, RoadmapFeaturePriority } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { readFileWithRetry, writeFileWithRetry } from '../../utils/atomic-file';
import { withFileLock } from '../../utils/file-lock';
import { loadKnownDirectionIds } from '../../ai/runners/competitors/guidance';
import { readIdeationFile, updateIdeationTimestamp, writeIdeationFile } from './file-utils';
import type { RawIdea } from './types';

type RawRoadmap = Record<string, unknown> & {
  phases?: Array<Record<string, unknown>>;
  features?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
};

type Level = 'low' | 'medium' | 'high';

/** Id of the phase created when a roadmap has none */
export const BACKLOG_PHASE_ID = 'phase-backlog';

const str = (value: unknown): string => (typeof value === 'string' ? value.trim().toLowerCase() : '');

/**
 * Deterministic MoSCoW suggestion from the idea's urgency field
 * (severity, else impact, else priority): critical → must, high/major → should,
 * anything else (or nothing) → could.
 */
export function suggestRoadmapPriority(idea: RawIdea): RoadmapFeaturePriority {
  const level = str(idea.severity) || str(idea.impact) || str(idea.priority);
  if (level === 'critical') return 'must';
  if (level === 'high' || level === 'major') return 'should';
  return 'could';
}

function complexityFromEffort(idea: RawIdea): Level {
  // Feature ideas already use the roadmap's low/medium/high scale
  const complexity = str(idea.complexity);
  if (complexity === 'low' || complexity === 'medium' || complexity === 'high') return complexity;
  const effort = str(idea.estimated_effort ?? idea.estimatedEffort);
  if (effort === 'trivial' || effort === 'small') return 'low';
  if (effort === 'large' || effort === 'complex') return 'high';
  return 'medium';
}

function impactFromIdea(idea: RawIdea): Level {
  const level = str(idea.impact) || str(idea.severity) || str(idea.priority);
  if (level === 'critical' || level === 'high' || level === 'major') return 'high';
  if (level === 'low' || level === 'minor' || level === 'suggestion') return 'low';
  return 'medium';
}

/** Feature ideas: one story from target users + user value; [] otherwise */
function userStoriesFromIdea(idea: RawIdea): string[] {
  const value = (idea.user_value ?? idea.userValue ?? '').trim();
  if (!value) return [];
  const users = (idea.target_users ?? idea.targetUsers ?? '').trim();
  return [users ? `${users}: ${value}` : value];
}

/** Raw (snake_case) roadmap feature built from an idea */
export function buildFeatureFromIdea(
  idea: RawIdea,
  options: { featureId: string; phaseId: string; knownDirectionIds: ReadonlySet<string>; now: Date },
): Record<string, unknown> {
  const feature: Record<string, unknown> = {
    id: options.featureId,
    title: idea.title,
    description: idea.description || '',
    rationale: idea.rationale || '',
    priority: suggestRoadmapPriority(idea),
    complexity: complexityFromEffort(idea),
    impact: impactFromIdea(idea),
    phase_id: options.phaseId,
    dependencies: [],
    status: 'under_review',
    acceptance_criteria: [],
    user_stories: userStoriesFromIdea(idea),
    source: { provider: 'internal', imported_at: options.now.toISOString() },
    source_idea_id: idea.id,
  };
  const rawIds = idea.direction_ids ?? idea.directionIds;
  if (options.knownDirectionIds.size > 0 && Array.isArray(rawIds)) {
    feature.direction_ids = [
      ...new Set(rawIds.filter((id): id is string => typeof id === 'string' && options.knownDirectionIds.has(id))),
    ];
  }
  return feature;
}

/** Smallest roadmap.json the roadmap UI and later regeneration accept */
export function createMinimalRoadmap(projectName: string, now: Date): RawRoadmap {
  const iso = now.toISOString();
  return {
    id: `roadmap-${now.getTime()}`,
    project_name: projectName,
    version: '1.0',
    vision: '',
    target_audience: { primary: '', secondary: [] },
    phases: [],
    features: [],
    status: 'draft',
    metadata: { created_at: iso, updated_at: iso },
  };
}

function firstPhase(roadmap: RawRoadmap): Record<string, unknown> | undefined {
  const phases = Array.isArray(roadmap.phases) ? roadmap.phases : [];
  return [...phases].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))[0];
}

/**
 * Append the idea as a feature to a parsed roadmap.json (mutates it; every other
 * field is left as-is). Puts it in the first phase, creating a Backlog phase when
 * the roadmap has none. Returns the new feature.
 */
export function addIdeaToRoadmap(
  roadmap: RawRoadmap,
  idea: RawIdea,
  options: { knownDirectionIds: ReadonlySet<string>; now?: Date; featureId?: string },
): Record<string, unknown> {
  const now = options.now ?? new Date();
  if (!Array.isArray(roadmap.phases)) roadmap.phases = [];
  if (!Array.isArray(roadmap.features)) roadmap.features = [];

  let phase = firstPhase(roadmap);
  if (!phase) {
    phase = {
      id: BACKLOG_PHASE_ID,
      name: 'Backlog',
      description: '',
      order: 1,
      status: 'planned',
      features: [],
      milestones: [],
    };
    roadmap.phases.push(phase);
  }

  const feature = buildFeatureFromIdea(idea, {
    featureId: options.featureId ?? `feature-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    phaseId: String(phase.id),
    knownDirectionIds: options.knownDirectionIds,
    now,
  });
  roadmap.features.push(feature);
  if (Array.isArray(phase.features)) phase.features.push(feature.id);
  else phase.features = [feature.id];

  roadmap.metadata = roadmap.metadata || {};
  roadmap.metadata.updated_at = now.toISOString();
  return feature;
}

/** Mark the idea as moved to the roadmap (task conversion stays possible via linked_task_id) */
export function linkIdeaToFeature(idea: RawIdea, featureId: string): void {
  idea.status = 'converted';
  idea.roadmap_feature_id = featureId;
}

/**
 * IPC: add an idea to roadmap.json (creating a minimal roadmap if needed) and link it.
 */
export async function addIdeaToRoadmapHandler(
  _event: IpcMainInvokeEvent,
  projectId: string,
  ideaId: string,
): Promise<IPCResult<{ featureId: string }>> {
  const project = projectStore.getProject(projectId);
  if (!project) return { success: false, error: 'Project not found' };

  const ideationPath = path.join(project.path, AUTO_BUILD_PATHS.IDEATION_DIR, AUTO_BUILD_PATHS.IDEATION_FILE);
  const roadmapPath = path.join(project.path, AUTO_BUILD_PATHS.ROADMAP_DIR, AUTO_BUILD_PATHS.ROADMAP_FILE);

  try {
    return await withFileLock(roadmapPath, () =>
      withFileLock(ideationPath, async (): Promise<IPCResult<{ featureId: string }>> => {
        const ideation = readIdeationFile(ideationPath);
        const idea = ideation?.ideas?.find((i) => i.id === ideaId);
        if (!ideation || !idea) return { success: false, error: 'Idea not found' };

        // No roadmap yet: start a minimal one (regeneration later keeps internal features)
        const roadmap: RawRoadmap = existsSync(roadmapPath)
          ? JSON.parse((await readFileWithRetry(roadmapPath, { encoding: 'utf-8' })) as string)
          : createMinimalRoadmap(project.name, new Date());

        // Idempotent: already on the roadmap
        const existingId = idea.roadmap_feature_id;
        if (existingId && roadmap.features?.some((f) => f.id === existingId)) {
          return { success: true, data: { featureId: existingId } };
        }

        const feature = addIdeaToRoadmap(roadmap, idea, { knownDirectionIds: loadKnownDirectionIds(project.path) });
        mkdirSync(path.dirname(roadmapPath), { recursive: true });
        await writeFileWithRetry(roadmapPath, JSON.stringify(roadmap, null, 2), { encoding: 'utf-8' });

        linkIdeaToFeature(idea, String(feature.id));
        updateIdeationTimestamp(ideation);
        writeIdeationFile(ideationPath, ideation);

        return { success: true, data: { featureId: String(feature.id) } };
      }),
    );
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to add idea to roadmap' };
  }
}

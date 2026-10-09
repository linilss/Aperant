import type {
  FeatureSource,
  FeatureSourceProvider,
  RoadmapFeature,
  RoadmapFeaturePriority,
} from '../../../shared/types';

/**
 * Pure helpers for reading/writing roadmap features in roadmap.json (snake_case).
 * Kept free of Electron/fs so they can be unit tested.
 */

const VALID_PRIORITIES: readonly RoadmapFeaturePriority[] = ['must', 'should', 'could', 'wont'];

export function isRoadmapFeaturePriority(value: unknown): value is RoadmapFeaturePriority {
  return typeof value === 'string' && (VALID_PRIORITIES as readonly string[]).includes(value);
}

interface RawFeatureSource {
  provider?: string;
  imported_at?: string;
  last_synced_at?: string;
}

function toIsoString(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function sourceToSnakeCase(source: FeatureSource | undefined): RawFeatureSource | undefined {
  if (!source) return undefined;
  return {
    provider: source.provider,
    imported_at: toIsoString(source.importedAt),
    last_synced_at: toIsoString(source.lastSyncedAt),
  };
}

function sourceFromSnakeCase(raw: unknown): FeatureSource | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const src = raw as RawFeatureSource & { importedAt?: string; lastSyncedAt?: string };
  if (!src.provider) return undefined;
  const importedAt = src.imported_at ?? src.importedAt;
  const lastSyncedAt = src.last_synced_at ?? src.lastSyncedAt;
  return {
    provider: src.provider as FeatureSourceProvider,
    importedAt: importedAt ? new Date(importedAt) : undefined,
    lastSyncedAt: lastSyncedAt ? new Date(lastSyncedAt) : undefined,
  };
}

/**
 * Reads the external-integration fields of a raw (snake_case) feature.
 */
export function externalFieldsFromSnakeCase(
  raw: Record<string, unknown>
): Pick<RoadmapFeature, 'source' | 'externalId' | 'externalUrl' | 'votes'> {
  return {
    source: sourceFromSnakeCase(raw.source),
    externalId: (raw.external_id as string | undefined) ?? undefined,
    externalUrl: (raw.external_url as string | undefined) ?? undefined,
    votes: typeof raw.votes === 'number' ? raw.votes : undefined,
  };
}

/**
 * Reads `direction_ids` (or camelCase `directionIds`) tolerantly: non-arrays give
 * undefined (untagged roadmap), non-string entries are dropped.
 */
export function directionIdsFromRaw(raw: Record<string, unknown>): string[] | undefined {
  const value = raw.direction_ids ?? raw.directionIds;
  if (!Array.isArray(value)) return undefined;
  return value.filter((id): id is string => typeof id === 'string' && id.trim() !== '');
}

/**
 * Converts a renderer (camelCase) feature to the snake_case shape stored in roadmap.json.
 */
export function featureToSnakeCase(feature: RoadmapFeature): Record<string, unknown> {
  return {
    id: feature.id,
    title: feature.title,
    description: feature.description,
    rationale: feature.rationale || '',
    priority: feature.priority,
    complexity: feature.complexity,
    impact: feature.impact,
    phase_id: feature.phaseId,
    dependencies: feature.dependencies || [],
    status: feature.status,
    acceptance_criteria: feature.acceptanceCriteria || [],
    user_stories: feature.userStories || [],
    linked_spec_id: feature.linkedSpecId,
    task_outcome: feature.taskOutcome,
    previous_status: feature.previousStatus,
    competitor_insight_ids: feature.competitorInsightIds,
    direction_ids: feature.directionIds,
    source: sourceToSnakeCase(feature.source),
    external_id: feature.externalId,
    external_url: feature.externalUrl,
    votes: feature.votes,
  };
}

export type PatchResult = { success: true } | { success: false; error: string };

/**
 * Mutates a parsed roadmap.json object, setting only `priority` on one feature
 * and bumping metadata.updated_at. All other fields are left untouched.
 */
export function applyFeaturePriorityPatch(
  roadmap: { features?: Array<Record<string, unknown>>; metadata?: Record<string, unknown> },
  featureId: string,
  priority: RoadmapFeaturePriority,
  now: Date = new Date()
): PatchResult {
  if (!isRoadmapFeaturePriority(priority)) {
    return { success: false, error: 'Invalid priority' };
  }
  const feature = roadmap.features?.find((f) => f.id === featureId);
  if (!feature) {
    return { success: false, error: 'Feature not found' };
  }
  feature.priority = priority;
  roadmap.metadata = roadmap.metadata || {};
  roadmap.metadata.updated_at = now.toISOString();
  return { success: true };
}

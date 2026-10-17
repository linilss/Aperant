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
): Pick<RoadmapFeature, 'source' | 'externalId' | 'externalUrl' | 'votes' | 'sourceIdeaId'> {
  const sourceIdeaId = raw.source_idea_id ?? raw.sourceIdeaId;
  return {
    source: sourceFromSnakeCase(raw.source),
    externalId: (raw.external_id as string | undefined) ?? undefined,
    externalUrl: (raw.external_url as string | undefined) ?? undefined,
    votes: typeof raw.votes === 'number' ? raw.votes : undefined,
    sourceIdeaId: typeof sourceIdeaId === 'string' && sourceIdeaId ? sourceIdeaId : undefined,
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
    source_idea_id: feature.sourceIdeaId,
    refined_at: feature.refinedAt,
    duplicate_of: feature.duplicateOf,
    proofread_note: feature.proofreadNote,
    intake_at: feature.intakeAt,
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

/**
 * Converts a raw (snake_case) roadmap.json feature to the renderer (camelCase) shape.
 */
/** Planning-proofread fields (proofread_note / intake_at) in camelCase, omitted when unset */
export function intakeFieldsFromRaw(raw: Record<string, unknown>): Pick<RoadmapFeature, 'proofreadNote' | 'intakeAt'> {
  const note = raw.proofread_note ?? raw.proofreadNote;
  const at = raw.intake_at ?? raw.intakeAt;
  return {
    ...(typeof note === 'string' && note ? { proofreadNote: note } : {}),
    ...(typeof at === 'string' && at ? { intakeAt: at } : {}),
  };
}

export function featureFromSnakeCase(raw: Record<string, unknown>): RoadmapFeature {
  const duplicateOf = raw.duplicate_of ?? raw.duplicateOf;
  const refinedAt = raw.refined_at ?? raw.refinedAt;
  return {
    id: raw.id as string,
    title: raw.title as string,
    description: raw.description as string,
    rationale: (raw.rationale as string) || '',
    priority: (raw.priority as RoadmapFeaturePriority) || 'should',
    complexity: (raw.complexity as RoadmapFeature['complexity']) || 'medium',
    impact: (raw.impact as RoadmapFeature['impact']) || 'medium',
    phaseId: raw.phase_id as string,
    dependencies: (raw.dependencies as string[]) || [],
    status: (raw.status as RoadmapFeature['status']) || 'under_review',
    acceptanceCriteria: (raw.acceptance_criteria as string[]) || [],
    userStories: (raw.user_stories as string[]) || [],
    linkedSpecId: raw.linked_spec_id as string | undefined,
    taskOutcome: raw.task_outcome as RoadmapFeature['taskOutcome'],
    previousStatus: raw.previous_status as RoadmapFeature['previousStatus'],
    competitorInsightIds: (raw.competitor_insight_ids as string[]) || undefined,
    directionIds: directionIdsFromRaw(raw),
    ...externalFieldsFromSnakeCase(raw),
    refinedAt: typeof refinedAt === 'string' && refinedAt ? refinedAt : undefined,
    duplicateOf: typeof duplicateOf === 'string' && duplicateOf ? duplicateOf : undefined,
    ...intakeFieldsFromRaw(raw),
  };
}

// ---- AI refinement (quick add → proper feature) ----------------------------------

type Level = 'low' | 'medium' | 'high';

/** Normalized output of one AI refinement run */
export interface FeatureRefinement {
  title: string;
  description: string;
  rationale: string;
  complexity?: Level;
  impact?: Level;
  priority?: RoadmapFeaturePriority;
  phaseId?: string;
  acceptanceCriteria: string[];
  directionIds: string[];
  duplicateOf: string | null;
}

/** The feature's fields when refinement was requested; a field still equal to this is "untouched" */
export interface FeatureRefineSnapshot {
  title: string;
  description: string;
  rationale: string;
  complexity: string;
  impact: string;
  phaseId: string;
  priority: string;
}

export function snapshotRawFeature(raw: Record<string, unknown>): FeatureRefineSnapshot {
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    title: s(raw.title),
    description: s(raw.description),
    rationale: s(raw.rationale),
    complexity: s(raw.complexity),
    impact: s(raw.impact),
    phaseId: s(raw.phase_id),
    priority: s(raw.priority),
  };
}

export interface ApplyRefinementContext {
  /** The one-line idea the refinement was based on (quick add: the typed line) */
  line: string;
  snapshot: FeatureRefineSnapshot;
  suggestPriority: boolean;
  /** Explicit "Refine with AI": content fields may be overwritten */
  explicit?: boolean;
  /** Direction ids from strategy.json; empty = leave direction_ids alone */
  knownDirectionIds: ReadonlySet<string>;
  now?: Date;
}

export type RefinementPatchResult =
  | { success: true; feature: RoadmapFeature }
  | { success: false; error: string };

const isEmpty = (v: unknown) => typeof v !== 'string' || v.trim() === '';

/**
 * Mutates a parsed roadmap.json, merging an AI refinement into one feature.
 *
 * Unknown fields are preserved. Without `explicit`, content the user changed while
 * refinement ran wins: if the title no longer equals the original line, title and
 * description are kept (description only filled when empty); rationale/complexity/
 * impact are only replaced while still equal to the snapshot; acceptance criteria and
 * direction ids only when empty. Phase/priority move only with `suggestPriority` and
 * while still equal to the snapshot (the quick-add defaults).
 */
export function applyFeatureRefinement(
  roadmap: {
    features?: Array<Record<string, unknown>>;
    phases?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
  },
  featureId: string,
  refinement: FeatureRefinement,
  ctx: ApplyRefinementContext,
): RefinementPatchResult {
  const feature = roadmap.features?.find((f) => f.id === featureId);
  if (!feature) return { success: false, error: 'Feature not found' };
  const { snapshot, explicit = false } = ctx;
  const now = ctx.now ?? new Date();

  const titleEdited = !explicit && String(feature.title ?? '').trim() !== ctx.line.trim();
  if (refinement.title && (explicit || !titleEdited)) feature.title = refinement.title;
  if (refinement.description && (explicit || !titleEdited || isEmpty(feature.description))) {
    feature.description = refinement.description;
  }
  if (refinement.rationale && (explicit || isEmpty(feature.rationale) || feature.rationale === snapshot.rationale)) {
    feature.rationale = refinement.rationale;
  }
  if (refinement.complexity && (explicit || (feature.complexity ?? '') === snapshot.complexity)) {
    feature.complexity = refinement.complexity;
  }
  if (refinement.impact && (explicit || (feature.impact ?? '') === snapshot.impact)) {
    feature.impact = refinement.impact;
  }
  const criteria = feature.acceptance_criteria;
  if (refinement.acceptanceCriteria.length > 0 && (explicit || !Array.isArray(criteria) || criteria.length === 0)) {
    feature.acceptance_criteria = refinement.acceptanceCriteria;
  }

  if (ctx.knownDirectionIds.size > 0) {
    const ids = [...new Set(refinement.directionIds.filter((id) => ctx.knownDirectionIds.has(id)))];
    const current = feature.direction_ids;
    if (explicit || !Array.isArray(current) || current.length === 0) feature.direction_ids = ids;
  }

  if (ctx.suggestPriority && !explicit) {
    const phaseExists = (id: string) => (roadmap.phases ?? []).some((p) => p.id === id);
    if (refinement.phaseId && phaseExists(refinement.phaseId) && (feature.phase_id ?? '') === snapshot.phaseId) {
      feature.phase_id = refinement.phaseId;
    }
    if (refinement.priority && isRoadmapFeaturePriority(refinement.priority) && (feature.priority ?? '') === snapshot.priority) {
      feature.priority = refinement.priority;
    }
  }

  const dup = refinement.duplicateOf;
  if (dup && dup !== featureId && roadmap.features?.some((f) => f.id === dup)) {
    feature.duplicate_of = dup;
  } else {
    delete feature.duplicate_of;
  }

  feature.refined_at = now.toISOString();
  roadmap.metadata = roadmap.metadata || {};
  roadmap.metadata.updated_at = now.toISOString();
  return { success: true, feature: featureFromSnakeCase(feature) };
}

/** Fields an AI refinement owns; a stale renderer save must not roll them back */
const REFINED_FIELDS = [
  'title',
  'description',
  'rationale',
  'complexity',
  'impact',
  'acceptance_criteria',
  'direction_ids',
  'duplicate_of',
  'refined_at',
] as const;

/** Fields the planning proofread owns (it also creates the task and moves the feature on) */
const INTAKE_FIELDS = [
  'title',
  'description',
  'rationale',
  'acceptance_criteria',
  'user_stories',
  'status',
  'linked_spec_id',
  'proofread_note',
  'intake_at',
] as const;

/**
 * Guards ROADMAP_SAVE against a renderer that hasn't seen a refinement yet: when the
 * file holds a newer `refined_at` than the incoming feature, the refined fields from
 * the file are kept. Mutates `incoming` in place.
 */
export function keepNewerRefinements(
  existing: Array<Record<string, unknown>> | undefined,
  incoming: Array<Record<string, unknown>>,
): void {
  const byId = new Map((existing ?? []).map((f) => [f.id, f]));
  for (const feature of incoming) {
    const stored = byId.get(feature.id);
    const storedAt = typeof stored?.refined_at === 'string' ? stored.refined_at : '';
    const incomingAt = typeof feature.refined_at === 'string' ? feature.refined_at : '';
    if (stored && storedAt && storedAt > incomingAt) {
      for (const key of REFINED_FIELDS) {
        if (key in stored) feature[key] = stored[key];
        else delete feature[key];
      }
    }
    const storedIntake = typeof stored?.intake_at === 'string' ? stored.intake_at : '';
    const incomingIntake = typeof feature.intake_at === 'string' ? feature.intake_at : '';
    if (stored && storedIntake && storedIntake > incomingIntake) {
      for (const key of INTAKE_FIELDS) {
        if (key in stored) feature[key] = stored[key];
        else delete feature[key];
      }
    }
  }
}

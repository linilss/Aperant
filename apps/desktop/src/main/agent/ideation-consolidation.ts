/**
 * Ideation consolidation
 * ======================
 *
 * Pure helpers for merging a run's freshly generated ideas into the project's
 * ideation.json — the single file the Ideation view reads.
 */

import type { RawIdea, RawIdeationConfig } from '../ipc-handlers/ideation/types';
import type { IdeationConfig } from '../../shared/types';
import { ALL_IDEATION_TYPES } from '../../shared/constants/ideation';
import { normalizeIdeationFocus, resolveEnabledIdeationTypes } from '../../shared/utils/ideation-config';

/**
 * Output file each ideation prompt writes its ideas to.
 *
 * Single source of truth: both the per-type streaming read and the final
 * consolidation use this map. Most types follow `<type>_ideas.json`, but the
 * UI/UX prompt writes `ui_ux_ideas.json` — deriving the name from the type
 * silently missed that file and streamed an empty list for UI/UX ideas.
 * Must stay in sync with the `Write your findings to ...` line in
 * apps/desktop/prompts/ideation_*.md.
 */
export const IDEATION_TYPE_FILES: Record<string, string> = {
  features: 'features_ideas.json',
  code_improvements: 'code_improvements_ideas.json',
  ui_ux_improvements: 'ui_ux_ideas.json',
  documentation_gaps: 'documentation_gaps_ideas.json',
  security_hardening: 'security_hardening_ideas.json',
  performance_optimizations: 'performance_optimizations_ideas.json',
  code_quality: 'code_quality_ideas.json',
};

/** Resolve the file an ideation type writes to, falling back to the naming convention */
export function ideationTypeFileName(ideationType: string): string {
  return IDEATION_TYPE_FILES[ideationType] ?? `${ideationType}_ideas.json`;
}

/**
 * Merge a run's ideas into the ideas already stored for a project.
 *
 * Types the run regenerated are replaced wholesale; every other type is kept
 * untouched. This mirrors addIdeasForType() in the renderer store, so what the
 * UI streamed during the run and what lands on disk agree.
 *
 * Replacing rather than appending is required, not just tidier: ideas carry
 * per-type sequential ids (`ci-001`, `uiux-001`, ...) that the agent reuses on
 * every run, so appending a new run's output would produce duplicate ids within
 * one session — breaking list keys and id-based dismiss/convert lookups.
 *
 * @param existingIdeas - Ideas currently stored in ideation.json
 * @param generatedIdeasByType - Ideas produced by this run, keyed by ideation type
 * @returns The merged idea list
 */
export function mergeIdeationIdeas(
  existingIdeas: RawIdea[],
  generatedIdeasByType: ReadonlyMap<string, RawIdea[]>,
): RawIdea[] {
  const regeneratedTypes = new Set(generatedIdeasByType.keys());

  const merged: RawIdea[] = existingIdeas.filter(
    (idea) => !regeneratedTypes.has(String((idea as { type?: string }).type ?? '')),
  );

  for (const rawIdeas of generatedIdeasByType.values()) {
    merged.push(...rawIdeas);
  }

  return merged;
}

/**
 * Config written to ideation.json after a run, so the next visit restores the
 * user's types, context toggles and focus. An append run only adds its types to
 * the saved selection. `known_types` records every type that existed, so types
 * added in later versions count as enabled (see resolveEnabledIdeationTypes).
 */
export function buildPersistedIdeationConfig(
  existing: RawIdeationConfig | undefined,
  config: IdeationConfig,
): RawIdeationConfig {
  const enabled = config.append
    ? [
        ...new Set([
          ...resolveEnabledIdeationTypes(existing?.enabled_types ?? existing?.enabledTypes, existing?.known_types),
          ...config.enabledTypes,
        ]),
      ]
    : [...config.enabledTypes];
  return {
    ...existing,
    enabled_types: ALL_IDEATION_TYPES.filter((type) => enabled.includes(type)),
    known_types: [...ALL_IDEATION_TYPES],
    include_roadmap_context: config.includeRoadmapContext,
    include_kanban_context: config.includeKanbanContext,
    max_ideas_per_type: config.maxIdeasPerType,
    focus: normalizeIdeationFocus(config.focus),
  };
}

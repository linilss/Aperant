/**
 * Funnel handoff: turn the user's ranked strategic directions into a prompt
 * section for downstream generation (roadmap discovery/features, ideation).
 */

import type { CompetitorStrategyState, StrategicDirection } from '../../../../shared/types/competitors';
import { formatCoreValuesSection, loadCoreValues } from '../../../core-values';
import { loadCompetitorState } from './persistence';

/** How many top non-avoided directions count as "pursue" */
export const PURSUE_COUNT = 3;

export interface RankedDirections {
  pursue: StrategicDirection[];
  later: StrategicDirection[];
  avoid: StrategicDirection[];
}

/** Split ranked directions; empty when the user never saved a ranking */
export function splitRankedDirections(state: CompetitorStrategyState | null): RankedDirections {
  if (!state?.rankingSavedAt || state.directions.length === 0) return { pursue: [], later: [], avoid: [] };
  const active = state.directions.filter((d) => !d.avoid);
  return {
    pursue: active.slice(0, PURSUE_COUNT),
    later: active.slice(PURSUE_COUNT),
    avoid: state.directions.filter((d) => d.avoid),
  };
}

const noteSuffix = (d: StrategicDirection) =>
  `${d.conflictsWithValues ? ' (flagged as conflicting with the core values — the values win)' : ''}${d.note ? ` User note: "${d.note}"` : ''}`;

export interface StrategyGuidanceOptions {
  /** The caller already put the core values section at the top of its prompt: only refer to it */
  valuesAlreadyShown?: boolean;
}

/**
 * Prompt section built from the core values and a saved ranking; '' when neither exists.
 * Core values come first (unless already shown); then pursue = top 3 non-avoided
 * (in order), avoided = steer away, notes included.
 */
export function buildStrategyGuidance(
  state: CompetitorStrategyState | null,
  coreValues = '',
  options: StrategyGuidanceOptions = {},
): string {
  const { pursue, later, avoid } = splitRankedDirections(state);
  const hasValues = coreValues.trim() !== '';
  const valuesSection = hasValues && !options.valuesAlreadyShown ? formatCoreValuesSection(coreValues) : '';
  if (pursue.length === 0 && avoid.length === 0) return valuesSection ? `\n${valuesSection}` : '';

  const lines: string[] = [
    '',
    ...(valuesSection ? [valuesSection.trimEnd(), ''] : []),
    '**STRATEGIC DIRECTION** (ranked by the user from a competitor analysis — align the vision, priorities and features with it):',
  ];
  if (hasValues) {
    lines.push('These directions are subordinate to the CORE VALUES: skip any part of a direction that conflicts with them.');
  }
  if (pursue.length > 0) {
    lines.push('Pursue, in priority order:');
    pursue.forEach((d, i) => {
      const parts = [d.description, d.opportunity ? `Opportunity: ${d.opportunity}` : ''].filter(Boolean).join(' ');
      lines.push(`${i + 1}. ${d.title}${parts ? ` — ${parts}` : ''}${noteSuffix(d)}`);
    });
  }
  if (later.length > 0) {
    lines.push(`Lower priority: ${later.map((d) => `${d.title}${noteSuffix(d)}`).join('; ')}`);
  }
  if (avoid.length > 0) {
    lines.push('Steer away from (do not propose work that mainly serves these):');
    for (const d of avoid) lines.push(`- ${d.title}${noteSuffix(d)}`);
  }
  lines.push(
    'Prefer work that advances direction #1 first; when assigning MoSCoW priority, ' +
      'give "must"/"should" to features that advance the pursued directions and "wont" to ones that mainly serve avoided directions.',
  );
  return `${lines.join('\n')}\n`;
}

/** Load the core values + `.malvy/roadmap/strategy.json` and build the guidance section ('' when both absent) */
export function loadStrategyGuidance(projectDir: string, options: StrategyGuidanceOptions = {}): string {
  const coreValues = loadCoreValues(projectDir);
  try {
    return buildStrategyGuidance(loadCompetitorState(projectDir), coreValues, options);
  } catch {
    return buildStrategyGuidance(null, coreValues, options);
  }
}

// ---- Direction tagging (roadmap features → direction_ids) -------------------------

/**
 * Prompt section listing every direction with its id and rank so the features
 * phase can tag each feature with `direction_ids`. '' when there are no directions.
 */
export function buildDirectionTaggingSection(state: CompetitorStrategyState | null): string {
  const directions = state?.directions ?? [];
  if (directions.length === 0) return '';

  const lines: string[] = [
    '',
    '**DIRECTION TAGS** (strategic directions from the competitor analysis, in the user\'s rank order):',
  ];
  directions.forEach((d, i) => {
    lines.push(`- id "${d.id}" — #${i + 1} ${d.title}${d.avoid ? ' (AVOID)' : ''}`);
  });
  lines.push(
    'For EVERY feature set "direction_ids" to the ids (from the list above only) of the directions it advances — ' +
      'zero or more; use [] when it serves none. A feature that mainly serves an AVOID direction should normally be ' +
      '"wont" or left out.',
  );
  return `${lines.join('\n')}\n`;
}

/** Load strategy.json and build the direction-tagging section ('' when absent) */
export function loadDirectionTaggingSection(projectDir: string): string {
  try {
    return buildDirectionTaggingSection(loadCompetitorState(projectDir));
  } catch {
    return '';
  }
}

/**
 * Compact direction-tagging section for ideation: same id list as the roadmap
 * features phase, asking each idea for an optional `direction_ids`. '' without directions.
 */
export function buildIdeaDirectionTaggingSection(state: CompetitorStrategyState | null): string {
  const directions = state?.directions ?? [];
  if (directions.length === 0) return '';
  const list = directions.map((d, i) => `"${d.id}" #${i + 1} ${d.title}${d.avoid ? ' (AVOID)' : ''}`).join('; ');
  return (
    `\n**DIRECTION TAGS**: ${list}\n` +
    'Give each idea "direction_ids": the ids above (only those) of the directions it advances; [] when none.\n'
  );
}

/** Load strategy.json and build the idea direction-tagging section ('' when absent) */
export function loadIdeaDirectionTaggingSection(projectDir: string): string {
  try {
    return buildIdeaDirectionTaggingSection(loadCompetitorState(projectDir));
  } catch {
    return '';
  }
}

/**
 * Normalize `direction_ids` on raw (snake_case) features in place against the
 * known direction ids: unknown / non-string ids are dropped and duplicates removed.
 * With known ids, `defaultMissing` features get [] (tagged, serves none).
 * Without any known ids, `direction_ids` is removed (nothing to tag against).
 */
export function sanitizeFeatureDirectionIds(
  features: Array<Record<string, unknown>>,
  knownIds: ReadonlySet<string>,
  defaultMissing = true,
): void {
  for (const feature of features) {
    if (knownIds.size === 0) {
      delete feature.direction_ids;
      continue;
    }
    const raw = feature.direction_ids ?? feature.directionIds;
    delete feature.directionIds;
    if (!Array.isArray(raw)) {
      if (defaultMissing) feature.direction_ids = [];
      continue;
    }
    feature.direction_ids = [...new Set(raw.filter((id): id is string => typeof id === 'string' && knownIds.has(id)))];
  }
}

/** Direction ids from strategy.json (empty set when absent/unreadable) */
export function loadKnownDirectionIds(projectDir: string): Set<string> {
  try {
    return new Set((loadCompetitorState(projectDir)?.directions ?? []).map((d) => d.id));
  } catch {
    return new Set();
  }
}

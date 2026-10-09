import type { RoadmapFeature } from '../../../shared/types';
import type { StrategicDirection } from '../../../shared/types/competitors';

/** Filter token for features that advance no known direction */
export const UNTAGGED_FILTER = '__untagged__';

export interface RankedDirectionRef {
  direction: StrategicDirection;
  /** 1-based position in the user's ranking */
  rank: number;
}

/** The feature's directions that still exist in strategy.json, in rank order */
export function resolveFeatureDirections(
  feature: Pick<RoadmapFeature, 'directionIds'>,
  directions: StrategicDirection[],
): RankedDirectionRef[] {
  const ids = feature.directionIds;
  if (!ids || ids.length === 0) return [];
  const result: RankedDirectionRef[] = [];
  directions.forEach((direction, i) => {
    if (ids.includes(direction.id)) result.push({ direction, rank: i + 1 });
  });
  return result;
}

/** True when at least one feature was generated with direction tagging */
export function hasDirectionTagging(features: Array<Pick<RoadmapFeature, 'directionIds'>>): boolean {
  return features.some((f) => Array.isArray(f.directionIds));
}

/**
 * Keep features matching any selected token (direction id or UNTAGGED_FILTER).
 * An empty selection means "All directions". Ids not in `directions` are ignored,
 * so a feature tagged only with stale ids counts as untagged.
 */
export function filterFeaturesByDirection<T extends Pick<RoadmapFeature, 'directionIds'>>(
  features: T[],
  selected: readonly string[],
  directions: StrategicDirection[],
): T[] {
  if (selected.length === 0) return features;
  const known = new Set(directions.map((d) => d.id));
  const wantUntagged = selected.includes(UNTAGGED_FILTER);
  return features.filter((feature) => {
    const ids = (feature.directionIds ?? []).filter((id) => known.has(id));
    if (ids.length === 0) return wantUntagged;
    return ids.some((id) => selected.includes(id));
  });
}

/** Toggle one token in the selection (pure) */
export function toggleDirectionFilter(selected: readonly string[], token: string): string[] {
  return selected.includes(token) ? selected.filter((t) => t !== token) : [...selected, token];
}

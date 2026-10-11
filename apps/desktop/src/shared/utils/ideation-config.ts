/**
 * Ideation config persistence helpers shared by main (ideation.json) and renderer.
 */

import {
  ALL_IDEATION_TYPES,
  DEFAULT_IDEATION_CONFIG,
  LEGACY_IDEATION_TYPES,
  MAX_IDEATION_FOCUS_LENGTH,
} from '../constants/ideation';
import type { IdeationType } from '../types/insights';

const ALL_TYPES: ReadonlySet<string> = new Set(ALL_IDEATION_TYPES);

export function isIdeationType(value: unknown): value is IdeationType {
  return typeof value === 'string' && ALL_TYPES.has(value);
}

/**
 * Enabled types from a saved config. Types the saved config did not know about
 * (absent from `knownTypes`; legacy configs without it knew LEGACY_IDEATION_TYPES)
 * are new since it was saved and count as enabled. No saved list → defaults.
 * Result is in display order with unknown values dropped.
 */
export function resolveEnabledIdeationTypes(savedEnabled: unknown, knownTypes?: unknown): IdeationType[] {
  if (!Array.isArray(savedEnabled)) return [...DEFAULT_IDEATION_CONFIG.enabledTypes];
  const known: ReadonlySet<string> = new Set(
    Array.isArray(knownTypes) ? knownTypes.filter((t): t is string => typeof t === 'string') : LEGACY_IDEATION_TYPES,
  );
  const enabled = new Set(savedEnabled.filter(isIdeationType));
  return ALL_IDEATION_TYPES.filter((type) => enabled.has(type) || !known.has(type));
}

/** Trimmed focus text capped at MAX_IDEATION_FOCUS_LENGTH ('' for non-strings) */
export function normalizeIdeationFocus(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, MAX_IDEATION_FOCUS_LENGTH).trim();
}

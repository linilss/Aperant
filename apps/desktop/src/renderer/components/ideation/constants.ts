import { ALL_IDEATION_TYPES as SHARED_IDEATION_TYPES } from '../../../shared/constants';
import type { IdeationType } from '../../../shared/types';

// All ideation types for iteration, in display order ('features' first)
export const ALL_IDEATION_TYPES: IdeationType[] = [...SHARED_IDEATION_TYPES];

/**
 * Display label for an AI-provided category. Falls back to the raw value (snake_case -> words)
 * when the model returns a category outside the known set; null when there is nothing to show,
 * so callers can skip rendering an empty badge.
 */
export function categoryLabel(labels: Record<string, string>, value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return labels[value] ?? value.replace(/_/g, ' ');
}

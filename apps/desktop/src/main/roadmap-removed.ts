/**
 * Features the user removed from the roadmap, kept so regeneration doesn't propose
 * them again. Lives next to roadmap.json (which a regenerate rewrites) in
 * `.malvy/roadmap/removed_features.json`. Done features are not rejections and are skipped.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

export const REMOVED_FEATURES_FILE = 'removed_features.json';
export const REMOVED_FEATURES_CAP = 100;
const PROMPT_CAP = 40;

export interface RemovedFeature {
  title: string;
  description?: string;
  removedAt: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

export function readRemovedFeatures(roadmapDir: string): RemovedFeature[] {
  const file = path.join(roadmapDir, REMOVED_FEATURES_FILE);
  try {
    if (!existsSync(file)) return [];
    const data = JSON.parse(readFileSync(file, 'utf-8')) as { features?: unknown };
    return Array.isArray(data.features)
      ? data.features.filter((f): f is RemovedFeature => !!f && typeof f === 'object' && !!text((f as RemovedFeature).title))
      : [];
  } catch {
    return [];
  }
}

/**
 * Features present before a save and missing after it (excluding done ones), newest first,
 * merged into the existing list, one per title, capped.
 */
export function mergeRemovedFeatures(
  previous: RemovedFeature[],
  before: Array<Record<string, unknown>>,
  after: Array<Record<string, unknown>>,
  now = new Date().toISOString()
): RemovedFeature[] {
  const remaining = new Set(after.map((f) => String(f.id ?? '')));
  const fresh: RemovedFeature[] = before
    .filter((f) => !remaining.has(String(f.id ?? '')) && f.status !== 'done' && text(f.title))
    .map((f) => ({
      title: text(f.title),
      ...(text(f.description) ? { description: text(f.description).slice(0, 200) } : {}),
      removedAt: now
    }));
  if (fresh.length === 0) return previous;
  const seen = new Set<string>();
  return [...fresh, ...previous]
    .filter((f) => {
      const key = f.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, REMOVED_FEATURES_CAP);
}

/** Record features removed by a roadmap save; no-op when nothing was removed. */
export function recordRemovedFeatures(
  roadmapDir: string,
  before: Array<Record<string, unknown>>,
  after: Array<Record<string, unknown>>
): void {
  const previous = readRemovedFeatures(roadmapDir);
  const next = mergeRemovedFeatures(previous, before, after);
  if (next === previous) return;
  writeFileSync(path.join(roadmapDir, REMOVED_FEATURES_FILE), JSON.stringify({ features: next }, null, 2), 'utf-8');
}

/** Prompt section listing removed features; '' when there are none */
export function buildRemovedFeaturesSection(removed: RemovedFeature[]): string {
  if (removed.length === 0) return '';
  const lines = removed
    .slice(0, PROMPT_CAP)
    .map((f) => `- ${f.title}${f.description ? ` — ${f.description.slice(0, 120)}` : ''}`);
  return (
    '\n**FEATURES THE USER REMOVED** — they decided against these. Do not propose them again, ' +
    'nor close variants under another name; infer what they did not want and avoid that kind:\n' +
    `${lines.join('\n')}\n`
  );
}

/**
 * Safety net for roadmap.json: a rolling copy before every overwrite
 * (`.malvy/roadmap/backups/`), and a check that a renderer save doesn't replace
 * the roadmap with a different one.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

export const ROADMAP_BACKUP_DIR = 'backups';
export const ROADMAP_BACKUP_KEEP = 30;
/** A renderer save adds one feature at a time; more new titles than this means a foreign roadmap */
export const MAX_NEW_FEATURES_PER_SAVE = 3;

/** Copy roadmap.json into backups/ (keeping the newest ROADMAP_BACKUP_KEEP); no-op when it doesn't exist */
export function backupRoadmapFile(roadmapPath: string, now = new Date()): void {
  if (!existsSync(roadmapPath)) return;
  const dir = path.join(path.dirname(roadmapPath), ROADMAP_BACKUP_DIR);
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  copyFileSync(roadmapPath, path.join(dir, `roadmap-${stamp}.json`));
  const files = readdirSync(dir)
    .filter((f) => f.startsWith('roadmap-') && f.endsWith('.json'))
    .sort();
  for (const old of files.slice(0, Math.max(0, files.length - ROADMAP_BACKUP_KEEP))) {
    try {
      unlinkSync(path.join(dir, old));
    } catch {
      // best effort
    }
  }
}

const titleKey = (f: Record<string, unknown>) =>
  typeof f.title === 'string' ? f.title.trim().toLowerCase() : '';

/**
 * True when a save brings in more unknown titles than one edit can and they are
 * most of the roadmap, i.e. another project's roadmap. A view with a few stale
 * titles (renamed by a background refinement) still saves.
 */
export function looksLikeForeignRoadmap(
  existing: Array<Record<string, unknown>>,
  incoming: Array<Record<string, unknown>>
): boolean {
  if (existing.length === 0) return false;
  const known = new Set(existing.map(titleKey));
  const added = incoming.filter((f) => titleKey(f) && !known.has(titleKey(f))).length;
  return added > MAX_NEW_FEATURES_PER_SAVE && added * 2 > incoming.length;
}

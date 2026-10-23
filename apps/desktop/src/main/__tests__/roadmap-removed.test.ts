import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildRemovedFeaturesSection,
  mergeRemovedFeatures,
  readRemovedFeatures,
  recordRemovedFeatures
} from '../roadmap-removed';

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

const f = (id: string, title: string, status = 'planned') => ({ id, title, status, description: `${title} desc` });

describe('removed roadmap features', () => {
  it('records features missing after a save, skipping done ones', () => {
    const next = mergeRemovedFeatures([], [f('1', 'Keep'), f('2', 'Drop'), f('3', 'Shipped', 'done')], [f('1', 'Keep')], 'T');
    expect(next).toEqual([{ title: 'Drop', description: 'Drop desc', removedAt: 'T' }]);
  });

  it('returns the same list when nothing was removed', () => {
    const previous = [{ title: 'Old', removedAt: 'T0' }];
    expect(mergeRemovedFeatures(previous, [f('1', 'A')], [f('1', 'A')])).toBe(previous);
  });

  it('dedupes by title, newest first', () => {
    const next = mergeRemovedFeatures([{ title: 'drop', removedAt: 'T0' }], [f('2', 'Drop')], [], 'T1');
    expect(next).toHaveLength(1);
    expect(next[0].removedAt).toBe('T1');
  });

  it('persists next to roadmap.json and feeds the prompt', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'removed-'));
    recordRemovedFeatures(dir, [f('1', 'Tenant FTP crawler')], []);
    const removed = readRemovedFeatures(dir);
    expect(removed.map((r) => r.title)).toEqual(['Tenant FTP crawler']);
    const section = buildRemovedFeaturesSection(removed);
    expect(section).toContain('FEATURES THE USER REMOVED');
    expect(section).toContain('Tenant FTP crawler');
    expect(buildRemovedFeaturesSection([])).toBe('');
  });
});

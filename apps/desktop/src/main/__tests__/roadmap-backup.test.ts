import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { backupRoadmapFile, looksLikeForeignRoadmap, ROADMAP_BACKUP_KEEP } from '../roadmap-backup';

const f = (title: string) => ({ title });

describe('looksLikeForeignRoadmap', () => {
  it('allows edits, deletes and a single add', () => {
    const existing = [f('A'), f('B'), f('C')];
    expect(looksLikeForeignRoadmap(existing, [f('A'), f('B'), f('C'), f('New')])).toBe(false);
    expect(looksLikeForeignRoadmap(existing, [f('A')])).toBe(false);
    expect(looksLikeForeignRoadmap(existing, [])).toBe(false);
  });

  it('still saves when a few titles were renamed in the background', () => {
    const existing = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map(f);
    const stale = [f('a-old'), f('b-old'), f('c-old'), f('d-old'), ...['E', 'F', 'G', 'H', 'I', 'J'].map(f)];
    expect(looksLikeForeignRoadmap(existing, stale)).toBe(false);
  });

  it("refuses another project's features", () => {
    const existing = [f('Reminders'), f('Calendar drag')];
    expect(looksLikeForeignRoadmap(existing, [f('Portugal NIF'), f('E-REDES'), f('SIGE fix'), f('FTP ingest')])).toBe(true);
  });
});

describe('backupRoadmapFile', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps a bounded number of copies', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rm-backup-'));
    const file = path.join(dir, 'roadmap.json');
    writeFileSync(file, '{}');
    for (let i = 0; i < ROADMAP_BACKUP_KEEP + 5; i++) backupRoadmapFile(file, new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
    expect(readdirSync(path.join(dir, 'backups'))).toHaveLength(ROADMAP_BACKUP_KEEP);
  });
});

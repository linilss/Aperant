import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildProjectBrief } from '../project-brief';

describe('buildProjectBrief', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps the team CLAUDE.md next to the Malvy summary', () => {
    dir = mkdtempSync(join(tmpdir(), 'brief-'));
    mkdirSync(join(dir, '.malvy', 'docs'), { recursive: true });
    writeFileSync(join(dir, '.malvy', 'docs', 'project_summary.json'), JSON.stringify({ overview: 'A screen-time app.' }));
    writeFileSync(join(dir, 'CLAUDE.md'), 'Calma: a BePresent clone without freemium limits.');

    const brief = buildProjectBrief(dir);
    expect(brief).toContain('A screen-time app.');
    expect(brief).toContain('BePresent clone');
  });
});

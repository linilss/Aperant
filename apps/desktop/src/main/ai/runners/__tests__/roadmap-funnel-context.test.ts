import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildCompetitorIdeasSection,
  buildCompetitorSection,
  loadDocsSection,
  loadFunnelContextSection,
  loadPointersSection
} from '../roadmap-funnel-context';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'funnel-ctx-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('roadmap funnel context', () => {
  it('is empty for a project without funnel output', async () => {
    expect(await loadFunnelContextSection(dir)).toBe('');
  });

  it('inlines developer pointers', () => {
    mkdirSync(path.join(dir, '.malvy'), { recursive: true });
    writeFileSync(path.join(dir, '.malvy', 'pointers.md'), '# Developer pointers\n\n- Not X, rather Y\n');
    const section = loadPointersSection(dir);
    expect(section).toContain('DEVELOPER POINTERS');
    expect(section).toContain('Not X, rather Y');
  });

  it('lists team and Malvy docs', async () => {
    writeFileSync(path.join(dir, 'CLAUDE.md'), '# Root guide\n');
    mkdirSync(path.join(dir, '.malvy', 'docs'), { recursive: true });
    writeFileSync(path.join(dir, '.malvy', 'docs', 'CLAUDE.md'), '# Malvy layer\n');
    const section = await loadDocsSection(dir);
    expect(section).toContain('CLAUDE.md — Root guide');
    expect(section).toContain('.malvy/docs/CLAUDE.md');
  });

  it('asks for competitor features worth matching', () => {
    expect(buildCompetitorSection('/x/competitor_analysis.json')).toContain('key features and strengths');
    expect(buildCompetitorIdeasSection('/x/competitor_analysis.json')).toContain('key features and strengths');
  });
});

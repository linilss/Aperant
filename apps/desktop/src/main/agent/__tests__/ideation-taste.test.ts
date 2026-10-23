import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { updateIdeaTaste } from '../ideation-consolidation';
import { buildTasteSection, loadIdeaTaste } from '../../ai/runners/ideation-context';
import { buildQualitySection, ideationModelFor } from '../../ai/runners/ideation';
import { transformIdeaFromSnakeCase } from '../../ipc-handlers/ideation/transformers';
import type { RawIdea } from '../../ipc-handlers/ideation/types';

const idea = (over: Partial<RawIdea>): RawIdea =>
  ({ id: 'x', type: 'features', title: 'T', description: '', rationale: '', status: 'draft', ...over }) as RawIdea;

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('updateIdeaTaste', () => {
  it('records verdicts of regenerated types, newest first, deduped', () => {
    const taste = updateIdeaTaste(
      [{ type: 'features', title: 'Old pick', verdict: 'picked', at: '2026-01-01' }],
      [
        idea({ title: 'Nope', status: 'dismissed' }),
        idea({ title: 'Yes', status: 'converted' }),
        idea({ title: 'Undecided' }),
        idea({ title: 'Other type', type: 'code_quality', status: 'dismissed' }),
        idea({ title: 'old pick', status: 'converted' })
      ],
      new Set(['features']),
      '2026-10-13'
    );
    expect(taste.map((e) => `${e.verdict}:${e.title}`)).toEqual(['dismissed:Nope', 'picked:Yes', 'picked:old pick']);
  });
});

describe('taste prompt section', () => {
  it('lists picked and dismissed ideas from ideation.json, same type first', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'taste-'));
    writeFileSync(
      path.join(dir, 'ideation.json'),
      JSON.stringify({
        ideas: [
          { type: 'code_quality', title: 'Refactor X', status: 'dismissed' },
          { type: 'features', title: 'Shared lists', status: 'draft', linked_task_id: 't1' }
        ],
        taste: [{ type: 'features', title: 'Dark mode', verdict: 'dismissed', at: '2026-10-01' }]
      })
    );
    const items = loadIdeaTaste(dir, 'features');
    expect(items[0].title).toBe('Shared lists');
    const section = buildTasteSection(items);
    expect(section).toContain('PICKED');
    expect(section).toContain('Shared lists');
    expect(section).toContain('DISMISSED');
    expect(section).toContain('Dark mode');
    expect(section).toContain('Refactor X');
  });

  it('is empty without history', () => {
    expect(buildTasteSection([])).toBe('');
  });
});

describe('ideation quality', () => {
  it('runs product types on Opus, keeps technical types and stronger models', () => {
    expect(ideationModelFor('features', 'sonnet')).toBe('opus');
    expect(ideationModelFor('ui_ux_improvements', 'haiku')).toBe('opus');
    expect(ideationModelFor('code_quality', 'sonnet')).toBe('sonnet');
    expect(ideationModelFor('features', 'fable')).toBe('fable');
  });

  it('asks for a larger pool and the card fields', () => {
    const section = buildQualitySection(5);
    expect(section).toContain('15 candidate');
    expect(section).toContain('"first_step"');
  });

  it('maps score, why_now, evidence and first_step', () => {
    const result = transformIdeaFromSnakeCase(
      idea({ score: 12, why_now: 'Now', evidence: 'HomePage', first_step: 'Ship a toggle' })
    );
    expect(result.score).toBe(10);
    expect(result.whyNow).toBe('Now');
    expect(result.evidence).toBe('HomePage');
    expect(result.firstStep).toBe('Ship a toggle');
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const cliMock = vi.fn();
vi.mock('../../cli/claude-cli', () => ({
  runClaudeCliDetailed: (opts: unknown) => cliMock(opts),
}));
vi.mock('../../prompts/prompt-loader', () => ({
  tryLoadPrompt: (name: string) => `# ${name} instructions`,
}));
vi.mock('../competitors/project-brief', () => ({
  buildProjectBrief: () => '### Source: .malvy/docs/project_summary.json\nA habit tracker for teams',
}));
vi.mock('../competitors/persistence', () => ({
  loadCompetitorState: () => ({
    directions: [
      { id: 'dir-offline', title: 'Offline-first', avoid: false },
      { id: 'dir-ads', title: 'Ad-supported', avoid: true },
    ],
  }),
}));

import {
  buildFeatureRefinePrompt,
  FEATURE_REFINE_MAX_TURNS,
  parseFeatureRefineOutput,
  runRoadmapFeatureRefine,
  type RoadmapFeatureRefineInput,
} from '../roadmap-feature-refine';

const input: RoadmapFeatureRefineInput = {
  projectDir: '/tmp/project',
  line: 'let people export their streaks to csv',
  existingFeatures: [
    { id: 'f-1', title: 'Dark mode' },
    { id: 'f-2', title: 'Data export' },
  ],
  phases: [
    { id: 'phase-1', name: 'MVP', description: 'Core loop' },
    { id: 'phase-2', name: 'Growth' },
  ],
  suggestPriority: true,
  modelId: 'claude-sonnet-test',
};

const block = (json: string) => `<feature_refine>${json}</feature_refine>`;
const goodJson = JSON.stringify({
  title: 'CSV export of streaks',
  description: 'Lets users download streak history as CSV.',
  rationale: 'Users want their data.',
  complexity: 'low',
  impact: 'medium',
  priority: 'could',
  phase_id: 'phase-2',
  acceptance_criteria: ['- Export button exists', '2. CSV has one row per day'],
  direction_ids: ['dir-offline'],
  duplicate_of: 'f-2',
});

beforeEach(() => cliMock.mockReset());

describe('buildFeatureRefinePrompt', () => {
  it('includes the line, project summary, existing titles, phases and directions with ids', () => {
    const prompt = buildFeatureRefinePrompt(input);
    expect(prompt).toContain('# roadmap_feature_refine instructions');
    expect(prompt).toContain(input.line);
    expect(prompt).toContain('A habit tracker for teams');
    expect(prompt).toContain('id "f-1" — Dark mode');
    expect(prompt).toContain('id "f-2" — Data export');
    expect(prompt).toContain('id "phase-1" — MVP: Core loop');
    expect(prompt).toContain('id "dir-offline"');
    expect(prompt).toContain('id "dir-ads"');
    expect(prompt).toContain('(AVOID)');
    expect(prompt).toContain('Suggest a MoSCoW priority');
  });

  it('tells the model priority is fixed when not suggesting', () => {
    expect(buildFeatureRefinePrompt({ ...input, suggestPriority: false })).toContain('already set priority');
  });
});

describe('buildFeatureRefinePrompt — core values', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'malvy-refine-values-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('puts the core values first when set', () => {
    mkdirSync(path.join(dir, '.malvy'), { recursive: true });
    writeFileSync(path.join(dir, '.malvy', 'core-values.md'), 'No ads or dark patterns.');

    const prompt = buildFeatureRefinePrompt({ ...input, projectDir: dir });

    expect(prompt.startsWith('## CORE VALUES (highest priority')).toBe(true);
    expect(prompt).toContain('No ads or dark patterns.');
    expect(prompt.indexOf('No ads or dark patterns.')).toBeLessThan(prompt.indexOf('# roadmap_feature_refine instructions'));
  });

  it('has no core values section without values', () => {
    const prompt = buildFeatureRefinePrompt({ ...input, projectDir: dir });
    expect(prompt).not.toContain('CORE VALUES');
    expect(prompt.startsWith('# roadmap_feature_refine instructions')).toBe(true);
  });
});

describe('parseFeatureRefineOutput', () => {
  it('parses the tag JSON and normalizes fields', () => {
    const parsed = parseFeatureRefineOutput(`Let me look...\n${block(goodJson)}\nthanks`);
    expect(parsed).toEqual({
      title: 'CSV export of streaks',
      description: 'Lets users download streak history as CSV.',
      rationale: 'Users want their data.',
      complexity: 'low',
      impact: 'medium',
      priority: 'could',
      phaseId: 'phase-2',
      acceptanceCriteria: ['Export button exists', 'CSV has one row per day'],
      directionIds: ['dir-offline'],
      duplicateOf: 'f-2',
    });
  });

  it('is tolerant to junk: fences, trailing commas, bad enums, multiple blocks', () => {
    const text =
      `${block('{"title": "draft"}')}\n` +
      block('```json\n{"title": "Final", "description": "D", "complexity": "huge", "priority": "asap", "duplicate_of": "null", "acceptance_criteria": "nope",}\n```');
    const parsed = parseFeatureRefineOutput(text);
    expect(parsed?.title).toBe('Final');
    expect(parsed?.complexity).toBeUndefined();
    expect(parsed?.priority).toBeUndefined();
    expect(parsed?.duplicateOf).toBeNull();
    expect(parsed?.acceptanceCriteria).toEqual([]);
  });

  it('returns null for missing block, invalid JSON or empty title', () => {
    expect(parseFeatureRefineOutput('no block here')).toBeNull();
    expect(parseFeatureRefineOutput(block('not json at all ['))).toBeNull();
    expect(parseFeatureRefineOutput(block('{"title": "  "}'))).toBeNull();
  });

  it('clips long titles to 70 chars at a word boundary', () => {
    const long = 'Export every single streak and habit and note to a spreadsheet friendly CSV file format';
    const parsed = parseFeatureRefineOutput(block(JSON.stringify({ title: long })));
    expect(parsed?.title.length).toBeLessThanOrEqual(70);
    expect(long.startsWith(parsed?.title ?? 'x')).toBe(true);
  });
});

describe('runRoadmapFeatureRefine', () => {
  it('runs the CLI read-only with project context and returns the refinement', async () => {
    cliMock.mockResolvedValue({ text: block(goodJson), resultText: '', totalCostUsd: 0.03, numTurns: 3 });
    const out = await runRoadmapFeatureRefine(input);
    expect(out.refinement.title).toBe('CSV export of streaks');
    expect(out.costUsd).toBe(0.03);
    const opts = cliMock.mock.calls[0][0];
    expect(opts).toMatchObject({
      cwd: '/tmp/project',
      modelId: 'claude-sonnet-test',
      allowedTools: ['Read', 'Glob', 'Grep'],
      minimalContext: true,
      projectContext: true,
      maxTurns: FEATURE_REFINE_MAX_TURNS,
    });
    expect(opts.prompt).toContain(input.line);
  });

  it('throws when the response has no usable block', async () => {
    cliMock.mockResolvedValue({ text: 'I could not decide.', resultText: '' });
    await expect(runRoadmapFeatureRefine(input)).rejects.toThrow(/feature_refine/);
  });
});

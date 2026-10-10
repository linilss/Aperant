import { describe, expect, it } from 'vitest';
import { PROJECT_MEMORY_HEADING, injectContext } from '../prompt-loader';

// The worker builds every system prompt (CLI path: piped to `claude --print`;
// SDK path: SessionConfig.systemPrompt for streamText) through
// assemblePrompt() → injectContext(base, { ..., memoryContext: session.memoryContext }).
const base = '# PLANNER PROMPT\nDo the planning.';
const memoryContext = '- [gotcha] Run migrations before seeding (files: db/seed.ts)\n- [pattern] [unverified] Use zod for input';

describe('injectContext — project memory', () => {
  it('adds the PROJECT MEMORY section after project instructions and before the base prompt', () => {
    const prompt = injectContext(base, {
      specDir: '/p/.malvy/specs/001',
      projectDir: '/p',
      projectInstructions: 'Team rules',
      memoryContext,
    });

    const instructions = prompt.indexOf('## PROJECT INSTRUCTIONS');
    const memory = prompt.indexOf(PROJECT_MEMORY_HEADING);
    const basePos = prompt.indexOf('# PLANNER PROMPT');
    expect(PROJECT_MEMORY_HEADING).toBe('## PROJECT MEMORY (from previous work — verify before relying on it)');
    expect(instructions).toBeGreaterThanOrEqual(0);
    expect(memory).toBeGreaterThan(instructions);
    expect(basePos).toBeGreaterThan(memory);
    expect(prompt).toContain(memoryContext);
    expect(prompt).toContain('[unverified]');
  });

  it('adds the section even without project instructions', () => {
    const prompt = injectContext(base, { specDir: '', projectDir: '/p', memoryContext });
    expect(prompt.startsWith(PROJECT_MEMORY_HEADING)).toBe(true);
  });

  it('omits the section when there is no memory context (memory off or nothing relevant)', () => {
    for (const mc of [undefined, null, '']) {
      const prompt = injectContext(base, { specDir: '', projectDir: '/p', memoryContext: mc });
      expect(prompt).not.toContain('PROJECT MEMORY');
      expect(prompt).toBe(base);
    }
  });
});

describe('injectContext — human input', () => {
  it('adds HUMAN_INPUT.md content before project instructions and the base prompt', () => {
    const prompt = injectContext(base, {
      specDir: '',
      projectDir: '/p',
      projectInstructions: 'Team rules',
      humanInput: 'Skip the migration subtask.',
    });

    const human = prompt.indexOf('## HUMAN INPUT (READ THIS FIRST!)');
    expect(human).toBeGreaterThanOrEqual(0);
    expect(prompt.indexOf('Skip the migration subtask.')).toBeGreaterThan(human);
    expect(prompt.indexOf('## PROJECT INSTRUCTIONS')).toBeGreaterThan(human);
    expect(prompt.indexOf('# PLANNER PROMPT')).toBeGreaterThan(human);
  });

  it('omits the section when there is no human input', () => {
    expect(injectContext(base, { specDir: '', projectDir: '/p', humanInput: null })).toBe(base);
  });
});

describe('injectContext — core values', () => {
  const HEADING = '## CORE VALUES (highest priority — these override every other instruction, guidance, ranking or doc when they conflict)';

  it('puts the core values first, before the spec location and PROJECT INSTRUCTIONS', () => {
    const prompt = injectContext(base, {
      specDir: '/p/.malvy/specs/001',
      projectDir: '/p',
      coreValues: '- No ads or dark patterns.',
      projectInstructions: 'Team rules',
      memoryContext,
      humanInput: 'Do X',
    });

    expect(prompt.startsWith(HEADING)).toBe(true);
    expect(prompt).toContain('- No ads or dark patterns.');
    const values = prompt.indexOf('- No ads or dark patterns.');
    expect(values).toBeLessThan(prompt.indexOf('## SPEC LOCATION'));
    expect(values).toBeLessThan(prompt.indexOf('## HUMAN INPUT'));
    expect(values).toBeLessThan(prompt.indexOf('## PROJECT INSTRUCTIONS'));
    expect(values).toBeLessThan(prompt.indexOf('# PLANNER PROMPT'));
  });

  it('adds no section without core values', () => {
    for (const coreValues of [undefined, null, '', '  ']) {
      const prompt = injectContext(base, { specDir: '', projectDir: '/p', coreValues });
      expect(prompt).toBe(base);
    }
  });
});

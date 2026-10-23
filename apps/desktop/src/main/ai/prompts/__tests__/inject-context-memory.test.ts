import { describe, expect, it } from 'vitest';
import { PROJECT_MEMORY_HEADING, RELEASE_POLICY_SECTION, injectContext } from '../prompt-loader';

// The worker builds every system prompt (CLI path: piped to `claude --print`;
// SDK path: SessionConfig.systemPrompt for streamText) through
// assemblePrompt() → injectContext(base, { ..., memoryContext: session.memoryContext }).
const base = '# PLANNER PROMPT\nDo the planning.';
const memoryContext = '- [gotcha] Run migrations before seeding (files: db/seed.ts)\n- [pattern] [unverified] Use zod for input';

describe('injectContext — project memory', () => {
  it('adds the PROJECT MEMORY section after project instructions and the base prompt', () => {
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
    expect(basePos).toBeGreaterThan(instructions);
    expect(memory).toBeGreaterThan(basePos);
    expect(prompt).toContain(memoryContext);
    expect(prompt).toContain('[unverified]');
  });

  it('adds the section even without project instructions', () => {
    const prompt = injectContext(base, { specDir: '', projectDir: '/p', memoryContext });
    expect(prompt.startsWith(RELEASE_POLICY_SECTION + base)).toBe(true);
    expect(prompt).toContain(PROJECT_MEMORY_HEADING);
  });

  it('omits the section when there is no memory context (memory off or nothing relevant)', () => {
    for (const mc of [undefined, null, '']) {
      const prompt = injectContext(base, { specDir: '', projectDir: '/p', memoryContext: mc });
      expect(prompt).not.toContain('PROJECT MEMORY');
      expect(prompt).toBe(RELEASE_POLICY_SECTION + base);
    }
  });
});

describe('injectContext — human input', () => {
  it('adds HUMAN_INPUT.md content last, after project instructions and the base prompt', () => {
    const prompt = injectContext(base, {
      specDir: '',
      projectDir: '/p',
      projectInstructions: 'Team rules',
      humanInput: 'Skip the migration subtask.',
    });

    const human = prompt.indexOf('## HUMAN INPUT (READ THIS FIRST!)');
    expect(human).toBeGreaterThanOrEqual(0);
    expect(prompt.indexOf('Skip the migration subtask.')).toBeGreaterThan(human);
    expect(prompt.indexOf('## PROJECT INSTRUCTIONS')).toBeLessThan(human);
    expect(prompt.indexOf('# PLANNER PROMPT')).toBeLessThan(human);
  });

  it('omits the section when there is no human input', () => {
    expect(injectContext(base, { specDir: '', projectDir: '/p', humanInput: null })).toBe(RELEASE_POLICY_SECTION + base);
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
      expect(prompt).toBe(RELEASE_POLICY_SECTION + base);
    }
  });
});

describe('injectContext — release policy', () => {
  it('always adds the RELEASE POLICY, right after core values and before everything else', () => {
    const prompt = injectContext(base, {
      specDir: '/p/.malvy/specs/001',
      projectDir: '/p',
      coreValues: '- No ads.',
      projectInstructions: 'Team rules',
    });
    const policy = prompt.indexOf('## RELEASE POLICY');
    expect(policy).toBeGreaterThan(prompt.indexOf('- No ads.'));
    expect(policy).toBeLessThan(prompt.indexOf('## PROJECT INSTRUCTIONS'));
    expect(policy).toBeLessThan(prompt.indexOf('## SPEC LOCATION'));
    expect(prompt).toContain('git push');
    expect(prompt).toContain('TestFlight');
  });

  it('is first when there are no core values', () => {
    expect(injectContext(base, { specDir: '', projectDir: '/p' }).startsWith('## RELEASE POLICY')).toBe(true);
  });
});

describe('injectContext — prompt-cache ordering', () => {
  const stable = {
    projectDir: '/p',
    coreValues: '- No ads.',
    projectInstructions: 'Team rules',
  };

  it('puts stable sections first and task-specific sections after the base prompt', () => {
    const prompt = injectContext(base, {
      ...stable,
      specDir: '/p/.malvy/specs/001',
      memoryContext,
      humanInput: 'Do X',
    });
    const order = [
      '## CORE VALUES',
      '## RELEASE POLICY',
      '## PROJECT INSTRUCTIONS',
      '# PLANNER PROMPT',
      PROJECT_MEMORY_HEADING,
      '## SPEC LOCATION',
      '## HUMAN INPUT',
    ].map((marker) => prompt.indexOf(marker));
    expect(order.every((pos) => pos >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('shares the whole stable prefix (through the base prompt) between different tasks', () => {
    const a = injectContext(base, { ...stable, specDir: '/p/.malvy/specs/001', humanInput: 'A' });
    const b = injectContext(base, { ...stable, specDir: '/p/.malvy/specs/002', memoryContext });
    const prefixEnd = a.indexOf(base) + base.length;
    expect(b.slice(0, prefixEnd)).toBe(a.slice(0, prefixEnd));
    expect(a.slice(0, prefixEnd)).not.toContain('specs/001');
  });
});

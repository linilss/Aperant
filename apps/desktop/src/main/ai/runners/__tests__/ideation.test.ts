import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks — must be declared before any imports that use them
// =============================================================================

/** One stream-json line the fake `claude` CLI prints on stdout */
type CliEvent = Record<string, unknown>;

/** Decides what the fake CLI prints (strings are printed raw) and its exit code for a given prompt */
type Responder = (prompt: string, args: string[]) => { events: Array<CliEvent | string>; code?: number; stderr?: string };

const assistantText = (text: string): CliEvent => ({
  type: 'assistant',
  message: { content: [{ type: 'text', text }] },
});

let responder: Responder = () => ({ events: [assistantText('ideas')] });

const spawnCalls: Array<{ cmd: string; args: string[]; prompt: string; options: Record<string, unknown> }> = [];
let lastChild: (EventEmitter & { kill: ReturnType<typeof vi.fn> }) | null = null;

const mockSpawn = vi.fn((cmd: string, args: string[], options: Record<string, unknown>) => {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: (s: string) => void; end: () => void };
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => {
    setImmediate(() => child.emit('close', null));
  });
  lastChild = child;
  let prompt = '';
  child.stdin = {
    write: (s: string) => {
      prompt += s;
    },
    end: () => {
      spawnCalls.push({ cmd, args, prompt, options });
      const { events, code = 0, stderr } = responder(prompt, args);
      if (code === -1) return; // never closes on its own (used for abort tests)
      setImmediate(() => {
        for (const event of events) {
          const line = typeof event === 'string' ? event : JSON.stringify(event);
          child.stdout.emit('data', Buffer.from(`${line}\n`));
        }
        if (stderr) child.stderr.emit('data', Buffer.from(stderr));
        child.emit('close', code);
      });
    },
  };
  return child;
});

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...(args as [string, string[], Record<string, unknown>])),
}));

const mockFindExecutableAsync = vi.fn();
vi.mock('../../../env-utils', () => ({
  getAugmentedEnvAsync: vi.fn().mockResolvedValue({ PATH: '/usr/bin' }),
  findExecutableAsync: (...args: unknown[]) => mockFindExecutableAsync(...args),
}));

vi.mock('../../../claude-profile-manager', () => ({
  getClaudeProfileManager: () => ({ getActiveProfileEnv: () => ({ CLAUDE_CONFIG_DIR: '/profile' }) }),
}));

// The project's Claude account (unpinned project → active profile env)
vi.mock('../../../claude-profile/project-profile', () => ({
  getProjectProfileEnv: () => ({ CLAUDE_CONFIG_DIR: '/profile' }),
}));

const mockResolveModelId = vi.fn((shorthand: string) => `model-${shorthand}`);
vi.mock('../../config/phase-config', () => ({
  resolveModelId: (shorthand: string) => mockResolveModelId(shorthand),
}));

// Filesystem mocks: prompt files exist by default
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

// =============================================================================
// Import after mocking
// =============================================================================

import { runIdeation, buildFocusSection, IDEATION_TYPES, IDEATION_TYPE_LABELS, IDEATION_TYPE_PROMPTS } from '../ideation';
import { ALL_IDEATION_TYPES } from '../../../../shared/constants/ideation';
import type { IdeationConfig, IdeationStreamEvent } from '../ideation';

// =============================================================================
// Helpers
// =============================================================================

function baseConfig(overrides: Partial<IdeationConfig> = {}): IdeationConfig {
  return {
    projectDir: '/project',
    outputDir: '/project/.malvy/ideation',
    promptsDir: '/prompts',
    ideationType: 'code_improvements',
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('runIdeation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spawnCalls.length = 0;
    lastChild = null;
    responder = () => ({ events: [assistantText('ideas')] });
    // Prompt files exist; core values are not set unless a test says so
    mockExistsSync.mockImplementation((p: string) => !String(p).endsWith('core-values.md'));
    mockReadFileSync.mockReturnValue('# Ideation prompt');
    mockFindExecutableAsync.mockResolvedValue('/usr/bin/claude');
  });

  it('exports all expected IDEATION_TYPES', () => {
    expect(IDEATION_TYPES).toEqual([
      'features',
      'code_improvements',
      'ui_ux_improvements',
      'documentation_gaps',
      'security_hardening',
      'performance_optimizations',
      'code_quality',
    ]);
  });

  it('exports human-readable labels for all ideation types', () => {
    for (const type of IDEATION_TYPES) {
      expect(IDEATION_TYPE_LABELS[type]).toBeTruthy();
    }
  });

  it('returns success with accumulated text from the CLI stream', async () => {
    responder = () => ({ events: [assistantText('Hello '), assistantText('world')] });

    const result = await runIdeation(baseConfig());

    expect(result).toEqual({ success: true, text: 'Hello world' });
  });

  it('falls back to the result event text when no assistant text was streamed', async () => {
    responder = () => ({ events: [{ type: 'result', result: 'final summary' }] });

    const result = await runIdeation(baseConfig());

    expect(result.text).toBe('final summary');
  });

  it('adds the ranked directions from the Competitors page to the prompt', async () => {
    mockReadFileSync.mockImplementation((path: string) =>
      String(path).endsWith('strategy.json')
        ? JSON.stringify({
            directions: [
              { id: 'dir-a', title: 'Coach-first', avoid: false, note: 'Core bet' },
              { id: 'dir-b', title: 'Cheapest', avoid: true, note: '' },
            ],
            ranking_saved_at: '2026-10-01T00:00:00.000Z',
          })
        : '# Ideation prompt',
    );

    await runIdeation(baseConfig());

    const prompt = spawnCalls[0].prompt;
    expect(prompt).toContain('STRATEGIC DIRECTION');
    expect(prompt).toContain('1. Coach-first');
    expect(prompt).toContain('Core bet');
    expect(prompt).toMatch(/Steer away from[\s\S]*Cheapest/);
  });

  it('opens the prompt with the core values, above the strategy guidance', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((path: string) => {
      const p = String(path);
      if (p.endsWith('core-values.md')) return '- Calm over flashy.';
      if (p.endsWith('strategy.json')) {
        return JSON.stringify({
          directions: [{ id: 'dir-a', title: 'Coach-first', avoid: false }],
          ranking_saved_at: '2026-10-01T00:00:00.000Z',
        });
      }
      return '# Ideation prompt';
    });

    await runIdeation(baseConfig());

    const prompt = spawnCalls[0].prompt;
    expect(prompt.startsWith('## CORE VALUES (highest priority')).toBe(true);
    expect(prompt).toContain('- Calm over flashy.');
    expect(prompt.indexOf('- Calm over flashy.')).toBeLessThan(prompt.indexOf('# Ideation prompt'));
    expect(prompt.indexOf('CORE VALUES')).toBeLessThan(prompt.indexOf('STRATEGIC DIRECTION'));
    expect(prompt.split('## CORE VALUES')).toHaveLength(2);
  });

  it('adds no core values section when none are set', async () => {
    await runIdeation(baseConfig());

    expect(spawnCalls[0].prompt).not.toContain('CORE VALUES');
  });

  it('adds no strategy section without a saved ranking', async () => {
    await runIdeation(baseConfig());

    expect(spawnCalls[0].prompt).not.toContain('STRATEGIC DIRECTION');
  });

  it('spawns the claude CLI in stream-json mode with sonnet by default', async () => {
    await runIdeation(baseConfig());

    expect(mockResolveModelId).toHaveBeenCalledWith('sonnet');
    expect(spawnCalls).toHaveLength(1);
    const { cmd, args, options } = spawnCalls[0];
    expect(cmd).toBe('/usr/bin/claude');
    expect(args).toEqual(expect.arrayContaining(['--print', '--verbose', '--output-format', 'stream-json']));
    expect(args).toEqual(expect.arrayContaining(['--allowedTools', 'Read,Glob,Grep,Write']));
    expect(args).toEqual(expect.arrayContaining(['--model', 'model-sonnet']));
    expect(options.cwd).toBe('/project');
    expect(options.env).toEqual(expect.objectContaining({ PATH: '/usr/bin', CLAUDE_CONFIG_DIR: '/profile' }));
  });

  it('accepts a custom modelShorthand', async () => {
    await runIdeation(baseConfig({ modelShorthand: 'opus' }));

    expect(mockResolveModelId).toHaveBeenCalledWith('opus');
    expect(spawnCalls[0].args).toEqual(expect.arrayContaining(['--model', 'model-opus']));
  });

  it('forwards text-delta and tool-use events to onStream', async () => {
    responder = () => ({
      events: [
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'thinking' },
              { type: 'tool_use', name: 'Read' },
            ],
          },
        },
      ],
    });
    const events: IdeationStreamEvent[] = [];

    await runIdeation(baseConfig(), (e) => events.push(e));

    expect(events).toEqual([
      { type: 'text-delta', text: 'thinking' },
      { type: 'tool-use', name: 'Read' },
    ]);
  });

  it('forwards error_during_execution result events as error events', async () => {
    responder = () => ({ events: [{ type: 'result', subtype: 'error_during_execution', error: 'boom' }] });
    const events: IdeationStreamEvent[] = [];

    await runIdeation(baseConfig(), (e) => events.push(e));

    expect(events).toContainEqual({ type: 'error', error: 'boom' });
  });

  it('ignores non-JSON stdout lines', async () => {
    responder = () => ({ events: ['not json', assistantText('ok')] });

    const result = await runIdeation(baseConfig());

    expect(result).toEqual({ success: true, text: 'ok' });
  });

  it('returns failure when the prompt file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await runIdeation(baseConfig());

    expect(result.success).toBe(false);
    expect(result.error).toContain('Prompt not found');
    expect(spawnCalls).toHaveLength(0);
  });

  it('returns failure when the prompt file cannot be read', async () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('EACCES');
    });

    const result = await runIdeation(baseConfig());

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to read prompt');
    expect(result.error).toContain('EACCES');
  });

  it('returns failure when the claude CLI is not installed', async () => {
    mockFindExecutableAsync.mockResolvedValue(null);

    const result = await runIdeation(baseConfig());

    expect(result.success).toBe(false);
    expect(result.error).toContain('claude CLI not found');
    expect(spawnCalls).toHaveLength(0);
  });

  it('returns failure with the is_error result text when the CLI exits non-zero', async () => {
    responder = () => ({
      events: [assistantText('partial'), { type: 'result', is_error: true, result: 'Not logged in' }],
      code: 1,
      stderr: 'some warning',
    });
    const events: IdeationStreamEvent[] = [];

    const result = await runIdeation(baseConfig(), (e) => events.push(e));

    expect(result.success).toBe(false);
    expect(result.text).toBe('partial');
    expect(result.error).toContain('Not logged in');
    expect(events).toContainEqual({ type: 'error', error: result.error });
  });

  it('falls back to stderr when the CLI exits non-zero without an error result', async () => {
    responder = () => ({ events: [], code: 2, stderr: 'fatal: crashed\n' });

    const result = await runIdeation(baseConfig());

    expect(result.success).toBe(false);
    expect(result.error).toContain('fatal: crashed');
  });

  it('kills the CLI and returns failure when aborted', async () => {
    responder = () => ({ events: [], code: -1 });
    const controller = new AbortController();

    const promise = runIdeation(baseConfig({ abortSignal: controller.signal }));
    await vi.waitFor(() => expect(spawnCalls).toHaveLength(1));
    controller.abort();
    const result = await promise;

    expect(lastChild?.kill).toHaveBeenCalledWith('SIGTERM');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Aborted');
  });

  it('includes projectDir, outputDir and maxIdeasPerType in the prompt sent on stdin', async () => {
    await runIdeation(baseConfig({ maxIdeasPerType: 7 }));

    const { prompt } = spawnCalls[0];
    expect(prompt).toContain('# Ideation prompt');
    expect(prompt).toContain('**Output Directory**: /project/.malvy/ideation');
    expect(prompt).toContain('**Project Directory**: /project');
    expect(prompt).toContain('**Max Ideas**: 7');
    expect(prompt).toContain('generate up to 7 code improvements ideas');
  });

  it('loads the prompt file mapped to the ideation type', async () => {
    await runIdeation(baseConfig({ ideationType: 'security_hardening' }));

    expect(mockReadFileSync).toHaveBeenCalledWith('/prompts/ideation_security.md', 'utf-8');
  });
  describe('existing-work context and direction tags', () => {
    const roadmapJson = JSON.stringify({
      features: [
        { id: 'f-1', title: 'Offline mode', priority: 'must', status: 'planned', description: 'x'.repeat(300) },
        { id: 'f-2', title: 'Dark theme', priority: 'could', status: 'done', description: 'Theme' },
      ],
    });

    beforeEach(() => {
      mockReadFileSync.mockImplementation((path: string) => {
        const p = String(path);
        if (p.endsWith('roadmap.json')) return roadmapJson;
        if (p.endsWith('strategy.json')) {
          return JSON.stringify({
            directions: [
              { id: 'dir-a', title: 'Coach-first', avoid: false },
              { id: 'dir-b', title: 'Cheapest', avoid: true },
            ],
            ranking_saved_at: '2026-10-01T00:00:00.000Z',
          });
        }
        return '# Ideation prompt';
      });
    });

    const tasks = [
      { title: 'Add login', status: 'in_progress' },
      { title: 'Fix crash', status: 'backlog' },
    ];

    it('adds roadmap features only when includeRoadmapContext is on', async () => {
      await runIdeation(baseConfig({ includeRoadmapContext: true }));
      const prompt = spawnCalls[0].prompt;
      expect(prompt).toContain('EXISTING ROADMAP FEATURES');
      expect(prompt).toContain('- [must/planned] Offline mode');
      expect(prompt).toContain('- [could/done] Dark theme');
      expect(prompt).not.toContain('x'.repeat(100));

      await runIdeation(baseConfig({ includeRoadmapContext: false }));
      expect(spawnCalls[1].prompt).not.toContain('EXISTING ROADMAP FEATURES');
    });

    it('adds kanban tasks only when includeKanbanContext is on', async () => {
      await runIdeation(baseConfig({ includeKanbanContext: true, existingTasks: tasks }));
      const prompt = spawnCalls[0].prompt;
      expect(prompt).toContain('EXISTING TASKS');
      expect(prompt).toContain('- [in_progress] Add login');

      await runIdeation(baseConfig({ includeKanbanContext: false, existingTasks: tasks }));
      expect(spawnCalls[1].prompt).not.toContain('EXISTING TASKS');
    });

    it('adds no existing-work context by default', async () => {
      await runIdeation(baseConfig());
      const prompt = spawnCalls[0].prompt;
      expect(prompt).not.toContain('EXISTING ROADMAP FEATURES');
      expect(prompt).not.toContain('EXISTING TASKS');
    });

    it('lists direction ids so each idea can be tagged with direction_ids', async () => {
      await runIdeation(baseConfig());
      const prompt = spawnCalls[0].prompt;
      expect(prompt).toContain('DIRECTION TAGS');
      expect(prompt).toContain('"dir-a" #1 Coach-first');
      expect(prompt).toContain('"dir-b" #2 Cheapest (AVOID)');
      expect(prompt).toContain('"direction_ids"');
    });
  });

  describe('features type', () => {
    it('loads ideation_features.md for the features type', async () => {
      await runIdeation(baseConfig({ ideationType: 'features' }));

      expect(mockReadFileSync).toHaveBeenCalledWith('/prompts/ideation_features.md', 'utf-8');
      expect(spawnCalls[0].prompt).toContain('generate up to 5 features ideas');
    });

    it('maps every ideation type (UI list included) to a prompt file that exists', async () => {
      const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
      const realPath = await vi.importActual<typeof import('node:path')>('node:path');
      const promptsDir = realPath.resolve(__dirname, '../../../../../prompts');
      expect([...IDEATION_TYPES].sort()).toEqual([...ALL_IDEATION_TYPES].sort());
      for (const type of IDEATION_TYPES) {
        expect(realFs.existsSync(realPath.join(promptsDir, IDEATION_TYPE_PROMPTS[type]))).toBe(true);
      }
    });

    it('features prompt writes features_ideas.json with the FeatureIdea fields', async () => {
      const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
      const realPath = await vi.importActual<typeof import('node:path')>('node:path');
      const text = realFs.readFileSync(realPath.resolve(__dirname, '../../../../../prompts/ideation_features.md'), 'utf-8');
      expect(text).toContain('{output_dir}/features_ideas.json');
      for (const field of ['"user_value"', '"target_users"', '"complexity"', '"impact"', '"direction_ids"']) {
        expect(text).toContain(field);
      }
    });
  });

  describe('focus from the user', () => {
    const HEADING = '## FOCUS FROM THE USER (steer ideas toward this; core values still win on conflict)';

    it.each(IDEATION_TYPES)('adds the focus section for %s', async (ideationType) => {
      await runIdeation(baseConfig({ ideationType, focus: '  Keep 4-year-olds playing longer  ' }));

      const prompt = spawnCalls[0].prompt;
      expect(prompt).toContain(`${HEADING}\nKeep 4-year-olds playing longer\n`);
      expect(prompt.split(HEADING)).toHaveLength(2);
    });

    it('places the focus after core values and strategy guidance, before direction tags', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path: string) => {
        const p = String(path);
        if (p.endsWith('core-values.md')) return '- Calm over flashy.';
        if (p.endsWith('strategy.json')) {
          return JSON.stringify({
            directions: [{ id: 'dir-a', title: 'Coach-first', avoid: false }],
            ranking_saved_at: '2026-10-01T00:00:00.000Z',
          });
        }
        return '# Ideation prompt';
      });

      await runIdeation(baseConfig({ ideationType: 'features', focus: 'offline play' }));

      const prompt = spawnCalls[0].prompt;
      const focusAt = prompt.indexOf(HEADING);
      expect(prompt.indexOf('CORE VALUES')).toBeLessThan(focusAt);
      expect(prompt.indexOf('STRATEGIC DIRECTION')).toBeLessThan(focusAt);
      expect(focusAt).toBeLessThan(prompt.indexOf('DIRECTION TAGS'));
    });

    it.each([undefined, '', '   \n '])('adds no focus section for %j', async (focus) => {
      await runIdeation(baseConfig({ focus }));

      expect(spawnCalls[0].prompt).not.toContain('FOCUS FROM THE USER');
    });

    it('caps the focus at 1000 characters', () => {
      const section = buildFocusSection('a'.repeat(1500));
      expect(section).toContain('a'.repeat(1000));
      expect(section).not.toContain('a'.repeat(1001));
      expect(buildFocusSection(42)).toBe('');
    });
  });
});

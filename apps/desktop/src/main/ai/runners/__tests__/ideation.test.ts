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

import { runIdeation, IDEATION_TYPES, IDEATION_TYPE_LABELS } from '../ideation';
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
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('# Ideation prompt');
    mockFindExecutableAsync.mockResolvedValue('/usr/bin/claude');
  });

  it('exports all expected IDEATION_TYPES', () => {
    expect(IDEATION_TYPES).toEqual([
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
});

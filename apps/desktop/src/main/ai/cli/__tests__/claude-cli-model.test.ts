/**
 * Tests for the claude-CLI-backed LanguageModelV3 adapter.
 * runClaudeCliDetailed is mocked — no CLI process is spawned.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateText, Output, streamText, tool } from 'ai';
import type { LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { z } from 'zod';

vi.mock('../claude-cli', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../claude-cli')>();
  return { ...actual, runClaudeCliDetailed: vi.fn() };
});

import { ClaudeCliNotFoundError, runClaudeCliDetailed } from '../claude-cli';
import type { ClaudeCliOptions, ClaudeCliResult } from '../claude-cli';
import {
  createClaudeCliModel,
  createConcurrencyLimiter,
  extractJsonText,
  flattenPrompt,
  mapToolsToCli,
  MAX_CONCURRENT_CLI_PROCESSES,
} from '../claude-cli-model';

const mockRun = vi.mocked(runClaudeCliDetailed);

const cliResult = (overrides: Partial<ClaudeCliResult> = {}): ClaudeCliResult => ({
  text: 'hello',
  resultText: 'hello',
  usage: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 2, cacheCreationInputTokens: 3 },
  totalCostUsd: 0.001,
  numTurns: 1,
  stopReason: 'end_turn',
  ...overrides,
});

const lastCliOptions = (): ClaudeCliOptions => mockRun.mock.calls[mockRun.mock.calls.length - 1][0];

const userPrompt = (text: string): LanguageModelV3CallOptions['prompt'] => [
  { role: 'user', content: [{ type: 'text', text }] },
];

function fakeDirectModel() {
  const model = {
    specificationVersion: 'v3' as const,
    provider: 'anthropic.messages',
    modelId: 'claude-haiku-4-5',
    supportedUrls: {},
    doGenerate: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'direct' }],
      finishReason: { unified: 'stop', raw: 'end_turn' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
    doStream: vi.fn(),
  };
  return model as typeof model & LanguageModelV3;
}

const readTool = tool({
  description: 'Read a file',
  inputSchema: z.object({ file_path: z.string() }),
  execute: async () => 'content',
});

beforeEach(() => {
  mockRun.mockReset();
  mockRun.mockResolvedValue(cliResult());
});

// =============================================================================
// Prompt flattening
// =============================================================================

describe('flattenPrompt', () => {
  it('passes a lone user message through and collects system messages', () => {
    const result = flattenPrompt({
      prompt: [{ role: 'system', content: 'Be terse.' }, ...userPrompt('Write a title')],
    });
    expect(result.systemPrompt).toBe('Be terse.');
    expect(result.prompt).toBe('Write a title');
  });

  it('adds role markers for a multi-message conversation', () => {
    const result = flattenPrompt({
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] },
        { role: 'user', content: [{ type: 'text', text: 'Summarize' }] },
      ],
    });
    expect(result.systemPrompt).toBeUndefined();
    expect(result.prompt).toContain('<user>\nHi\n</user>');
    expect(result.prompt).toContain('<assistant>\nHello!\n</assistant>');
    expect(result.prompt).toContain('<user>\nSummarize\n</user>');
  });

  it('includes the JSON schema instruction for responseFormat json', () => {
    const schema = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } as const;
    const result = flattenPrompt({
      prompt: [{ role: 'system', content: 'Sys' }, ...userPrompt('Go')],
      responseFormat: { type: 'json', schema },
    });
    expect(result.systemPrompt).toContain('Sys');
    expect(result.systemPrompt).toContain('single valid JSON value');
    expect(result.systemPrompt).toContain(JSON.stringify(schema));
  });
});

describe('extractJsonText', () => {
  it('keeps plain JSON, strips code fences and surrounding prose', () => {
    expect(extractJsonText(' {"a":1} ')).toBe('{"a":1}');
    expect(extractJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonText('Here you go:\n{"a":{"b":[1]}}\nDone.')).toBe('{"a":{"b":[1]}}');
    expect(extractJsonText('not json')).toBe('not json');
  });
});

describe('mapToolsToCli', () => {
  it('maps builtin tools to CLI tools and reports custom tools', () => {
    const result = mapToolsToCli([
      { type: 'function', name: 'Read', inputSchema: {} },
      { type: 'function', name: 'Grep', inputSchema: {} },
      { type: 'function', name: 'update_subtask_status', inputSchema: {} },
    ]);
    expect(result).toEqual({ cliTools: ['Read', 'Grep'], unsupported: ['update_subtask_status'] });
  });

  it('ignores tools when toolChoice is none', () => {
    expect(mapToolsToCli([{ type: 'function', name: 'custom', inputSchema: {} }], { type: 'none' })).toEqual({
      cliTools: [],
      unsupported: [],
    });
  });
});

// =============================================================================
// doGenerate
// =============================================================================

describe('createClaudeCliModel — doGenerate', () => {
  it('runs the CLI with system prompt, model, cwd and no tools (1 turn)', async () => {
    const model = createClaudeCliModel({ modelId: 'claude-haiku-4-5', cwd: '/project' });
    const result = await generateText({ model, system: 'You name things.', prompt: 'Name a fruit' });

    expect(result.text).toBe('hello');
    const options = lastCliOptions();
    expect(options.systemPrompt).toBe('You name things.');
    expect(options.prompt).toBe('Name a fruit');
    expect(options.modelId).toBe('claude-haiku-4-5');
    expect(options.cwd).toBe('/project');
    expect(options.allowedTools).toEqual([]);
    expect(options.restrictTools).toBe(true);
    expect(options.minimalContext).toBe(true);
    expect(options.maxTurns).toBe(1);
  });

  it('defaults cwd to the home directory', async () => {
    const { homedir } = await import('node:os');
    await generateText({ model: createClaudeCliModel({ modelId: 'm' }), prompt: 'x' });
    expect(lastCliOptions().cwd).toBe(homedir());
  });

  it('maps usage from the CLI result event', async () => {
    const model = createClaudeCliModel({ modelId: 'm' });
    const result = await model.doGenerate({ prompt: userPrompt('x') });
    expect(result.usage.inputTokens).toEqual({ total: 15, noCache: 10, cacheRead: 2, cacheWrite: 3 });
    expect(result.usage.outputTokens.total).toBe(5);
    expect(result.usage.raw).toEqual({ totalCostUsd: 0.001, numTurns: 1 });
  });

  it('returns the final message text (not earlier tool-turn narration)', async () => {
    mockRun.mockResolvedValue(cliResult({ text: 'Let me look.Final answer', resultText: 'Final answer' }));
    const result = await generateText({ model: createClaudeCliModel({ modelId: 'm' }), prompt: 'x' });
    expect(result.text).toBe('Final answer');
  });

  it('supports Output.object(): schema in the prompt, fenced JSON parsed by the SDK', async () => {
    mockRun.mockResolvedValue(cliResult({ resultText: '```json\n{"title":"Fix login"}\n```' }));
    const result = await generateText({
      model: createClaudeCliModel({ modelId: 'm' }),
      prompt: 'Title this',
      output: Output.object({ schema: z.object({ title: z.string() }) }),
    });
    expect(result.output).toEqual({ title: 'Fix login' });
    expect(lastCliOptions().systemPrompt).toContain('"title"');
  });

  it('maps SDK builtin tools to CLI allowedTools and lets the CLI run them', async () => {
    const model = createClaudeCliModel({ modelId: 'm', cwd: '/repo', maxTurns: 30 });
    const result = await generateText({ model, prompt: 'Explore', tools: { Read: readTool, Glob: readTool } });

    expect(result.text).toBe('hello');
    expect(result.toolCalls).toEqual([]);
    expect(lastCliOptions().allowedTools).toEqual(['Read', 'Glob']);
    expect(lastCliOptions().maxTurns).toBe(30);
  });

  it('delegates calls with custom tools to the direct fallback model', async () => {
    const direct = fakeDirectModel();
    const model = createClaudeCliModel({ modelId: 'm', fallbackModel: direct });
    const result = await generateText({ model, prompt: 'x', tools: { Read: readTool, record_gotcha: readTool } });

    expect(result.text).toBe('direct');
    expect(direct.doGenerate).toHaveBeenCalledTimes(1);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('throws for custom tools when no fallback model is configured', async () => {
    const model = createClaudeCliModel({ modelId: 'm' });
    await expect(model.doGenerate({
      prompt: userPrompt('x'),
      tools: [{ type: 'function', name: 'record_gotcha', inputSchema: {} }],
    })).rejects.toThrow(/record_gotcha/);
  });

  it('falls back to the direct model when the claude CLI is not installed', async () => {
    mockRun.mockRejectedValue(new ClaudeCliNotFoundError());
    const direct = fakeDirectModel();
    const result = await generateText({ model: createClaudeCliModel({ modelId: 'm', fallbackModel: direct }), prompt: 'x' });
    expect(result.text).toBe('direct');
  });

  it('propagates CLI failures', async () => {
    mockRun.mockRejectedValue(new Error('claude CLI failed: rate limited'));
    const model = createClaudeCliModel({ modelId: 'm' });
    await expect(model.doGenerate({ prompt: userPrompt('x') })).rejects.toThrow('rate limited');
  });
});

// =============================================================================
// doStream
// =============================================================================

async function collect(stream: ReadableStream<LanguageModelV3StreamPart>): Promise<LanguageModelV3StreamPart[]> {
  const parts: LanguageModelV3StreamPart[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return parts;
    parts.push(value);
  }
}

describe('createClaudeCliModel — doStream', () => {
  it('streams CLI text deltas as text-start/text-delta/text-end + finish', async () => {
    mockRun.mockImplementation(async (options) => {
      options.onTextBlockStart?.();
      options.onText?.('Hel');
      options.onText?.('lo');
      return cliResult();
    });
    const model = createClaudeCliModel({ modelId: 'm' });
    const { stream } = await model.doStream({ prompt: userPrompt('x') });
    const parts = await collect(stream);

    expect(parts.map((p) => p.type)).toEqual(['stream-start', 'text-start', 'text-delta', 'text-delta', 'text-end', 'finish']);
    expect(lastCliOptions().partialMessages).toBe(true);
    const finish = parts[parts.length - 1];
    expect(finish.type === 'finish' && finish.usage.outputTokens.total).toBe(5);
  });

  it('separates text blocks from successive turns', async () => {
    mockRun.mockImplementation(async (options) => {
      options.onTextBlockStart?.();
      options.onText?.('Looking.');
      options.onTextBlockStart?.();
      options.onText?.('Done.');
      return cliResult();
    });
    const result = streamText({ model: createClaudeCliModel({ modelId: 'm' }), prompt: 'x' });
    expect(await result.text).toBe('Looking.\n\nDone.');
  });

  it('emits only the final JSON for structured output', async () => {
    mockRun.mockImplementation(async (options) => {
      options.onText?.('narration that must not leak');
      return cliResult({ text: 'narration', resultText: 'Result: {"title":"X"}' });
    });
    const result = streamText({
      model: createClaudeCliModel({ modelId: 'm' }),
      prompt: 'x',
      output: Output.object({ schema: z.object({ title: z.string() }) }),
    });
    expect(await result.output).toEqual({ title: 'X' });
    expect(await result.text).toBe('{"title":"X"}');
    expect(lastCliOptions().partialMessages).toBe(false);
  });

  it('emits an error part and an error finish when the CLI fails', async () => {
    mockRun.mockRejectedValue(new Error('boom'));
    const { stream } = await createClaudeCliModel({ modelId: 'm' }).doStream({ prompt: userPrompt('x') });
    const parts = await collect(stream);
    expect(parts.some((p) => p.type === 'error')).toBe(true);
    const finish = parts[parts.length - 1];
    expect(finish.type === 'finish' && finish.finishReason.unified).toBe('error');
  });

  it('delegates streams with custom tools to the fallback model', async () => {
    const direct = fakeDirectModel();
    const fallbackStream = new ReadableStream<LanguageModelV3StreamPart>({ start: (c) => c.close() });
    direct.doStream.mockResolvedValue({ stream: fallbackStream });
    const model = createClaudeCliModel({ modelId: 'm', fallbackModel: direct });
    const result = await model.doStream({
      prompt: userPrompt('x'),
      tools: [{ type: 'function', name: 'SpawnSubagent', inputSchema: {} }],
    });
    expect(result.stream).toBe(fallbackStream);
    expect(mockRun).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Concurrency
// =============================================================================

describe('createConcurrencyLimiter', () => {
  it('runs at most N tasks at once and queues the rest in order', async () => {
    const limiter = createConcurrencyLimiter(2);
    const releases: Array<() => void> = [];
    const started: number[] = [];
    const task = (id: number) => limiter.run(() => new Promise<number>((resolve) => {
      started.push(id);
      releases.push(() => resolve(id));
    }));

    const results = [task(1), task(2), task(3), task(4)];
    await Promise.resolve();
    expect(started).toEqual([1, 2]);
    expect(limiter.active).toBe(2);
    expect(limiter.pending).toBe(2);

    releases[0]();
    await results[0];
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual([1, 2, 3]);

    releases[1]();
    releases[2]();
    await new Promise((r) => setTimeout(r, 0));
    releases[3]();
    expect(await Promise.all(results)).toEqual([1, 2, 3, 4]);
    expect(limiter.active).toBe(0);
  });

  it('releases the slot when a task throws', async () => {
    const limiter = createConcurrencyLimiter(1);
    await expect(limiter.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(await limiter.run(async () => 'ok')).toBe('ok');
  });

  it('caps concurrent CLI processes started by the adapter', async () => {
    let running = 0;
    let peak = 0;
    mockRun.mockImplementation(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return cliResult();
    });
    const model = createClaudeCliModel({ modelId: 'm' });
    await Promise.all(Array.from({ length: 8 }, () => model.doGenerate({ prompt: userPrompt('x') })));
    expect(mockRun).toHaveBeenCalledTimes(8);
    expect(peak).toBe(MAX_CONCURRENT_CLI_PROCESSES);
  });
});

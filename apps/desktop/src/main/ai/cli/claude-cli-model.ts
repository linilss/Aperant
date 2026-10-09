/**
 * Claude CLI Language Model
 * =========================
 *
 * A Vercel AI SDK `LanguageModelV3` backed by the `claude` CLI (see claude-cli.ts).
 *
 * Claude subscription (OAuth) credentials get HTTP 429 when used directly against
 * api.anthropic.com, so `createSimpleClient()` swaps the direct Anthropic model for
 * this adapter. Call sites keep using `generateText()` / `streamText()` unchanged:
 *
 * - System + messages are flattened into a system-prompt file and a stdin prompt.
 * - Structured output (`Output.object()` → responseFormat json) is requested by
 *   embedding the JSON schema in the system prompt; the reply is trimmed to the JSON
 *   value and the SDK parses/validates it. (`--json-schema` is deliberately not used:
 *   it forces an extra StructuredOutput tool round-trip that re-sends the whole prompt.)
 * - SDK tools with a CLI built-in equivalent (Read, Glob, Grep, …) are executed by the
 *   CLI itself via `--tools`/`--allowedTools`; the model returns only the final text,
 *   never tool-call parts. Calls that need any other tool are delegated to
 *   `fallbackModel` (the direct API model), as are calls when the CLI isn't installed.
 * - A global limiter caps concurrent CLI processes so parallel runners don't storm.
 */

import { homedir } from 'node:os';

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3Message,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
  SharedV3Warning,
} from '@ai-sdk/provider';
import type { LanguageModel } from 'ai';

import { ClaudeCliNotFoundError, runClaudeCliDetailed } from './claude-cli';
import type { ClaudeCliOptions, ClaudeCliResult } from './claude-cli';

// =============================================================================
// Concurrency limiter
// =============================================================================

export interface ConcurrencyLimiter {
  run<T>(fn: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly pending: number;
}

export function createConcurrencyLimiter(maxConcurrent: number): ConcurrencyLimiter {
  let active = 0;
  const waiting: Array<() => void> = [];

  const release = () => {
    active--;
    const next = waiting.shift();
    if (next) next();
  };

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (active >= maxConcurrent) {
        await new Promise<void>((resolve) => waiting.push(resolve));
      }
      active++;
      try {
        return await fn();
      } finally {
        release();
      }
    },
    get active() {
      return active;
    },
    get pending() {
      return waiting.length;
    },
  };
}

/** Max concurrent `claude` processes started through the adapter */
export const MAX_CONCURRENT_CLI_PROCESSES = 3;

const cliLimiter = createConcurrencyLimiter(MAX_CONCURRENT_CLI_PROCESSES);

// =============================================================================
// Tool mapping
// =============================================================================

/** App builtin tools (ai/tools/builtin) that have a same-named Claude Code built-in */
export const CLI_EQUIVALENT_TOOLS: ReadonlySet<string> = new Set([
  'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Bash', 'Write', 'Edit',
]);

/**
 * Split the call's tools into CLI built-ins and tools the CLI can't run.
 * `toolChoice: none` means the model may not use any tool.
 */
export function mapToolsToCli(
  tools: LanguageModelV3CallOptions['tools'],
  toolChoice?: LanguageModelV3CallOptions['toolChoice'],
): { cliTools: string[]; unsupported: string[] } {
  if (!tools || tools.length === 0 || toolChoice?.type === 'none') {
    return { cliTools: [], unsupported: [] };
  }
  const cliTools: string[] = [];
  const unsupported: string[] = [];
  for (const tool of tools) {
    if (tool.type === 'function' && CLI_EQUIVALENT_TOOLS.has(tool.name)) {
      cliTools.push(tool.name);
    } else {
      unsupported.push(tool.name);
    }
  }
  return { cliTools, unsupported };
}

// =============================================================================
// Prompt flattening
// =============================================================================

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function renderFilePart(part: { mediaType: string; filename?: string; data: unknown }): string {
  const name = part.filename ?? 'file';
  if (part.mediaType.startsWith('text/')) {
    // V3 file data is base64 (string), bytes, or a URL
    let text: string | undefined;
    if (typeof part.data === 'string') text = Buffer.from(part.data, 'base64').toString('utf-8');
    else if (part.data instanceof Uint8Array) text = Buffer.from(part.data).toString('utf-8');
    if (text !== undefined) return `<file name="${name}" type="${part.mediaType}">\n${text}\n</file>`;
  }
  if (part.data instanceof URL) return `[attached file "${name}" (${part.mediaType}): ${part.data.href}]`;
  return `[attached file "${name}" (${part.mediaType}) omitted]`;
}

function renderMessageContent(message: LanguageModelV3Message): string {
  if (message.role === 'system') return message.content;
  const parts: string[] = [];
  for (const part of message.content) {
    switch (part.type) {
      case 'text':
        parts.push(part.text);
        break;
      case 'file':
        parts.push(renderFilePart(part));
        break;
      case 'reasoning':
        break; // prior reasoning isn't replayed
      case 'tool-call':
        parts.push(`[tool call ${part.toolName}: ${stringifyValue(part.input)}]`);
        break;
      case 'tool-result':
        parts.push(`[tool result ${part.toolName}: ${stringifyValue('value' in part.output ? part.output.value : part.output)}]`);
        break;
      default:
        break;
    }
  }
  return parts.join('\n\n');
}

/** Instruction appended to the system prompt for responseFormat json */
export function buildJsonInstruction(responseFormat: LanguageModelV3CallOptions['responseFormat']): string | undefined {
  if (responseFormat?.type !== 'json') return undefined;
  const lines = [
    '# Output format',
    'Your final answer MUST be a single valid JSON value and nothing else: no prose before or after it, no Markdown code fences.',
  ];
  if (responseFormat.name || responseFormat.description) {
    lines.push(`It describes: ${[responseFormat.name, responseFormat.description].filter(Boolean).join(' — ')}`);
  }
  if (responseFormat.schema) {
    lines.push('It must conform to this JSON Schema:', JSON.stringify(responseFormat.schema));
  }
  return lines.join('\n');
}

/**
 * Flatten the SDK prompt into a system prompt and a single stdin prompt.
 * A lone user message is passed through as-is; a conversation gets role markers.
 */
export function flattenPrompt(options: Pick<LanguageModelV3CallOptions, 'prompt' | 'responseFormat'>): {
  systemPrompt: string | undefined;
  prompt: string;
} {
  const systemParts: string[] = [];
  const conversation: LanguageModelV3Message[] = [];
  for (const message of options.prompt) {
    if (message.role === 'system') systemParts.push(message.content);
    else conversation.push(message);
  }

  const jsonInstruction = buildJsonInstruction(options.responseFormat);
  if (jsonInstruction) systemParts.push(jsonInstruction);

  let prompt: string;
  if (conversation.length === 1 && conversation[0].role === 'user') {
    prompt = renderMessageContent(conversation[0]);
  } else {
    prompt = [
      ...conversation.map((m) => `<${m.role}>\n${renderMessageContent(m)}\n</${m.role}>`),
      'Continue the conversation above: reply to the last message as the assistant.',
    ].join('\n\n');
  }

  return {
    systemPrompt: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    prompt,
  };
}

// =============================================================================
// Result mapping
// =============================================================================

/** Trim a reply down to its JSON value (strips code fences and surrounding prose). */
export function extractJsonText(text: string): string {
  const trimmed = text.trim();
  const isJson = (candidate: string) => {
    try {
      JSON.parse(candidate);
      return true;
    } catch {
      return false;
    }
  };
  if (isJson(trimmed)) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenced && isJson(fenced[1].trim())) return fenced[1].trim();

  const start = trimmed.search(/[[{]/);
  if (start !== -1) {
    const close = trimmed[start] === '{' ? '}' : ']';
    const end = trimmed.lastIndexOf(close);
    if (end > start && isJson(trimmed.slice(start, end + 1))) return trimmed.slice(start, end + 1);
  }
  return trimmed;
}

export function toV3Usage(result: Pick<ClaudeCliResult, 'usage' | 'totalCostUsd' | 'numTurns'>): LanguageModelV3Usage {
  const usage = result.usage;
  if (!usage) {
    return {
      inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: undefined, text: undefined, reasoning: undefined },
    };
  }
  const reasoning = usage.thinkingTokens;
  return {
    inputTokens: {
      total: usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens,
      noCache: usage.inputTokens,
      cacheRead: usage.cacheReadInputTokens,
      cacheWrite: usage.cacheCreationInputTokens,
    },
    outputTokens: {
      total: usage.outputTokens,
      text: reasoning !== undefined ? Math.max(0, usage.outputTokens - reasoning) : usage.outputTokens,
      reasoning,
    },
    raw: {
      ...(result.totalCostUsd !== undefined ? { totalCostUsd: result.totalCostUsd } : {}),
      ...(result.numTurns !== undefined ? { numTurns: result.numTurns } : {}),
    },
  };
}

function toFinishReason(stopReason: string | undefined): LanguageModelV3FinishReason {
  return { unified: stopReason === 'max_tokens' ? 'length' : 'stop', raw: stopReason };
}

function collectWarnings(options: LanguageModelV3CallOptions): SharedV3Warning[] {
  const ignored = ['temperature', 'topP', 'topK', 'seed', 'presencePenalty', 'frequencyPenalty', 'maxOutputTokens', 'stopSequences'] as const;
  return ignored
    .filter((key) => options[key] !== undefined)
    .map((feature) => ({ type: 'unsupported' as const, feature, details: 'Ignored when running through the claude CLI' }));
}

// =============================================================================
// Model
// =============================================================================

export interface ClaudeCliModelOptions {
  /** Full Anthropic model id (shorthands already resolved) */
  modelId: string;
  /** Working directory for the CLI and its tools (defaults to the home dir) */
  cwd?: string;
  /** Max agentic turns when the call uses tools (calls without tools use 1) */
  maxTurns?: number;
  /** Explicit CLI env (worker threads); defaults to the active Claude profile env */
  env?: Record<string, string | undefined>;
  /**
   * Direct API model used for calls the CLI can't serve: tools without a CLI
   * equivalent, or no `claude` executable installed.
   */
  fallbackModel?: LanguageModel;
}

/** Default turn budget for tool-using calls */
const DEFAULT_TOOL_MAX_TURNS = 50;

interface PreparedCall {
  cliOptions: ClaudeCliOptions;
  jsonMode: boolean;
  warnings: SharedV3Warning[];
}

function asV3Model(model: LanguageModel | undefined): LanguageModelV3 | undefined {
  if (model && typeof model === 'object' && model.specificationVersion === 'v3') {
    return model as LanguageModelV3;
  }
  return undefined;
}

/** Identifies models created by createClaudeCliModel() */
export const CLAUDE_CLI_PROVIDER = 'claude-cli';

export function createClaudeCliModel(modelOptions: ClaudeCliModelOptions): LanguageModelV3 {
  const fallback = asV3Model(modelOptions.fallbackModel);

  const prepare = (options: LanguageModelV3CallOptions): PreparedCall | { delegate: LanguageModelV3 } => {
    const { cliTools, unsupported } = mapToolsToCli(options.tools, options.toolChoice);
    if (unsupported.length > 0) {
      if (!fallback) {
        throw new Error(
          `Tools without a claude CLI equivalent (${unsupported.join(', ')}) need a direct API model, but none was configured`,
        );
      }
      return { delegate: fallback };
    }
    const { systemPrompt, prompt } = flattenPrompt(options);
    return {
      jsonMode: options.responseFormat?.type === 'json',
      warnings: collectWarnings(options),
      cliOptions: {
        prompt,
        systemPrompt,
        cwd: modelOptions.cwd ?? homedir(),
        modelId: modelOptions.modelId,
        allowedTools: cliTools,
        restrictTools: true,
        minimalContext: true,
        maxTurns: cliTools.length > 0 ? (modelOptions.maxTurns ?? DEFAULT_TOOL_MAX_TURNS) : 1,
        abortSignal: options.abortSignal,
        env: modelOptions.env,
      },
    };
  };

  const finalText = (result: ClaudeCliResult, jsonMode: boolean): string => {
    // Like generateText's `text`, return the final assistant message, not the narration
    // from earlier tool-using turns.
    const text = result.resultText || result.text;
    return jsonMode ? extractJsonText(text) : text;
  };

  return {
    specificationVersion: 'v3',
    provider: CLAUDE_CLI_PROVIDER,
    modelId: modelOptions.modelId,
    supportedUrls: {},

    async doGenerate(options): Promise<LanguageModelV3GenerateResult> {
      const prepared = prepare(options);
      if ('delegate' in prepared) return prepared.delegate.doGenerate(options);

      let result: ClaudeCliResult;
      try {
        result = await cliLimiter.run(() => runClaudeCliDetailed(prepared.cliOptions));
      } catch (error) {
        if (error instanceof ClaudeCliNotFoundError && fallback) return fallback.doGenerate(options);
        throw error;
      }

      return {
        content: [{ type: 'text', text: finalText(result, prepared.jsonMode) }],
        finishReason: toFinishReason(result.stopReason),
        usage: toV3Usage(result),
        warnings: prepared.warnings,
        response: { modelId: modelOptions.modelId, timestamp: new Date() },
      };
    },

    async doStream(options): Promise<LanguageModelV3StreamResult> {
      const prepared = prepare(options);
      if ('delegate' in prepared) return prepared.delegate.doStream(options);

      const { jsonMode, warnings, cliOptions } = prepared;
      const textId = '0';

      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        start: async (controller) => {
          let streamStarted = false;
          let textStarted = false;
          let emittedText = false;
          const ensureStarted = () => {
            if (streamStarted) return;
            controller.enqueue({ type: 'stream-start', warnings });
            streamStarted = true;
          };
          const emit = (delta: string) => {
            if (!delta) return;
            ensureStarted();
            if (!textStarted) {
              controller.enqueue({ type: 'text-start', id: textId });
              textStarted = true;
            }
            controller.enqueue({ type: 'text-delta', id: textId, delta });
            emittedText = true;
          };

          try {
            const result = await cliLimiter.run(() =>
              runClaudeCliDetailed({
                ...cliOptions,
                // JSON replies are emitted once at the end (trimmed to the JSON value)
                partialMessages: !jsonMode,
                onText: jsonMode ? undefined : emit,
                onTextBlockStart: jsonMode ? undefined : () => {
                  if (emittedText) emit('\n\n');
                },
              }),
            );
            if (jsonMode || !emittedText) emit(finalText(result, jsonMode));
            ensureStarted();
            if (textStarted) controller.enqueue({ type: 'text-end', id: textId });
            controller.enqueue({
              type: 'finish',
              usage: toV3Usage(result),
              finishReason: toFinishReason(result.stopReason),
            });
          } catch (error) {
            if (error instanceof ClaudeCliNotFoundError && fallback && !streamStarted) {
              // Nothing was emitted yet — hand the whole call to the direct API model
              try {
                const reader = (await fallback.doStream(options)).stream.getReader();
                for (;;) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  controller.enqueue(value);
                }
              } catch (fallbackError) {
                controller.enqueue({ type: 'error', error: fallbackError });
              }
              controller.close();
              return;
            }
            ensureStarted();
            if (textStarted) controller.enqueue({ type: 'text-end', id: textId });
            controller.enqueue({ type: 'error', error });
            controller.enqueue({
              type: 'finish',
              usage: toV3Usage({}),
              finishReason: { unified: 'error', raw: undefined },
            });
          }
          controller.close();
        },
      });

      return { stream };
    },
  };
}

/** True for models created by createClaudeCliModel() */
export function isClaudeCliModel(model: LanguageModel): boolean {
  return typeof model === 'object' && model.provider === CLAUDE_CLI_PROVIDER;
}

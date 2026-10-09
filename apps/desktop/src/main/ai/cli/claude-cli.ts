/**
 * Claude CLI Runner
 * =================
 *
 * Runs a one-shot prompt through `claude --print --output-format stream-json`.
 *
 * Use this instead of calling api.anthropic.com via the Vercel AI SDK when the user
 * authenticates with a Claude subscription (OAuth): direct calls share the
 * subscription quota with Claude Code and get rejected with HTTP 429, while the CLI
 * manages its own rate-limit backoff — the same path Agent Terminals use.
 *
 * Main-process-only modules (env-utils, claude-profile-manager) are imported lazily so
 * the runner can also be used from worker threads by passing an explicit `env`.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findExecutable } from '../../platform';

export interface ClaudeCliOptions {
  /** Full prompt (system instructions + task), written to stdin */
  prompt: string;
  /** Working directory; the CLI's tools resolve relative paths against it */
  cwd: string;
  /** Full model id, e.g. from resolveModelId() */
  modelId: string;
  /** Tools the CLI may use, e.g. ['Read', 'Glob', 'Grep'] for read-only work */
  allowedTools: string[];
  /** Upper bound on agentic turns (`--max-turns`) */
  maxTurns?: number;
  abortSignal?: AbortSignal;
  onText?: (text: string) => void;
  onToolUse?: (name: string, input: Record<string, unknown>) => void;
  /**
   * Replaces Claude Code's default system prompt (written to a temp file and passed
   * via `--system-prompt-file`, so long prompts don't hit OS argument-length limits).
   */
  systemPrompt?: string;
  /**
   * Restrict the built-in tool set to exactly `allowedTools` (`--tools`), so the model
   * isn't offered tools it may not use. An empty list disables all tools.
   */
  restrictTools?: boolean;
  /**
   * Skip user/project settings, plugins and MCP servers and don't persist the session.
   * Makes one-shot calls behave like a plain API call and keeps the prompt small.
   */
  minimalContext?: boolean;
  /**
   * With `minimalContext`: still load the project's CLAUDE.md and CLAUDE.local.md
   * (team docs + Malvy's .malvy/docs and pointers via imports) from `cwd`.
   */
  projectContext?: boolean;
  /**
   * Stream token-level text deltas (`--include-partial-messages`) instead of one
   * `onText` call per finished text block.
   */
  partialMessages?: boolean;
  /** Called when a new text block starts (partial mode only) */
  onTextBlockStart?: () => void;
  /**
   * Explicit env for the CLI process (merged over process.env). When given, the
   * active Claude profile env is NOT looked up — required in worker threads.
   */
  env?: Record<string, string | undefined>;
}

/** Token usage reported by the CLI's final `result` event */
export interface ClaudeCliUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  thinkingTokens?: number;
}

export interface ClaudeCliResult {
  /** All streamed assistant text, concatenated (falls back to `resultText`) */
  text: string;
  /** Text of the final assistant message, from the `result` event */
  resultText: string;
  usage?: ClaudeCliUsage;
  totalCostUsd?: number;
  numTurns?: number;
  stopReason?: string;
}

/** Thrown when the `claude` executable can't be found */
export class ClaudeCliNotFoundError extends Error {
  constructor() {
    super('claude CLI not found — make sure Claude Code is installed');
    this.name = 'ClaudeCliNotFoundError';
  }
}

/** Runs the prompt and resolves to the assistant's full text output. */
export async function runClaudeCli(options: ClaudeCliOptions): Promise<string> {
  return (await runClaudeCliDetailed(options)).text;
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parseUsage(raw: unknown): ClaudeCliUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const usage = raw as Record<string, unknown>;
  const details = usage.output_tokens_details as Record<string, unknown> | undefined;
  return {
    inputTokens: toNumber(usage.input_tokens),
    outputTokens: toNumber(usage.output_tokens),
    cacheReadInputTokens: toNumber(usage.cache_read_input_tokens),
    cacheCreationInputTokens: toNumber(usage.cache_creation_input_tokens),
    ...(details && typeof details.thinking_tokens === 'number' ? { thinkingTokens: details.thinking_tokens } : {}),
  };
}

async function resolveSpawnContext(
  env: Record<string, string | undefined> | undefined,
): Promise<{ claudePath: string | null; spawnEnv: Record<string, string | undefined> }> {
  if (env) {
    return { claudePath: findExecutable('claude'), spawnEnv: { ...process.env, ...env } };
  }
  const [{ getAugmentedEnvAsync, findExecutableAsync }, { getClaudeProfileManager }] = await Promise.all([
    import('../../env-utils'),
    import('../../claude-profile-manager'),
  ]);
  const [augmentedEnv, claudePath] = await Promise.all([getAugmentedEnvAsync(), findExecutableAsync('claude')]);
  return { claudePath, spawnEnv: { ...augmentedEnv, ...getClaudeProfileManager().getActiveProfileEnv() } };
}

/** Runs the prompt and resolves to the full text plus usage/cost from the `result` event. */
export async function runClaudeCliDetailed(options: ClaudeCliOptions): Promise<ClaudeCliResult> {
  const {
    prompt, cwd, modelId, allowedTools, maxTurns, abortSignal, onText, onToolUse,
    systemPrompt, restrictTools, minimalContext, projectContext, partialMessages, onTextBlockStart,
  } = options;

  const { claudePath, spawnEnv } = await resolveSpawnContext(options.env);
  if (!claudePath) {
    throw new ClaudeCliNotFoundError();
  }
  if (abortSignal?.aborted) {
    throw new Error('Aborted');
  }

  let tempDir: string | undefined;
  const args = [
    '--print',
    '--verbose',
    '--output-format', 'stream-json',
    ...(allowedTools.length > 0 ? ['--allowedTools', allowedTools.join(',')] : []),
    ...(restrictTools ? ['--tools', allowedTools.join(',')] : []),
    '--model', modelId,
    ...(maxTurns ? ['--max-turns', String(maxTurns)] : []),
    ...(minimalContext
      ? ['--strict-mcp-config', '--setting-sources', projectContext ? 'project,local' : '', '--no-session-persistence']
      : []),
    ...(partialMessages ? ['--include-partial-messages'] : []),
  ];

  try {
    if (systemPrompt) {
      tempDir = await mkdtemp(join(tmpdir(), 'malvy-cli-'));
      const systemPromptFile = join(tempDir, 'system-prompt.md');
      await writeFile(systemPromptFile, systemPrompt, 'utf-8');
      args.push('--system-prompt-file', systemPromptFile);
    }

    return await spawnAndCollect(claudePath, args, {
      cwd, prompt, spawnEnv, abortSignal, onText, onToolUse, partialMessages, onTextBlockStart,
    });
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

interface SpawnOptions {
  cwd: string;
  prompt: string;
  spawnEnv: Record<string, string | undefined>;
  abortSignal?: AbortSignal;
  onText?: (text: string) => void;
  onToolUse?: (name: string, input: Record<string, unknown>) => void;
  partialMessages?: boolean;
  onTextBlockStart?: () => void;
}

async function spawnAndCollect(claudePath: string, args: string[], options: SpawnOptions): Promise<ClaudeCliResult> {
  const { cwd, prompt, spawnEnv, abortSignal, onText, onToolUse, partialMessages, onTextBlockStart } = options;

  const child = spawn(claudePath, args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: spawnEnv,
  });

  child.stdin.write(prompt, 'utf-8');
  child.stdin.end();

  let fullText = '';
  let stdoutBuffer = '';
  let stderrOutput = '';
  const result: Omit<ClaudeCliResult, 'text'> = { resultText: '' };
  // Fatal CLI errors (e.g. an expired login) arrive as an is_error result event on
  // stdout; stderr often only holds unrelated warnings.
  let resultError = '';

  const emitText = (text: string) => {
    if (!text) return;
    fullText += text;
    onText?.(text);
  };

  const handleStreamEvent = (event: Record<string, unknown>) => {
    if (event.type === 'content_block_start') {
      const block = event.content_block as Record<string, unknown> | undefined;
      if (block?.type === 'text') onTextBlockStart?.();
    } else if (event.type === 'content_block_delta') {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta?.type === 'text_delta') emitText(String(delta.text ?? ''));
    }
  };

  const handleLine = (line: string) => {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return; // not JSON — progress output
    }

    if (event.type === 'stream_event') {
      // Sub-agent (Task) output also streams here; only forward the top-level reply
      if (partialMessages && !event.parent_tool_use_id) {
        handleStreamEvent((event.event ?? {}) as Record<string, unknown>);
      }
    } else if (event.type === 'assistant') {
      const message = event.message as Record<string, unknown> | undefined;
      const content = (message?.content ?? []) as Array<Record<string, unknown>>;
      for (const block of content) {
        if (block.type === 'text') {
          // In partial mode the text already arrived as deltas
          if (!partialMessages) emitText(String(block.text ?? ''));
        } else if (block.type === 'tool_use') {
          onToolUse?.(String(block.name ?? 'unknown'), (block.input ?? {}) as Record<string, unknown>);
        }
      }
    } else if (event.type === 'result') {
      if (event.result) result.resultText = String(event.result);
      result.usage = parseUsage(event.usage);
      if (typeof event.total_cost_usd === 'number') result.totalCostUsd = event.total_cost_usd;
      if (typeof event.num_turns === 'number') result.numTurns = event.num_turns;
      if (typeof event.stop_reason === 'string') result.stopReason = event.stop_reason;
      if (event.is_error === true || event.subtype === 'error_during_execution') {
        resultError = String(event.error ?? event.result ?? 'CLI error');
      }
    }
  };

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf-8');
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) handleLine(trimmed);
    }
  });

  child.stderr.on('data', (chunk: Buffer) => {
    stderrOutput += chunk.toString('utf-8');
  });

  const abortHandler = () => child.kill('SIGTERM');
  abortSignal?.addEventListener('abort', abortHandler);

  await new Promise<void>((resolve, reject) => {
    child.on('close', (code) => {
      abortSignal?.removeEventListener('abort', abortHandler);
      if (stdoutBuffer.trim()) handleLine(stdoutBuffer.trim());

      if (abortSignal?.aborted) {
        reject(new Error('Aborted'));
      } else if (code !== 0 || resultError) {
        reject(new Error(`claude CLI failed: ${resultError || stderrOutput.trim() || `exit code ${code}`}`));
      } else {
        resolve();
      }
    });
    child.on('error', (err) => {
      abortSignal?.removeEventListener('abort', abortHandler);
      reject(err);
    });
  });

  // The final result event holds the last assistant message; prefer the streamed text
  return { ...result, text: fullText || result.resultText };
}

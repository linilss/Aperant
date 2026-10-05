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
 */

import { spawn } from 'node:child_process';

import { getAugmentedEnvAsync, findExecutableAsync } from '../../env-utils';
import { getClaudeProfileManager } from '../../claude-profile-manager';

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
}

/** Runs the prompt and resolves to the assistant's full text output. */
export async function runClaudeCli(options: ClaudeCliOptions): Promise<string> {
  const { prompt, cwd, modelId, allowedTools, maxTurns, abortSignal, onText, onToolUse } = options;

  const [augmentedEnv, claudePath] = await Promise.all([getAugmentedEnvAsync(), findExecutableAsync('claude')]);
  if (!claudePath) {
    throw new Error('claude CLI not found — make sure Claude Code is installed');
  }
  if (abortSignal?.aborted) {
    throw new Error('Aborted');
  }

  const args = [
    '--print',
    '--verbose',
    '--output-format', 'stream-json',
    '--allowedTools', allowedTools.join(','),
    '--model', modelId,
    ...(maxTurns ? ['--max-turns', String(maxTurns)] : []),
  ];

  const child = spawn(claudePath, args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...augmentedEnv, ...getClaudeProfileManager().getActiveProfileEnv() },
  });

  child.stdin.write(prompt, 'utf-8');
  child.stdin.end();

  let fullText = '';
  let resultText = '';
  let stdoutBuffer = '';
  let stderrOutput = '';
  // Fatal CLI errors (e.g. an expired login) arrive as an is_error result event on
  // stdout; stderr often only holds unrelated warnings.
  let resultError = '';

  const handleLine = (line: string) => {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return; // not JSON — progress output
    }

    if (event.type === 'assistant') {
      const message = event.message as Record<string, unknown> | undefined;
      const content = (message?.content ?? []) as Array<Record<string, unknown>>;
      for (const block of content) {
        if (block.type === 'text') {
          const text = String(block.text ?? '');
          if (text) {
            fullText += text;
            onText?.(text);
          }
        } else if (block.type === 'tool_use') {
          onToolUse?.(String(block.name ?? 'unknown'), (block.input ?? {}) as Record<string, unknown>);
        }
      }
    } else if (event.type === 'result') {
      if (event.result) resultText = String(event.result);
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
  return fullText || resultText;
}

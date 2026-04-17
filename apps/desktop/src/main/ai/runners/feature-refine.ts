/**
 * Feature Refine Runner
 * =====================
 *
 * Conversational AI session for refining a feature idea through three phases:
 * 1. GRILL — probing questions to fully understand the feature
 * 2. PRD   — structured Product Requirements Document
 * 3. PLAN  — vertical slice implementation phases
 *
 * Uses `claude --print --verbose --output-format stream-json` so that it shares
 * the CLI's rate-limit management and doesn't collide with the OAuth quota used
 * by the Vercel AI SDK path.
 */

import { spawn } from 'node:child_process';

import { findExecutable } from '../../platform';
import { resolveModelId } from '../config/phase-config';
import type { ModelShorthand } from '../config/types';
import { safeParseJson } from '../../utils/json-repair';
import { getClaudeProfileManager } from '../../claude-profile-manager';
import { tryLoadPrompt } from '../prompts/prompt-loader';

// =============================================================================
// Types
// =============================================================================

/** A message in the feature refinement conversation history */
export interface FeatureRefineMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Configuration for running a feature refinement session */
export interface FeatureRefineConfig {
  /** Project directory path */
  projectDir: string;
  /** User message to process */
  message: string;
  /** Previous conversation history */
  history?: FeatureRefineMessage[];
  /** Model shorthand (defaults to 'sonnet') */
  modelShorthand?: ModelShorthand;
  /** Thinking level — unused with CLI path, kept for API compat */
  thinkingLevel?: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

/** Structured feature data extracted from the final plan */
export interface FeatureRefineResult {
  title: string;
  description: string;
  prd: string;
  plan: string;
  acceptanceCriteria: string[];
  userStories: string[];
}

/** Events emitted during feature refinement streaming */
export type FeatureRefineStreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-use'; toolName: string; input: string }
  | { type: 'complete'; text: string; featureData: FeatureRefineResult | null }
  | { type: 'error'; error: string };

/** Callback for streaming events from the feature refine runner */
export type FeatureRefineStreamCallback = (event: FeatureRefineStreamEvent) => void;

// =============================================================================
// Feature Data Extraction
// =============================================================================

/**
 * Extract the <feature_data> JSON block from the assistant's response text.
 * Returns null if the block is absent or malformed.
 */
function extractFeatureData(text: string): FeatureRefineResult | null {
  const match = text.match(/<feature_data>([\s\S]*?)<\/feature_data>/);
  if (!match) return null;

  const parsed = safeParseJson<FeatureRefineResult>(match[1].trim());
  if (!parsed) return null;

  if (
    typeof parsed.title !== 'string' ||
    typeof parsed.description !== 'string' ||
    typeof parsed.prd !== 'string' ||
    typeof parsed.plan !== 'string' ||
    !Array.isArray(parsed.acceptanceCriteria) ||
    !Array.isArray(parsed.userStories)
  ) {
    return null;
  }

  return parsed;
}

// =============================================================================
// Feature Refine Runner
// =============================================================================

/**
 * Run a feature refinement chat turn via the Claude CLI subprocess.
 *
 * Spawns `claude --print --verbose --output-format stream-json` with the full
 * conversation (system prompt + history + new message) written to stdin.
 * Streams text-delta and tool-use events back via the callback, then emits
 * a final complete event.
 *
 * The runner is stateless — the caller accumulates and persists history.
 */
export async function runFeatureRefine(
  config: FeatureRefineConfig,
  onEvent: FeatureRefineStreamCallback,
): Promise<void> {
  const {
    projectDir,
    message,
    history = [],
    modelShorthand = 'sonnet',
    abortSignal,
  } = config;

  const claudePath = await findExecutable('claude');
  if (!claudePath) {
    onEvent({ type: 'error', error: 'claude CLI not found — make sure Claude Code is installed' });
    return;
  }

  // Load system prompt
  const systemPrompt =
    tryLoadPrompt('feature_refine') ??
    'You are a product strategist helping to refine a feature idea into a PRD and implementation plan.';

  // Build the combined prompt: system + conversation history + current message
  const historyBlock =
    history.length > 0
      ? history
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
          .join('\n\n') + '\n\n'
      : '';

  const combinedPrompt = `${systemPrompt}\n\n${historyBlock}User: ${message}`;

  const modelId = resolveModelId(modelShorthand);
  const args = [
    '--print',
    '--verbose',
    '--output-format', 'stream-json',
    '--allowedTools', 'Read,Glob,Grep',
    '--model', modelId,
  ];

  // Merge active Claude profile env so CLI uses the correct account
  const profileEnv = getClaudeProfileManager().getActiveProfileEnv();
  const child = spawn(claudePath, args, {
    cwd: projectDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...profileEnv },
  });

  // Wire abort signal
  const onAbort = () => child.kill('SIGTERM');
  abortSignal?.addEventListener('abort', onAbort, { once: true });

  child.stdin.write(combinedPrompt, 'utf-8');
  child.stdin.end();

  // Drain stderr to prevent the child process from blocking on a full pipe buffer
  child.stderr?.on('data', () => { /* intentionally empty */ });

  let responseText = '';
  let stdoutBuffer = '';

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf-8');
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (event.type === 'assistant') {
        const message = event.message as Record<string, unknown> | undefined;
        const content = (message?.content ?? []) as Array<Record<string, unknown>>;
        for (const block of content) {
          if (block.type === 'text') {
            const text = String(block.text ?? '');
            if (text) {
              responseText += text;
              onEvent({ type: 'text-delta', delta: text });
            }
          } else if (block.type === 'tool_use') {
            const name = String(block.name ?? 'unknown');
            const input = block.input as Record<string, unknown> | undefined;
            const inputSummary = input?.file_path
              ? String(input.file_path)
              : input?.pattern
              ? `pattern: ${input.pattern}`
              : '';
            onEvent({ type: 'tool-use', toolName: name, input: inputSummary });
          }
        }
      } else if (event.type === 'result') {
        // Use result text as fallback if no streaming text was captured
        if (responseText.length === 0 && event.result) {
          responseText = String(event.result);
        }
        if (event.subtype === 'error_during_execution') {
          onEvent({ type: 'error', error: String(event.error ?? event.result ?? 'CLI error') });
        }
      }
    }
  });

  await new Promise<void>((resolve) => {
    child.on('close', () => {
      abortSignal?.removeEventListener('abort', onAbort);
      resolve();
    });
    child.on('error', (err) => {
      abortSignal?.removeEventListener('abort', onAbort);
      onEvent({ type: 'error', error: err.message });
      resolve();
    });
  });

  if (abortSignal?.aborted) return;

  const featureData = extractFeatureData(responseText);
  onEvent({ type: 'complete', text: responseText, featureData });
}

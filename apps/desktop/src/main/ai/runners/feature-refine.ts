/**
 * Feature Refine Runner
 * =====================
 *
 * Conversational AI session for refining a feature idea through three phases:
 * 1. GRILL — probing questions to fully understand the feature
 * 2. PRD   — structured Product Requirements Document
 * 3. PLAN  — vertical slice implementation phases
 *
 * Uses `createSimpleClient()` with read-only tools (Read, Glob, Grep) and streaming.
 * Mirrors the insights runner pattern.
 */

import { streamText, stepCountIs } from 'ai';
import { join } from 'node:path';

import { createSimpleClient } from '../client/factory';
import { buildToolRegistry } from '../tools/build-registry';
import type { ToolContext } from '../tools/types';
import type { ModelShorthand, ThinkingLevel } from '../config/types';
import type { SecurityProfile } from '../security/bash-validator';
import { safeParseJson } from '../../utils/json-repair';
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
  /** Thinking level (defaults to 'medium') */
  thinkingLevel?: ThinkingLevel;
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

  // Validate required fields
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
// Tool Input Extraction Helper
// =============================================================================

/**
 * Extract a brief description from tool call args for UI display.
 */
function extractToolInput(args: Record<string, unknown>): string {
  if (args.pattern) return `pattern: ${args.pattern}`;
  if (args.file_path) {
    const fp = String(args.file_path);
    return fp.length > 50 ? `...${fp.slice(-47)}` : fp;
  }
  if (args.path) return String(args.path);
  return '';
}

// =============================================================================
// Feature Refine Runner
// =============================================================================

/**
 * Run a feature refinement chat turn with streaming.
 *
 * The runner is stateless — it takes the full conversation history on each call
 * and streams events back via the callback. The caller is responsible for
 * accumulating and persisting history.
 *
 * @param config   - Feature refine session configuration
 * @param onEvent  - Callback for streaming events
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
    thinkingLevel = 'medium',
    abortSignal,
  } = config;

  // Load system prompt from prompts/feature_refine.md
  const systemPrompt =
    tryLoadPrompt('feature_refine') ??
    'You are a product strategist helping to refine a feature idea into a PRD and implementation plan.';

  // Build conversation messages from history + current user message.
  // We inline history as a formatted block (same approach as insights.ts) so
  // that providers without native multi-turn message arrays still work.
  let fullPrompt = message;
  if (history.length > 0) {
    const conversationContext = history
      .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n\n');
    fullPrompt = `Previous conversation:\n${conversationContext}\n\nUser: ${message}`;
  }

  // Create tool context — read-only tools only (no Write/Edit/Bash)
  const toolContext: ToolContext = {
    cwd: projectDir,
    projectDir,
    specDir: join(projectDir, '.auto-claude', 'specs'),
    securityProfile: null as unknown as SecurityProfile,
    abortSignal,
  };

  // Bind tools via registry — use 'insights' agent type which grants Read, Glob, Grep
  const registry = buildToolRegistry();
  const tools = registry.getToolsForAgent('insights', toolContext);

  // Create simple client
  const client = await createSimpleClient({
    systemPrompt,
    modelShorthand,
    thinkingLevel,
    maxSteps: 200,
    tools,
  });

  // Detect Codex models — they require instructions via providerOptions, not system
  const modelId = typeof client.model === 'string' ? client.model : client.model.modelId;
  const isCodex = modelId?.includes('codex') ?? false;

  let responseText = '';

  try {
    const result = streamText({
      model: client.model,
      system: isCodex ? undefined : client.systemPrompt,
      prompt: fullPrompt,
      tools: client.tools,
      stopWhen: stepCountIs(200),
      abortSignal,
      ...(isCodex
        ? {
            providerOptions: {
              openai: {
                instructions: client.systemPrompt,
                store: false,
              },
            },
          }
        : {}),
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta': {
          responseText += part.text;
          onEvent({ type: 'text-delta', delta: part.text });
          break;
        }
        case 'tool-call': {
          const args = 'input' in part ? (part.input as Record<string, unknown>) : {};
          const input = extractToolInput(args);
          onEvent({ type: 'tool-use', toolName: part.toolName, input });
          break;
        }
        case 'error': {
          const errorMsg =
            part.error instanceof Error ? part.error.message : String(part.error);
          onEvent({ type: 'error', error: errorMsg });
          return;
        }
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    onEvent({ type: 'error', error: errorMsg });
    return;
  }

  // Extract feature data if present (only emitted on final plan approval)
  const featureData = extractFeatureData(responseText);

  onEvent({ type: 'complete', text: responseText, featureData });
}

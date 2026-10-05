/**
 * AI Configuration Types
 *
 * See apps/desktop/src/main/ai/config/types.ts and apps/desktop/src/shared/constants/models.ts.
 * Provides model resolution maps, thinking budget configuration, and phase config types
 * for the Vercel AI SDK integration layer.
 */

import type { SupportedProvider } from '../providers/types';

// ============================================
// Model Shorthand Types
// ============================================

/** Valid model shorthands used throughout the application */
export type ModelShorthand =
  | 'fable'
  | 'opus'
  | 'opus-5.5'
  | 'opus-5'
  | 'opus-4.8'
  | 'opus-4.7'
  | 'opus-1m'
  | 'opus-4.5'
  | 'sonnet'
  | 'sonnet-5'
  | 'sonnet-4.6'
  | 'haiku';

/** Valid thinking levels */
export type ThinkingLevel = 'low' | 'medium' | 'high' | 'xhigh';

/** Valid effort levels for adaptive thinking models */
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh';

/** Execution phases for task pipeline */
export type Phase = 'spec' | 'planning' | 'coding' | 'qa';

// ============================================
// Model ID Mapping (mirrors phase_config.py)
// ============================================

/**
 * Model shorthand to full model ID mapping.
 * Must stay in sync with:
 * - apps/desktop/src/main/ai/config/types.ts MODEL_ID_MAP
 * - apps/desktop/src/shared/constants/models.ts MODEL_ID_MAP
 */
export const MODEL_ID_MAP: Record<ModelShorthand, string> = {
  // 'opus' and 'sonnet' always track the newest model in their tier — pin a
  // version-suffixed shorthand ('opus-4.7', 'sonnet-4.6') to stay on an older one.
  fable: 'claude-fable-5',
  opus: 'claude-opus-5-5',
  'opus-5.5': 'claude-opus-5-5',
  'opus-5': 'claude-opus-5',
  'opus-4.8': 'claude-opus-4-8',
  'opus-4.7': 'claude-opus-4-7',
  'opus-1m': 'claude-opus-4-6',
  'opus-4.5': 'claude-opus-4-5-20251101',
  sonnet: 'claude-sonnet-5',
  'sonnet-5': 'claude-sonnet-5',
  'sonnet-4.6': 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
} as const;

/**
 * Model shorthand to required SDK beta headers.
 * Maps model shorthands that need special beta flags (e.g., 1M context window).
 */
export const MODEL_BETAS_MAP: Partial<Record<ModelShorthand, string[]>> = {
  'opus-1m': ['context-1m-2025-08-07'],
} as const;

// ============================================
// Thinking Budget (mirrors phase_config.py)
// ============================================

/**
 * Thinking level to budget tokens mapping.
 * Must stay in sync with:
 * - apps/desktop/src/main/ai/config/types.ts THINKING_BUDGET_MAP
 * - apps/desktop/src/shared/constants/models.ts THINKING_BUDGET_MAP
 */
export const THINKING_BUDGET_MAP: Record<ThinkingLevel, number> = {
  low: 1024,
  medium: 4096,
  high: 16384,
  xhigh: 32768,
} as const;

/**
 * Effort level mapping for adaptive thinking models (e.g., Opus 4.6).
 * These models support effort-based routing.
 */
export const EFFORT_LEVEL_MAP: Record<EffortLevel, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
} as const;

/**
 * Models that reject `budget_tokens` with a 400 — thinking must be adaptive.
 * The fixed thinking-budget concept was removed on these; depth is controlled
 * through the effort level instead.
 */
export const ADAPTIVE_ONLY_THINKING_MODELS: ReadonlySet<string> = new Set([
  'claude-fable-5',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-sonnet-5',
]);

/**
 * Models that support adaptive thinking. A superset of the adaptive-only set:
 * Opus 4.6 and Sonnet 4.6 still accept `budget_tokens`, but adaptive is the
 * recommended mode there too.
 */
export const ADAPTIVE_THINKING_MODELS: ReadonlySet<string> = new Set([
  ...ADAPTIVE_ONLY_THINKING_MODELS,
  'claude-opus-4-6',
  'claude-sonnet-4-6',
]);

/**
 * Models that accept an effort level. Opus 4.5 supports low/medium/high;
 * Haiku 4.5 and Sonnet 4.5 reject the parameter outright.
 */
export const EFFORT_CAPABLE_MODELS: ReadonlySet<string> = new Set([
  ...ADAPTIVE_THINKING_MODELS,
  'claude-opus-4-5-20251101',
]);

/**
 * Thinking level to the effort values the Anthropic provider accepts.
 * @ai-sdk/anthropic exposes low | medium | high | max — it has no 'xhigh',
 * so this app's xhigh maps to the next level up rather than being rejected.
 */
export const ANTHROPIC_EFFORT_MAP: Record<ThinkingLevel, 'low' | 'medium' | 'high' | 'max'> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'max',
} as const;

/** Models that support Fast Mode (`speed: 'fast'`) — removed on Opus 4.7 and earlier */
export const FAST_MODE_MODEL_IDS: ReadonlySet<string> = new Set([
  'claude-opus-5',
  'claude-opus-4-8',
]);

// ============================================
// Phase Configuration Types
// ============================================

/** Per-phase model configuration — values can be shorthands or concrete model IDs */
export interface PhaseModelConfig {
  spec: string;
  planning: string;
  coding: string;
  qa: string;
}

/** Per-phase thinking level configuration */
export interface PhaseThinkingConfig {
  spec: ThinkingLevel;
  planning: ThinkingLevel;
  coding: ThinkingLevel;
  qa: ThinkingLevel;
}

// ============================================
// Default Phase Configurations
// ============================================

/** Default phase models (matches 'Balanced' profile) */
export const DEFAULT_PHASE_MODELS: PhaseModelConfig = {
  spec: 'sonnet',
  planning: 'sonnet',
  coding: 'sonnet',
  qa: 'sonnet',
};

/** Default phase thinking levels */
export const DEFAULT_PHASE_THINKING: PhaseThinkingConfig = {
  spec: 'medium',
  planning: 'high',
  coding: 'medium',
  qa: 'high',
};

// ============================================
// Provider Model Mapping
// ============================================

/**
 * Maps model ID prefixes to their default provider.
 * Used to auto-detect which provider to use for a given model.
 */
export const MODEL_PROVIDER_MAP: Record<string, SupportedProvider> = {
  'claude-': 'anthropic',
  'gpt-': 'openai',
  'o1-': 'openai',
  'o3-': 'openai',
  'o4-': 'openai',
  'codex-': 'openai',           // OpenAI Codex subscription models
  'gemini-': 'google',
  'mistral-': 'mistral',
  'codestral-': 'mistral',
  'llama-': 'groq',
  'grok-': 'xai',
  'glm-': 'zai',
} as const;

// ============================================
// Reasoning Parameter Resolution
// ============================================

import type { ReasoningConfig } from '../../../shared/constants/models';

export function resolveReasoningParams(config: ReasoningConfig): Record<string, unknown> {
  switch (config.type) {
    case 'thinking_tokens':
      return { maxThinkingTokens: THINKING_BUDGET_MAP[config.level ?? 'medium'] };
    case 'adaptive_effort':
      return {
        maxThinkingTokens: THINKING_BUDGET_MAP[config.level ?? 'high'],
        effortLevel: config.level ?? 'high',
      };
    case 'reasoning_effort':
      return { reasoningEffort: config.level ?? 'medium' };
    case 'thinking_toggle':
      return { thinking: config.level !== undefined };
    case 'none':
      return {};
  }
}

/**
 * Detect the provider name from a model ID using prefix matching.
 * Uses MODEL_PROVIDER_MAP for lookup.
 */
function detectProviderFromModelId(modelId: string): SupportedProvider | undefined {
  for (const [prefix, provider] of Object.entries(MODEL_PROVIDER_MAP)) {
    if (modelId.startsWith(prefix)) {
      return provider;
    }
  }
  return undefined;
}

/**
 * Build provider-specific providerOptions for thinking/reasoning tokens.
 * Used by the runner to pass thinking configuration to streamText().
 *
 * @param modelId - Full model ID (e.g., 'claude-opus-4-7', 'o3-mini', 'gemini-2.5-pro')
 * @param thinkingLevel - Configured thinking level
 * @returns Provider-specific options object, or undefined if provider doesn't support thinking
 */
export function buildThinkingProviderOptions(
  modelId: string,
  thinkingLevel: ThinkingLevel,
): Record<string, Record<string, unknown>> | undefined {
  const provider = detectProviderFromModelId(modelId);
  if (!provider) return undefined;

  const budgetTokens = THINKING_BUDGET_MAP[thinkingLevel];

  switch (provider) {
    case 'anthropic': {
      // Adaptive models let Claude decide how much to think; sending budgetTokens
      // to one of them is a 400, so the two modes are mutually exclusive.
      const base: Record<string, unknown> = ADAPTIVE_THINKING_MODELS.has(modelId)
        ? { thinking: { type: 'adaptive' } }
        : { thinking: { type: 'enabled', budgetTokens } };

      if (EFFORT_CAPABLE_MODELS.has(modelId)) {
        base.effort = ANTHROPIC_EFFORT_MAP[thinkingLevel];
      }
      return { anthropic: base };
    }

    case 'openai': {
      if (modelId.startsWith('o1-') || modelId.startsWith('o3-') || modelId.startsWith('o4-')) {
        const effortMap: Record<ThinkingLevel, string> = {
          low: 'low',
          medium: 'medium',
          high: 'high',
          xhigh: 'high',
        };
        return { openai: { reasoningEffort: effortMap[thinkingLevel] } };
      }
      return undefined;
    }

    case 'google': {
      return { google: { thinkingConfig: { thinkingBudget: budgetTokens } } };
    }

    case 'zai': {
      // @ai-sdk/openai-compatible merges providerOptions.openaiCompatible into the request body.
      // Z.AI thinking config uses type: 'enabled'/'disabled' (no budget parameter).
      return { openaiCompatible: { thinking: { type: 'enabled', clear_thinking: false } } };
    }

    default:
      return undefined;
  }
}

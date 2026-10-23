import { describe, it, expect } from 'vitest';
import { buildThinkingProviderOptions } from '../types';
import type { ThinkingLevel } from '../types';

describe('buildThinkingProviderOptions', () => {
  it('should return budget-based thinking for Claude models without adaptive support', () => {
    const result = buildThinkingProviderOptions('claude-haiku-4-5-20251001', 'high');
    expect(result).toEqual({
      anthropic: {
        thinking: { type: 'enabled', budgetTokens: 16384 },
      },
    });
  });

  it('should pair a budget with an effort level on effort-capable legacy models', () => {
    const result = buildThinkingProviderOptions('claude-opus-4-5-20251101', 'high');
    expect(result).toEqual({
      anthropic: {
        thinking: { type: 'enabled', budgetTokens: 16384 },
        effort: 'high',
      },
    });
  });

  it('should handle Anthropic adaptive thinking models', () => {
    const result = buildThinkingProviderOptions('claude-opus-4-6', 'high');
    expect(result).toBeDefined();
    expect(result?.anthropic?.thinking).toBeDefined();
  });

  // budget_tokens is rejected with a 400 on these models — thinking must be adaptive
  it.each([
    'claude-fable-5-1',
    'claude-fable-5',
    'claude-sonnet-5-5',
    'claude-opus-5-5',
    'claude-opus-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-sonnet-5',
    // Prefix matching: future point releases and generations
    'claude-opus-5-6',
    'claude-sonnet-6',
  ])('should use adaptive thinking with an effort level for %s', (modelId) => {
    const result = buildThinkingProviderOptions(modelId, 'high');
    expect(result).toEqual({
      anthropic: {
        thinking: { type: 'adaptive' },
        effort: 'high',
      },
    });
  });

  it.each(['claude-haiku-4-5-20251001', 'claude-3-5-sonnet-20241022'])(
    'should not treat pre-5 model %s as adaptive via the prefix match',
    (modelId) => {
      const result = buildThinkingProviderOptions(modelId, 'high');
      expect(result?.anthropic?.thinking).toEqual({ type: 'enabled', budgetTokens: 16384 });
    },
  );

  it('should map xhigh to max for Anthropic, which has no xhigh effort level', () => {
    const result = buildThinkingProviderOptions('claude-opus-5', 'xhigh');
    expect(result?.anthropic?.effort).toBe('max');
  });

  it('should return undefined for providers without thinking support', () => {
    expect(buildThinkingProviderOptions('gpt-4o', 'high')).toBeUndefined();
    expect(buildThinkingProviderOptions('gemini-2.5-pro', 'high')).toBeUndefined();
    expect(buildThinkingProviderOptions('llama-3.1-70b', 'high')).toBeUndefined();
  });

  it('should return undefined for unknown model IDs', () => {
    expect(buildThinkingProviderOptions('unknown-model', 'high')).toBeUndefined();
  });

  it('should use correct budget for each thinking level', () => {
    const levels: ThinkingLevel[] = ['low', 'medium', 'high', 'xhigh'];
    const budgets = [1024, 4096, 16384, 32768];

    for (let i = 0; i < levels.length; i++) {
      const result = buildThinkingProviderOptions('claude-haiku-4-5-20251001', levels[i]);
      expect((result?.anthropic?.thinking as { budgetTokens: number })?.budgetTokens).toBe(budgets[i]);
    }
  });

  it('should never send a budget to an adaptive-only model', () => {
    const levels: ThinkingLevel[] = ['low', 'medium', 'high', 'xhigh'];
    for (const level of levels) {
      const result = buildThinkingProviderOptions('claude-opus-5', level);
      expect(result?.anthropic?.thinking).not.toHaveProperty('budgetTokens');
    }
  });
});

import { describe, it, expect } from 'vitest';
import { buildThinkingProviderOptions } from '../types';
import type { ThinkingLevel } from '../types';

describe('buildThinkingProviderOptions', () => {
  it('should return Anthropic thinking options for Claude models', () => {
    const result = buildThinkingProviderOptions('claude-sonnet-4-6', 'high');
    expect(result).toEqual({
      anthropic: {
        thinking: { type: 'enabled', budgetTokens: 16384 },
      },
    });
  });

  it('should handle Anthropic adaptive thinking models', () => {
    const result = buildThinkingProviderOptions('claude-opus-4-6', 'high');
    expect(result).toBeDefined();
    expect(result?.anthropic?.thinking).toBeDefined();
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
      const result = buildThinkingProviderOptions('claude-sonnet-4-6', levels[i]);
      expect((result?.anthropic?.thinking as { budgetTokens: number })?.budgetTokens).toBe(budgets[i]);
    }
  });
});

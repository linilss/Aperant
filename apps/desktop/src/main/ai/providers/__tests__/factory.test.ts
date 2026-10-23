/**
 * Tests for Provider Factory
 *
 * Validates provider instantiation, detection, and error handling.
 */

import { describe, expect, it, vi } from 'vitest';

// Mock all @ai-sdk/* providers
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => {
    const provider = vi.fn((modelId: string) => ({ modelId, provider: 'anthropic' }));
    return provider;
  }),
}));

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn(() => {
    const provider = vi.fn((modelId: string) => ({ modelId, provider: 'ollama' }));
    return provider;
  }),
}));

vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: vi.fn(() => {
    const provider = vi.fn((modelId: string) => ({ modelId, provider: 'openrouter' }));
    return provider;
  }),
}));

import { createAnthropic } from '@ai-sdk/anthropic';
import { createProvider, detectProviderFromModel, createProviderFromModelId } from '../factory';
import { SupportedProvider } from '../types';

describe('createProvider', () => {
  const allProviders = Object.values(SupportedProvider);

  it.each(allProviders)('creates a model instance for provider: %s', (provider) => {
    const result = createProvider({
      config: { provider, apiKey: 'test-key' },
      modelId: 'test-model',
    });
    expect(result).toBeDefined();
    expect(result).toHaveProperty('modelId');
  });

  it('passes custom baseURL and headers to provider', () => {
    createProvider({
      config: {
        provider: SupportedProvider.Anthropic,
        apiKey: 'sk-test',
        baseURL: 'https://custom.api.com',
        headers: { 'X-Custom': 'value' },
      },
      modelId: 'claude-sonnet-4-5-20250929',
    });
    expect(createAnthropic).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      baseURL: 'https://custom.api.com',
      headers: { 'X-Custom': 'value' },
    });
  });
});

describe('detectProviderFromModel', () => {
  it('detects Anthropic from claude- prefix', () => {
    expect(detectProviderFromModel('claude-sonnet-4-5-20250929')).toBe('anthropic');
  });

  it('returns undefined for unknown model', () => {
    expect(detectProviderFromModel('unknown-model')).toBeUndefined();
  });
});

describe('createProviderFromModelId', () => {
  it('creates a model with auto-detected provider', () => {
    const result = createProviderFromModelId('claude-sonnet-4-5-20250929') as any;
    expect(result).toBeDefined();
    expect(result.modelId).toBe('claude-sonnet-4-5-20250929');
  });

  it('throws for unrecognized model ID', () => {
    expect(() => createProviderFromModelId('unknown-model-xyz')).toThrow(
      'Cannot detect provider for model "unknown-model-xyz"',
    );
  });

  it('passes overrides to the provider config', () => {
    createProviderFromModelId('claude-sonnet-4-5-20250929', {
      apiKey: 'override-key',
      baseURL: 'https://override.com',
    });
    expect(createAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'override-key',
        baseURL: 'https://override.com',
      }),
    );
  });
});

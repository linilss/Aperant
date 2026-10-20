import { describe, it, expect } from 'vitest';
import {
  getProviderPreset,
  getProviderPresetOrFallback,
  PROVIDER_PRESET_DEFINITIONS,
} from '../models';

describe('getProviderPreset', () => {
  it('returns correct preset for known provider and presetId', () => {
    const result = getProviderPreset('anthropic', 'auto');
    expect(result).not.toBeNull();
    expect(result?.primaryModel).toBe('opus');
    expect(result?.primaryThinking).toBe('high');
  });

  it('returns correct balanced preset for anthropic', () => {
    const result = getProviderPreset('anthropic', 'balanced');
    expect(result).not.toBeNull();
    expect(result?.primaryModel).toBe('sonnet');
    expect(result?.primaryThinking).toBe('medium');
  });

  it('returns null for unknown presetId', () => {
    const result = getProviderPreset('anthropic', 'nonexistent-preset');
    expect(result).toBeNull();
  });

  it('returns null for unknown provider', () => {
    // @ts-expect-error testing unknown provider
    const result = getProviderPreset('unknown-provider', 'auto');
    expect(result).toBeNull();
  });

  it('returns null for a removed provider (openai)', () => {
    // @ts-expect-error provider was pruned
    const result = getProviderPreset('openai', 'auto');
    expect(result).toBeNull();
  });
});

describe('getProviderPresetOrFallback', () => {
  it('returns exact match when provider and preset both exist', () => {
    const result = getProviderPresetOrFallback('anthropic', 'complex');
    expect(result.primaryModel).toBe('opus');
    expect(result.primaryThinking).toBe('high');
    expect(result.phaseThinking.coding).toBe('high');
  });

  it('falls back to anthropic preset when a removed provider is requested', () => {
    // @ts-expect-error provider was pruned
    const result = getProviderPresetOrFallback('openai', 'complex');
    expect(result).toEqual(PROVIDER_PRESET_DEFINITIONS['anthropic']?.['complex']);
  });

  it('falls back to anthropic preset when provider is unknown', () => {
    // @ts-expect-error testing unknown provider to exercise anthropic fallback
    const result = getProviderPresetOrFallback('unknown-provider', 'complex');
    const anthropicComplex = PROVIDER_PRESET_DEFINITIONS['anthropic']?.['complex'];
    expect(result).toEqual(anthropicComplex);
  });

  it('falls back to anthropic auto as ultimate fallback', () => {
    // @ts-expect-error testing unknown provider and preset
    const result = getProviderPresetOrFallback('unknown-provider', 'unknown-preset');
    const anthropicAuto = PROVIDER_PRESET_DEFINITIONS['anthropic']!['auto'];
    expect(result).toEqual(anthropicAuto);
  });

  it('always returns a valid config (never null)', () => {
    const knownCombinations: Array<[Parameters<typeof getProviderPresetOrFallback>[0], string]> = [
      ['anthropic', 'auto'],
      ['anthropic', 'complex'],
      ['anthropic', 'balanced'],
      ['anthropic', 'quick'],
    ];

    for (const [provider, presetId] of knownCombinations) {
      const result = getProviderPresetOrFallback(provider, presetId);
      expect(result).toBeDefined();
      expect(result.primaryModel).toBeTruthy();
      expect(result.phaseModels).toBeDefined();
      expect(result.phaseThinking).toBeDefined();
    }
  });

  it('returned config has all required phase keys', () => {
    const result = getProviderPresetOrFallback('anthropic', 'auto');
    const phaseKeys = ['spec', 'planning', 'coding', 'qa'] as const;
    for (const key of phaseKeys) {
      expect(result.phaseModels[key]).toBeTruthy();
      expect(result.phaseThinking[key]).toBeTruthy();
    }
  });
});

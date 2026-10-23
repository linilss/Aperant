/**
 * Tests for AI Auth Types
 *
 * Validates that exported constants have the correct mappings
 * for environment variables, settings keys, and base URL env vars.
 */

import { describe, expect, it } from 'vitest';
import {
  PROVIDER_ENV_VARS,
  PROVIDER_SETTINGS_KEY,
  PROVIDER_BASE_URL_ENV,
} from '../types';

describe('PROVIDER_ENV_VARS', () => {
  it('maps anthropic to ANTHROPIC_API_KEY', () => {
    expect(PROVIDER_ENV_VARS.anthropic).toBe('ANTHROPIC_API_KEY');
  });

  it('maps openrouter to OPENROUTER_API_KEY', () => {
    expect(PROVIDER_ENV_VARS.openrouter).toBe('OPENROUTER_API_KEY');
  });

  it('maps zai to ZHIPU_API_KEY', () => {
    expect(PROVIDER_ENV_VARS.zai).toBe('ZHIPU_API_KEY');
  });

  it('maps ollama to undefined (no auth required)', () => {
    expect(PROVIDER_ENV_VARS.ollama).toBeUndefined();
  });
});

describe('PROVIDER_SETTINGS_KEY', () => {
  it('maps anthropic to globalAnthropicApiKey', () => {
    expect(PROVIDER_SETTINGS_KEY.anthropic).toBe('globalAnthropicApiKey');
  });

  it('maps openrouter to globalOpenRouterApiKey', () => {
    expect(PROVIDER_SETTINGS_KEY.openrouter).toBe('globalOpenRouterApiKey');
  });

  it('maps zai to globalZAIApiKey', () => {
    expect(PROVIDER_SETTINGS_KEY.zai).toBe('globalZAIApiKey');
  });

  it('does not have a key for ollama', () => {
    expect(PROVIDER_SETTINGS_KEY.ollama).toBeUndefined();
  });
});

describe('PROVIDER_BASE_URL_ENV', () => {
  it('maps anthropic to ANTHROPIC_BASE_URL', () => {
    expect(PROVIDER_BASE_URL_ENV.anthropic).toBe('ANTHROPIC_BASE_URL');
  });

  it('does not define base URL env for other providers', () => {
    expect(PROVIDER_BASE_URL_ENV.openrouter).toBeUndefined();
    expect(PROVIDER_BASE_URL_ENV.zai).toBeUndefined();
    expect(PROVIDER_BASE_URL_ENV.ollama).toBeUndefined();
  });
});

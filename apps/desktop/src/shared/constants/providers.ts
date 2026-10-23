import type { ProviderInfo } from '../types/provider-account';

export const PROVIDER_REGISTRY: ProviderInfo[] = [
  {
    id: 'anthropic', name: 'Anthropic', description: 'Claude models',
    category: 'popular',
    authMethods: ['oauth', 'api-key'], envVars: ['ANTHROPIC_API_KEY'],
    configFields: [], website: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openrouter', name: 'OpenRouter', description: 'Access 300+ models from all providers',
    category: 'popular',
    authMethods: ['api-key'], envVars: ['OPENROUTER_API_KEY'],
    configFields: [], website: 'https://openrouter.ai/settings/keys',
  },
  {
    id: 'zai', name: 'Z.AI', description: 'GLM models',
    category: 'popular',
    authMethods: ['api-key'], envVars: ['ZHIPU_API_KEY'],
    configFields: ['baseUrl'], website: 'https://z.ai/model-api',
  },
  {
    id: 'ollama', name: 'Ollama', description: 'Local open-source models',
    category: 'local',
    authMethods: [], envVars: [],
    configFields: ['baseUrl'],
  },
  {
    id: 'openai-compatible', name: 'Custom Endpoint', description: 'Any OpenAI-compatible API (OpenRouter, proxies, local servers)',
    category: 'local',
    authMethods: ['api-key'], envVars: [],
    configFields: ['baseUrl'],
  },
];

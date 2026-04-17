import type { TraceTokenUsage } from '@shared/types/trace-types';

interface PricingTier {
  inputPerMToken: number;
  outputPerMToken: number;
  cacheReadPerMToken?: number;
  cacheWritePerMToken?: number;
}

const ANTHROPIC_PRICING: Record<string, PricingTier> = {
  'claude-opus-4': { inputPerMToken: 15, outputPerMToken: 75, cacheReadPerMToken: 1.5, cacheWritePerMToken: 18.75 },
  'claude-opus-4-5': { inputPerMToken: 15, outputPerMToken: 75, cacheReadPerMToken: 1.5, cacheWritePerMToken: 18.75 },
  'claude-sonnet-4': { inputPerMToken: 3, outputPerMToken: 15, cacheReadPerMToken: 0.3, cacheWritePerMToken: 3.75 },
  'claude-sonnet-4-6': { inputPerMToken: 3, outputPerMToken: 15, cacheReadPerMToken: 0.3, cacheWritePerMToken: 3.75 },
  'claude-haiku-4-5': { inputPerMToken: 0.8, outputPerMToken: 4, cacheReadPerMToken: 0.08, cacheWritePerMToken: 1 },
};

function findPricing(modelId: string): PricingTier | undefined {
  const lower = modelId.toLowerCase();
  for (const [key, pricing] of Object.entries(ANTHROPIC_PRICING)) {
    if (lower.includes(key)) return pricing;
  }
  return undefined;
}

export function estimateCost(usage: TraceTokenUsage, modelId: string): number | undefined {
  const pricing = findPricing(modelId);
  if (!pricing) return undefined;

  const inputCost = (usage.promptTokens / 1_000_000) * pricing.inputPerMToken;
  const outputCost = (usage.completionTokens / 1_000_000) * pricing.outputPerMToken;
  const cacheCost = pricing.cacheReadPerMToken && usage.cacheReadTokens
    ? (usage.cacheReadTokens / 1_000_000) * pricing.cacheReadPerMToken
    : 0;

  return inputCost + outputCost + cacheCost;
}

export function formatCost(cost: number): string {
  if (cost < 0.001) return '<$0.001';
  return `$${cost.toFixed(3)}`;
}

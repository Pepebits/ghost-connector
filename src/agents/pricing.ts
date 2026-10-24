import { getConfig, parsePrices } from '../config.js';

/**
 * USD per million tokens. Only models whose price has been verified; the
 * rest are configured via AI_PRICES (which takes precedence). With no price, the
 * cost is reported as unknown: better that than a made-up figure.
 */
const KNOWN_PRICES: Record<string, { input: number; output: number }> = {
  // deepseek-flash off-peak rate (api-docs.deepseek.com/quick_start/pricing).
  'deepseek-flash': { input: 0.15, output: 0.6 },
};

export function priceFor(model: string): { input: number; output: number } | null {
  const configured = parsePrices(getConfig().AI_PRICES)?.get(model);
  return configured ?? KNOWN_PRICES[model] ?? null;
}

/** USD cost of one call, or null if there is no price for that model. */
export function costUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = priceFor(model);
  if (!p) return null;
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

import { t } from '../../i18n/index.js';

/** $0.01234 instead of scientific notation: per-post costs are usually fractions of a cent. */
export function formatUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

/** Cost of a run: if some model has no price, say so (and the sum is a lower bound). */
export function formatRunCost(cost: { usd: number; unpricedModels?: string[] }): string {
  if (!cost.unpricedModels?.length) return formatUsd(cost.usd);
  const which = t('common.cost.unpriced', { models: cost.unpricedModels.join(', ') });
  return cost.usd > 0 ? `≥ ${formatUsd(cost.usd)} (${which})` : t('common.cost.unknown', { which });
}

/** 12.3k instead of 12345: token totals grow fast and the exact number adds nothing at a glance. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

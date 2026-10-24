import { getConfig } from '../config.js';
import { getCostSummary } from '../db/repo.js';
import { t } from '../i18n/index.js';

/**
 * Daily AI spending cap (AI_DAILY_BUDGET_USD, 0 = no cap), over the
 * last 24 hours of plans. Checked before each post starts, so a post
 * already in flight can still finish and go slightly over: the cap is
 * a brake, not an exact meter. Models without a price count as $0.
 */
export interface BudgetStatus {
  limit: number;
  spent: number;
  exceeded: boolean;
}

export function budgetStatus(): BudgetStatus | null {
  const limit = getConfig().AI_DAILY_BUDGET_USD;
  if (!limit) return null;
  const spent = getCostSummary().last24hUsd;
  return { limit, spent, exceeded: spent >= limit };
}

export class BudgetExceededError extends Error {
  constructor(status: BudgetStatus) {
    super(t('server.budgetExceeded', { spent: `$${status.spent.toFixed(2)}`, limit: `$${status.limit.toFixed(2)}` }));
    this.name = 'BudgetExceededError';
  }
}

/** Throws if today's cap is already used up. */
export function assertBudget(): void {
  const status = budgetStatus();
  if (status?.exceeded) throw new BudgetExceededError(status);
}

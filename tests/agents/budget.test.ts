import { afterEach, describe, expect, it, vi } from 'vitest';

const last24hUsd = vi.fn(() => 0);
vi.mock('../../src/db/repo.js', () => ({ getCostSummary: () => ({ totalUsd: 0, totalTokensIn: 0, totalTokensOut: 0, runCount: 0, last24hUsd: last24hUsd() }) }));
const { getConfig } = await import('../../src/config.js');
const { assertBudget, budgetStatus, BudgetExceededError } = await import('../../src/agents/budget.js');

describe('daily AI budget', () => {
  afterEach(() => { (getConfig() as { AI_DAILY_BUDGET_USD: number }).AI_DAILY_BUDGET_USD = 0; });

  it('0 means no cap', () => {
    last24hUsd.mockReturnValue(999);
    expect(budgetStatus()).toBeNull();
    expect(() => assertBudget()).not.toThrow();
  });

  it('blocks once the last 24 h reach the cap', () => {
    (getConfig() as { AI_DAILY_BUDGET_USD: number }).AI_DAILY_BUDGET_USD = 1;
    last24hUsd.mockReturnValue(0.5);
    expect(budgetStatus()).toEqual({ limit: 1, spent: 0.5, exceeded: false });
    last24hUsd.mockReturnValue(1);
    expect(() => assertBudget()).toThrow(BudgetExceededError);
  });
});

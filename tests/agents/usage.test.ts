import { afterEach, describe, expect, it } from 'vitest';
import { runAsActor } from '../../src/auth/context.js';
import { getConfig } from '../../src/config.js';
import { getDb } from '../../src/db/index.js';
import { aggregateUsage, assertUserBudget, recordUsage, usageReport, UserBudgetExceededError, userBudgetStatus, withUsagePost } from '../../src/agents/usage.js';

const cfg = getConfig() as { AI_USER_DAILY_BUDGET_USD: number };
const row = (at: string, actor: string | null, agent: string, model: string, usd: number | null, postId: string | null = null) => ({ at, actor, agent, model, post_id: postId, usd, tokens_in: 100, tokens_out: 50 });

describe('AI usage per user', () => {
  afterEach(() => {
    cfg.AI_USER_DAILY_BUDGET_USD = 0;
  });

  it('records who triggered each call and for which post', () => {
    runAsActor('marta', () => withUsagePost('post-1', () => recordUsage({ agent: 'writer', model: 'm1', usd: 0.2, inputTokens: 10, outputTokens: 5 })));
    recordUsage({ agent: 'ideas', model: 'm1', usd: 0.1, inputTokens: 1, outputTokens: 1 });
    recordUsage({ agent: 'seo', model: 'm1', usd: 0, inputTokens: 0, outputTokens: 0 }); // nothing used: not recorded
    const rows = getDb().prepare(`SELECT actor, agent, post_id FROM ai_usage WHERE model = 'm1' ORDER BY id`).all();
    expect(rows).toEqual([{ actor: 'marta', agent: 'writer', post_id: 'post-1' }, { actor: null, agent: 'ideas', post_id: null }]);
    const report = usageReport(7);
    expect(report.users.find((u) => u.actor === 'marta')?.usd).toBeCloseTo(0.2);
    expect(report.topPosts[0]).toMatchObject({ postId: 'post-1', actors: ['marta'] });
  });

  it('per-user cap: blocks that user only, never automatic work', () => {
    runAsActor('pablo', () => recordUsage({ agent: 'writer', model: 'm2', usd: 1.5, inputTokens: 10, outputTokens: 5 }));
    expect(() => runAsActor('pablo', assertUserBudget)).not.toThrow();
    cfg.AI_USER_DAILY_BUDGET_USD = 1;
    expect(userBudgetStatus('pablo')).toMatchObject({ limit: 1, exceeded: true });
    expect(() => runAsActor('pablo', assertUserBudget)).toThrow(UserBudgetExceededError);
    expect(() => runAsActor('otra', assertUserBudget)).not.toThrow();
    expect(() => runAsActor(null, assertUserBudget)).not.toThrow();
  });

  it('aggregates per user, agent, model and day, against the previous period', () => {
    const now = new Date('2026-10-25T12:00:00Z');
    const agg = aggregateUsage(
      [row('2026-10-24T10:00:00Z', 'ana', 'writer', 'a', 0.3, 'p1'), row('2026-10-25T10:00:00Z', 'ana', 'seo', 'b', 0.1, 'p1'), row('2026-10-25T11:00:00Z', 'luis', 'writer', 'a', null, 'p2')],
      [row('2026-10-15T10:00:00Z', 'ana', 'writer', 'a', 0.2)],
      7,
      now,
    );
    const ana = agg.users[0]!;
    expect(ana).toMatchObject({ actor: 'ana', calls: 2, tokensIn: 200, tokensOut: 100 });
    expect(ana.usd).toBeCloseTo(0.4);
    expect(ana.previousUsd).toBeCloseTo(0.2);
    expect(ana.byAgent.map((a) => a.agent)).toEqual(['writer', 'seo']);
    expect(ana.daily.slice(-2)).toEqual([0.3, 0.1]);
    expect(agg.users[1]).toMatchObject({ actor: 'luis', unpriced: 1, usd: 0 });
    expect(agg.posts.get('p1')?.usd).toBeCloseTo(0.4);
  });
});

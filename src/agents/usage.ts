import { AsyncLocalStorage } from 'node:async_hooks';
import { currentActor } from '../auth/context.js';
import { getConfig } from '../config.js';
import { getDb } from '../db/index.js';
import { t } from '../i18n/index.js';
import type { CostAgent } from '../types.js';

/**
 * Ledger of AI calls: one row per agent call, with who triggered it (the
 * request's user, or the user who started the job), the post it was for,
 * the model, tokens and price. It feeds the per-user cost page and the
 * per-user daily cap. Plans' own cost totals are unchanged.
 */

const postCtx = new AsyncLocalStorage<string>();

/** Runs `fn` with its AI calls attributed to `postId`. */
export function withUsagePost<T>(postId: string, fn: () => T): T {
  return postCtx.run(postId, fn);
}

export interface UsageEntry {
  agent: CostAgent;
  model: string;
  usd: number | null;
  inputTokens: number;
  outputTokens: number;
}

export function recordUsage(u: UsageEntry, at = new Date()): void {
  if (!u.inputTokens && !u.outputTokens) return;
  getDb()
    .prepare(`INSERT INTO ai_usage (at, actor, agent, model, post_id, usd, tokens_in, tokens_out) VALUES (?,?,?,?,?,?,?,?)`)
    .run(at.toISOString(), currentActor(), u.agent, u.model, postCtx.getStore() ?? null, u.usd, u.inputTokens, u.outputTokens);
}

// ---------- per-user daily cap ----------

export interface UserBudgetStatus {
  user: string;
  limit: number;
  spent: number;
  exceeded: boolean;
}

/** The current user's last 24 h against AI_USER_DAILY_BUDGET_USD (null: no cap, or automatic work). */
export function userBudgetStatus(user = currentActor()): UserBudgetStatus | null {
  const limit = getConfig().AI_USER_DAILY_BUDGET_USD;
  if (!limit || !user) return null;
  const since = new Date(Date.now() - 86400_000).toISOString();
  const { usd } = getDb().prepare(`SELECT COALESCE(SUM(usd), 0) AS usd FROM ai_usage WHERE actor = ? COLLATE NOCASE AND at >= ?`).get(user, since) as { usd: number };
  return { user, limit, spent: usd, exceeded: usd >= limit };
}

export class UserBudgetExceededError extends Error {
  constructor(s: UserBudgetStatus) {
    super(t('server.userBudgetExceeded', { spent: `$${s.spent.toFixed(2)}`, limit: `$${s.limit.toFixed(2)}` }));
    this.name = 'UserBudgetExceededError';
  }
}

export function assertUserBudget(): void {
  const s = userBudgetStatus();
  if (s?.exceeded) throw new UserBudgetExceededError(s);
}

// ---------- reports ----------

export interface UsageTotals {
  usd: number;
  tokensIn: number;
  tokensOut: number;
  calls: number;
}

export interface UserUsage extends UsageTotals {
  /** null: automatic work (nightly plan, CLI) or calls from before this ledger. */
  actor: string | null;
  previousUsd: number;
  byAgent: Array<{ agent: string; usd: number; tokens: number }>;
  byModel: Array<{ model: string; usd: number; tokens: number }>;
  /** Spend per day over the period, oldest first. */
  daily: number[];
  unpriced: number;
}

export interface UsageReport {
  days: number;
  since: string;
  total: UsageTotals & { previousUsd: number };
  users: UserUsage[];
  topPosts: Array<{ postId: string; title: string | null; usd: number; tokens: number; actors: string[] }>;
  /** Days with data in the ledger (it starts empty: older spend isn't per user). */
  firstAt: string | null;
}

interface Row {
  at: string;
  actor: string | null;
  agent: string;
  model: string;
  post_id: string | null;
  usd: number | null;
  tokens_in: number;
  tokens_out: number;
}

/** Pure aggregation (exported for the tests). */
export function aggregateUsage(rows: Row[], previous: Row[], days: number, now = new Date()): Omit<UsageReport, 'topPosts' | 'firstAt'> & { posts: Map<string, { usd: number; tokens: number; actors: Set<string> }> } {
  const start = new Date(now.getTime() - days * 86400_000);
  const users = new Map<string, UserUsage>();
  const posts = new Map<string, { usd: number; tokens: number; actors: Set<string> }>();
  const key = (a: string | null) => a ?? '';
  const get = (a: string | null) => {
    if (!users.has(key(a))) users.set(key(a), { actor: a, usd: 0, tokensIn: 0, tokensOut: 0, calls: 0, previousUsd: 0, byAgent: [], byModel: [], daily: Array(days).fill(0), unpriced: 0 });
    return users.get(key(a))!;
  };
  const bump = <K extends 'agent' | 'model'>(list: Array<Record<K, string> & { usd: number; tokens: number }>, k: K, v: string, usd: number, tokens: number) => {
    let e = list.find((x) => x[k] === v);
    if (!e) list.push((e = { [k]: v, usd: 0, tokens: 0 } as Record<K, string> & { usd: number; tokens: number }));
    e.usd += usd;
    e.tokens += tokens;
  };
  for (const r of rows) {
    const u = get(r.actor);
    const usd = r.usd ?? 0;
    const tokens = r.tokens_in + r.tokens_out;
    u.usd += usd;
    u.tokensIn += r.tokens_in;
    u.tokensOut += r.tokens_out;
    u.calls += 1;
    if (r.usd === null) u.unpriced += 1;
    bump(u.byAgent, 'agent', r.agent, usd, tokens);
    bump(u.byModel, 'model', r.model, usd, tokens);
    const d = Math.floor((Date.parse(r.at) - start.getTime()) / 86400_000);
    if (d >= 0 && d < days) u.daily[d]! += usd;
    if (r.post_id) {
      const p = posts.get(r.post_id) ?? { usd: 0, tokens: 0, actors: new Set<string>() };
      p.usd += usd;
      p.tokens += tokens;
      if (r.actor) p.actors.add(r.actor);
      posts.set(r.post_id, p);
    }
  }
  for (const r of previous) get(r.actor).previousUsd += r.usd ?? 0;
  const list = [...users.values()].map((u) => ({ ...u, byAgent: u.byAgent.sort((a, b) => b.usd - a.usd || b.tokens - a.tokens), byModel: u.byModel.sort((a, b) => b.usd - a.usd || b.tokens - a.tokens) }));
  list.sort((a, b) => b.usd - a.usd || b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut));
  const sum = (pick: (u: UserUsage) => number) => list.reduce((a, u) => a + pick(u), 0);
  return {
    days,
    since: start.toISOString(),
    total: { usd: sum((u) => u.usd), tokensIn: sum((u) => u.tokensIn), tokensOut: sum((u) => u.tokensOut), calls: sum((u) => u.calls), previousUsd: sum((u) => u.previousUsd) },
    users: list,
    posts,
  };
}

export function usageReport(days: number, now = new Date()): UsageReport {
  const db = getDb();
  const since = new Date(now.getTime() - days * 86400_000).toISOString();
  const before = new Date(now.getTime() - 2 * days * 86400_000).toISOString();
  const rows = db.prepare(`SELECT * FROM ai_usage WHERE at >= ? ORDER BY at`).all(since) as unknown as Row[];
  const previous = db.prepare(`SELECT * FROM ai_usage WHERE at >= ? AND at < ?`).all(before, since) as unknown as Row[];
  const agg = aggregateUsage(rows, previous, days, now);
  const titleOf = db.prepare(`SELECT title FROM posts_live WHERE post_id = ?`);
  const topPosts = [...agg.posts]
    .sort((a, b) => b[1].usd - a[1].usd || b[1].tokens - a[1].tokens)
    .slice(0, 10)
    .map(([postId, p]) => ({ postId, title: (titleOf.get(postId) as { title: string | null } | undefined)?.title ?? null, usd: p.usd, tokens: p.tokens, actors: [...p.actors] }));
  const first = db.prepare(`SELECT MIN(at) AS at FROM ai_usage`).get() as { at: string | null };
  const { posts: _posts, ...rest } = agg;
  return { ...rest, topPosts, firstAt: first.at };
}

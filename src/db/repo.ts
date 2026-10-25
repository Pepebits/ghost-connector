import type { RunArtifact } from '../types.js';
import { extractPendingQuestions } from '../util/pending.js';
import { currentActor } from '../auth/context.js';
import { getDb, safeWrite } from './index.js';

function wordCount(text: string | null): number {
  return (text ?? '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
}

// ---------- artifacts (index derived from .runs/**/*.json) ----------

export function upsertArtifactIndex(artifact: RunArtifact): void {
  safeWrite('upsertArtifactIndex', (db) => {
    const wordsBefore = wordCount(artifact.snapshot.html);
    const wordsAfter = artifact.writer ? wordCount(artifact.writer.markdown) : 0;
    const pendingCount = artifact.writer ? extractPendingQuestions(artifact.writer.markdown).length : 0;
    db.prepare(
      `INSERT INTO artifacts (run_id, post_id, created_at, status, post_title, words_before, words_after, pending_count, has_seo, has_image_plan, cost_usd, tokens_in, tokens_out, errors_json, extra_instructions, file_path, cost_by_agent_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(run_id, post_id) DO UPDATE SET
         created_at=excluded.created_at, status=excluded.status, post_title=excluded.post_title,
         words_before=excluded.words_before, words_after=excluded.words_after, pending_count=excluded.pending_count,
         has_seo=excluded.has_seo, has_image_plan=excluded.has_image_plan, cost_usd=excluded.cost_usd,
         tokens_in=excluded.tokens_in, tokens_out=excluded.tokens_out,
         errors_json=excluded.errors_json, extra_instructions=excluded.extra_instructions, file_path=excluded.file_path,
         cost_by_agent_json=excluded.cost_by_agent_json`,
    ).run(
      artifact.runId,
      artifact.postId,
      artifact.createdAt,
      artifact.status,
      artifact.postTitle,
      wordsBefore,
      wordsAfter,
      pendingCount,
      artifact.seo ? 1 : 0,
      artifact.imagePlan ? 1 : 0,
      artifact.cost.usd,
      artifact.cost.inputTokens,
      artifact.cost.outputTokens,
      JSON.stringify(artifact.errors),
      artifact.extraInstructions ?? null,
      `${artifact.runId}/${artifact.postId}.json`,
      artifact.cost.byAgent ? JSON.stringify(artifact.cost.byAgent) : null,
    );
  });
}

export interface IndexedArtifactRow {
  run_id: string;
  post_id: string;
  created_at: string;
  status: string;
  post_title: string;
  words_before: number;
  words_after: number;
  pending_count: number;
  cost_usd: number;
}

export function getLatestIndexedArtifact(postId: string): IndexedArtifactRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM artifacts WHERE post_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(postId) as IndexedArtifactRow | undefined;
}

export function countIndexedArtifacts(): number {
  const row = getDb().prepare(`SELECT COUNT(*) as n FROM artifacts`).get() as { n: number };
  return row.n;
}

export function clearArtifactIndex(): void {
  getDb().exec('DELETE FROM artifacts');
}

export interface CostSummary {
  totalUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  runCount: number;
  last24hUsd: number;
}

/**
 * Aggregate over the artifact index (never over .runs/ directly:
 * that is what `reindex` is for). Runs indexed BEFORE the
 * tokens_in/tokens_out columns existed are NULL -- SUM() ignores them, so
 * the $ total is still correct even though the token total is partial until
 * `reindex` is run.
 */
export function getCostSummary(): CostSummary {
  const totals = getDb()
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) as totalUsd,
              COALESCE(SUM(tokens_in), 0) as totalTokensIn,
              COALESCE(SUM(tokens_out), 0) as totalTokensOut,
              COUNT(*) as runCount
       FROM artifacts`,
    )
    .get() as { totalUsd: number; totalTokensIn: number; totalTokensOut: number; runCount: number };
  const extra = getDb()
    .prepare(`SELECT COALESCE(SUM(usd), 0) as usd, COALESCE(SUM(tokens_in), 0) as tin, COALESCE(SUM(tokens_out), 0) as tout, COUNT(*) as n FROM extra_costs`)
    .get() as { usd: number; tin: number; tout: number; n: number };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recent = getDb()
    .prepare(
      `SELECT (SELECT COALESCE(SUM(cost_usd), 0) FROM artifacts WHERE created_at >= ?) + (SELECT COALESCE(SUM(usd), 0) FROM extra_costs WHERE at >= ?) as usd`,
    )
    .get(since, since) as { usd: number };

  return {
    totalUsd: totals.totalUsd + extra.usd,
    totalTokensIn: totals.totalTokensIn + extra.tin,
    totalTokensOut: totals.totalTokensOut + extra.tout,
    runCount: totals.runCount + extra.n,
    last24hUsd: recent.usd,
  };
}

export interface AgentCost {
  /** CostAgent, or "unknown" for plans from before the breakdown existed. */
  agent: string;
  usd: number;
}

/** Total spend per agent, highest first. Older plans without breakdown go to "unknown". */
export function getCostByAgent(): AgentCost[] {
  const rows = getDb().prepare(`SELECT cost_usd, cost_by_agent_json FROM artifacts WHERE cost_usd > 0`).all() as Array<{ cost_usd: number; cost_by_agent_json: string | null }>;
  const totals = new Map<string, number>();
  const add = (agent: string, usd: number) => totals.set(agent, (totals.get(agent) ?? 0) + usd);
  for (const r of rows) {
    const by = r.cost_by_agent_json ? (JSON.parse(r.cost_by_agent_json) as Record<string, number>) : null;
    if (!by) {
      add('unknown', r.cost_usd);
      continue;
    }
    let known = 0;
    for (const [agent, usd] of Object.entries(by)) {
      add(agent, usd);
      known += usd;
    }
    // Spend from before the breakdown, in a plan that was later edited with AI.
    if (r.cost_usd - known > 1e-9) add('unknown', r.cost_usd - known);
  }
  for (const r of getDb().prepare(`SELECT agent, SUM(usd) as usd FROM extra_costs GROUP BY agent`).all() as Array<{ agent: string; usd: number }>) add(r.agent, r.usd);
  return [...totals].map(([agent, usd]) => ({ agent, usd })).sort((a, b) => b.usd - a.usd);
}

/** Records AI spend outside a plan (e.g. topic ideas). */
export function recordExtraCost(input: { agent: string; usd: number; tokensIn: number; tokensOut: number }): void {
  safeWrite('recordExtraCost', (db) => {
    db.prepare(`INSERT INTO extra_costs (at, agent, usd, tokens_in, tokens_out) VALUES (?,?,?,?,?)`).run(new Date().toISOString(), input.agent, input.usd, input.tokensIn, input.tokensOut);
  });
}

export interface DailyCost {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  usd: number;
  runs: number;
}

/** AI spend per day for the last `days` days (oldest first, days with no runs included as 0). */
export function getDailyCost(days = 30): DailyCost[] {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const rows = getDb()
    .prepare(
      `SELECT day, SUM(usd) as usd, SUM(runs) as runs FROM (
         SELECT substr(created_at, 1, 10) as day, COALESCE(SUM(cost_usd), 0) as usd, COUNT(*) as runs FROM artifacts WHERE created_at >= ? GROUP BY day
         UNION ALL
         SELECT substr(at, 1, 10) as day, COALESCE(SUM(usd), 0) as usd, COUNT(*) as runs FROM extra_costs WHERE at >= ? GROUP BY day
       ) GROUP BY day`,
    )
    .all(start.toISOString(), start.toISOString()) as unknown as DailyCost[];
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const day = d.toISOString().slice(0, 10);
    return byDay.get(day) ?? { day, usd: 0, runs: 0 };
  });
}

// ---------- apply_attempts / resolve_attempts ----------

export interface ApplyAttemptInput {
  postId: string;
  runId: string;
  result: string;
  reasonCode: string;
  message: string;
  imageResult: string;
  provenance: 'recorded' | 'inferred';
}

export function recordApplyAttempt(input: ApplyAttemptInput): void {
  safeWrite('recordApplyAttempt', (db) => {
    db.prepare(
      `INSERT INTO apply_attempts (post_id, run_id, at, result, reason_code, message, image_result, provenance, actor) VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(input.postId, input.runId, new Date().toISOString(), input.result, input.reasonCode, input.message, input.imageResult, input.provenance, currentActor());
  });
}

export interface ApplyAttemptRow {
  id: number;
  post_id: string;
  run_id: string;
  at: string;
  result: string;
  reason_code: string;
  message: string;
  image_result: string;
  provenance: string;
  /** Who applied it (null: CLI, nightly or older rows). */
  actor: string | null;
}

export function getLastApplyAttempt(postId: string): ApplyAttemptRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM apply_attempts WHERE post_id = ? ORDER BY at DESC LIMIT 1`)
    .get(postId) as ApplyAttemptRow | undefined;
}

export function listApplyAttempts(postId: string): ApplyAttemptRow[] {
  return getDb().prepare(`SELECT * FROM apply_attempts WHERE post_id = ? ORDER BY at DESC`).all(postId) as unknown as ApplyAttemptRow[];
}

export interface ResolveAttemptInput {
  postId: string;
  answered: number;
  unresolved: number;
  result: string;
  message: string;
}

export function recordResolveAttempt(input: ResolveAttemptInput): void {
  safeWrite('recordResolveAttempt', (db) => {
    db.prepare(`INSERT INTO resolve_attempts (post_id, at, answered, unresolved, result, message) VALUES (?,?,?,?,?,?)`).run(
      input.postId,
      new Date().toISOString(),
      input.answered,
      input.unresolved,
      input.result,
      input.message,
    );
  });
}

// ---------- backfill: posts applied before apply_attempts existed ----------

/**
 * If a post has the #ai-processed tag but NO recorded apply_attempt,
 * it is inferred that it was applied at some point before
 * this mechanism existed. A synthetic row is inserted (provenance =
 * 'inferred') so it is not left blank, making clear it is not a
 * real record. Idempotent: does not duplicate if something exists (real or inferred).
 */
export function backfillInferredApplied(postId: string, postTitle: string): void {
  const existing = getLastApplyAttempt(postId);
  if (existing) return;
  recordApplyAttempt({
    postId,
    runId: '(desconocido)',
    result: 'applied',
    reasonCode: 'ok',
    message: `Inferred from the #ai-processed tag on "${postTitle}": it was applied before the apply_attempts log existed.`,
    imageResult: 'none',
    provenance: 'inferred',
  });
}

// ---------- posts_live (snapshot of the last sync, for fast network-free reads) ----------

export interface PostsLiveRow {
  post_id: string;
  title: string;
  slug: string;
  url: string;
  updated_at: string;
  feature_image: string | null;
  pending_count: number;
  word_count: number;
  tags_json: string;
  ai_processed: number;
  kind: string;
  issues_json: string;
  synced_at: string;
}

export function upsertPostLive(row: PostsLiveRow): void {
  safeWrite('upsertPostLive', (db) => {
    db.prepare(
      `INSERT INTO posts_live (post_id, title, slug, url, updated_at, feature_image, pending_count, word_count, tags_json, ai_processed, kind, issues_json, synced_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(post_id) DO UPDATE SET
         title=excluded.title, slug=excluded.slug, url=excluded.url, updated_at=excluded.updated_at,
         feature_image=excluded.feature_image, pending_count=excluded.pending_count, word_count=excluded.word_count,
         tags_json=excluded.tags_json, ai_processed=excluded.ai_processed, kind=excluded.kind,
         issues_json=excluded.issues_json, synced_at=excluded.synced_at`,
    ).run(
      row.post_id,
      row.title,
      row.slug,
      row.url,
      row.updated_at,
      row.feature_image,
      row.pending_count,
      row.word_count,
      row.tags_json,
      row.ai_processed,
      row.kind,
      row.issues_json,
      row.synced_at,
    );
  });
}

export function listPostsLive(): PostsLiveRow[] {
  return getDb().prepare(`SELECT * FROM posts_live ORDER BY updated_at DESC`).all() as unknown as PostsLiveRow[];
}

/** Title of each post's latest plan, only when that plan is still unapplied ("planned"). */
export function plannedTitles(): Map<string, string> {
  const rows = getDb()
    .prepare(
      `SELECT a.post_id, a.post_title FROM artifacts a
       WHERE a.status = 'planned' AND a.created_at = (SELECT MAX(created_at) FROM artifacts b WHERE b.post_id = a.post_id)`,
    )
    .all() as Array<{ post_id: string; post_title: string }>;
  return new Map(rows.map((r) => [r.post_id, r.post_title]));
}

/** Words in each post's unapplied plan (latest artifact still "planned"). */
export function plannedWords(): Map<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT a.post_id, a.words_after FROM artifacts a
       WHERE a.status = 'planned' AND a.words_after IS NOT NULL AND a.created_at = (SELECT MAX(created_at) FROM artifacts b WHERE b.post_id = a.post_id)`,
    )
    .all() as Array<{ post_id: string; words_after: number }>;
  return new Map(rows.map((r) => [r.post_id, r.words_after]));
}

export function deletePostLive(postId: string): void {
  safeWrite('deletePostLive', (db) => {
    db.prepare(`DELETE FROM posts_live WHERE post_id = ?`).run(postId);
  });
}

// ---------- provider_calls (Unsplash/Pexels quota telemetry) ----------

export function recordProviderCall(input: { provider: string; kind: 'search' | 'download'; status: number; remaining: number | null }): void {
  safeWrite('recordProviderCall', (db) => {
    db.prepare(`INSERT INTO provider_calls (at, provider, kind, status, remaining) VALUES (?,?,?,?,?)`).run(
      new Date().toISOString(),
      input.provider,
      input.kind,
      input.status,
      input.remaining,
    );
  });
}

export interface ProviderQuota {
  provider: string;
  lastRemaining: number | null;
  lastAt: string;
  lastStatus: number;
}

/** Last known `remaining` of each provider (null = never called, or the provider does not send that header). */
export function getProviderQuotas(): ProviderQuota[] {
  const rows = getDb()
    .prepare(
      `SELECT provider, remaining as lastRemaining, at as lastAt, status as lastStatus
       FROM provider_calls
       WHERE id IN (SELECT MAX(id) FROM provider_calls GROUP BY provider)`,
    )
    .all() as unknown as ProviderQuota[];
  // Wikimedia has no quota to show (keyless, no remaining header).
  return rows.filter((q) => q.provider !== 'wikimedia');
}

// ---------- posts_gone (left DRAFT_FILTER: published manually, deleted, etc.) ----------

export interface PostGoneRow {
  post_id: string;
  title: string;
  last_status: string;
  detected_at: string;
}

export function upsertPostGone(row: PostGoneRow): void {
  safeWrite('upsertPostGone', (db) => {
    db.prepare(
      `INSERT INTO posts_gone (post_id, title, last_status, detected_at) VALUES (?,?,?,?)
       ON CONFLICT(post_id) DO UPDATE SET title=excluded.title, last_status=excluded.last_status, detected_at=excluded.detected_at`,
    ).run(row.post_id, row.title, row.last_status, row.detected_at);
  });
}

export function listPostsGone(): PostGoneRow[] {
  return getDb().prepare(`SELECT * FROM posts_gone ORDER BY detected_at DESC`).all() as unknown as PostGoneRow[];
}

export function deletePostGone(postId: string): void {
  safeWrite('deletePostGone', (db) => {
    db.prepare(`DELETE FROM posts_gone WHERE post_id = ?`).run(postId);
  });
}

// ---------- prompt_revisions (base prompt editor + revert) ----------

export interface PromptRevisionRow {
  id: number;
  name: string;
  content: string;
  saved_at: string;
  note: string | null;
}

export function recordPromptRevision(input: { name: string; content: string; note?: string }): number {
  const db = getDb();
  const result = db
    .prepare(`INSERT INTO prompt_revisions (name, content, saved_at, note) VALUES (?,?,?,?)`)
    .run(input.name, input.content, new Date().toISOString(), input.note ?? null);
  return Number(result.lastInsertRowid);
}

export function listPromptRevisions(name: string): PromptRevisionRow[] {
  return getDb()
    .prepare(`SELECT * FROM prompt_revisions WHERE name = ? ORDER BY id DESC`)
    .all(name) as unknown as PromptRevisionRow[];
}

export function getPromptRevision(id: number): PromptRevisionRow | undefined {
  return getDb().prepare(`SELECT * FROM prompt_revisions WHERE id = ?`).get(id) as PromptRevisionRow | undefined;
}

export function getMeta(key: string): string | undefined {
  const row = getDb().prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value;
}

export function setMeta(key: string, value: string): void {
  safeWrite('setMeta', (db) => {
    db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
  });
}

// ---------- review_decisions (block review) ----------

export interface ReviewDecisionInput {
  postId: string;
  runId: string;
  decisions: Array<{ category: string; accepted: boolean }>;
}

export function recordReviewDecisions(input: ReviewDecisionInput): void {
  safeWrite('recordReviewDecisions', (db) => {
    const at = new Date().toISOString();
    const stmt = db.prepare(`INSERT INTO review_decisions (post_id, run_id, at, category, accepted) VALUES (?, ?, ?, ?, ?)`);
    for (const d of input.decisions) stmt.run(input.postId, input.runId, at, d.category, d.accepted ? 1 : 0);
  });
}

export interface ReviewCategoryStats {
  category: string;
  total: number;
  rejected: number;
}

/** Totals per category of the last `limit` decisions (recent ones weigh more: the prompt changes over time). */
export function getReviewStats(limit = 300): ReviewCategoryStats[] {
  return getDb()
    .prepare(
      `SELECT category, COUNT(*) AS total, SUM(CASE WHEN accepted = 0 THEN 1 ELSE 0 END) AS rejected
       FROM (SELECT * FROM review_decisions ORDER BY id DESC LIMIT ?)
       GROUP BY category ORDER BY total DESC`,
    )
    .all(limit) as unknown as ReviewCategoryStats[];
}

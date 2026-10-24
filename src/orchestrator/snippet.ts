import { currentActor } from '../auth/context.js';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { suggestSnippet } from '../agents/snippet.agent.js';
import { getConfig } from '../config.js';
import { recordExtraCost } from '../db/repo.js';
import { ghostApi } from '../ghost/client.js';
import { logger } from '../logger.js';
import type { SnippetOutput } from '../types.js';
import { acquireWriteLock } from '../util/lock.js';
import { ghostLimiter } from '../util/limiter.js';
import { withRetry } from '../util/retry.js';
import { capitalizeTitle } from '../util/title.js';

/**
 * "Good position, few clicks" → new Google title and description for a
 * PUBLISHED post. Only meta_title and meta_description are touched (never
 * the content, slug or status), and the previous values are kept so the
 * change can be undone.
 */

interface PublishedMeta {
  id: string;
  title: string;
  url: string;
  slug: string;
  updated_at: string;
  meta_title: string | null;
  meta_description: string | null;
  custom_excerpt: string | null;
  excerpt: string | null;
  plaintext?: string | null;
}

export interface SnippetPlan {
  postId: string;
  title: string;
  url: string;
  query: string;
  /** The page exactly as Search Console reports it (it may differ from Ghost's URL: http/www/slash). */
  gscPage?: string;
  position: number;
  ctr: number;
  at: string;
  current: { meta_title: string; meta_description: string };
  options: SnippetOutput['options'];
  applied?: { at: string; /** Who applied it. */ by?: string; meta_title: string; meta_description: string; previous: { meta_title: string; meta_description: string }; updatedAt?: string };
  restoredAt?: string;
  /** Google numbers for the query since the change was applied (filled on "Refresh"). */
  followUp?: { at: string; from: string; to: string; impressions: number; clicks: number; ctr: number; position: number };
}

const dir = () => join(getConfig().DATA_DIR, 'snippets');
const file = (postId: string) => join(dir(), `${postId.replace(/[^a-zA-Z0-9_-]/g, '')}.json`);

export function loadSnippet(postId: string): SnippetPlan | null {
  try {
    return existsSync(file(postId)) ? (JSON.parse(readFileSync(file(postId), 'utf8')) as SnippetPlan) : null;
  } catch {
    return null;
  }
}

function saveSnippet(plan: SnippetPlan): void {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(file(plan.postId), JSON.stringify(plan, null, 2));
}

/** Comparable form of a URL: no scheme, no www, no query/hash, no trailing slash, lower case. */
export function bareUrl(url: string): string {
  return url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
}

/** Slug of a blog URL: its last path segment. */
export function slugFromUrl(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts.length ? decodeURIComponent(parts[parts.length - 1]!) : null;
  } catch {
    return null;
  }
}


async function readPublished(by: { id: string } | { slug: string }): Promise<PublishedMeta> {
  const post = (await ghostLimiter(() => withRetry(() => ghostApi().posts.read(by, { formats: 'plaintext' })))) as unknown as PublishedMeta & { status: string };
  if (post.status !== 'published') throw new Error(`The post is not published (status=${post.status})`);
  return post;
}

export async function suggestForPage(input: { page: string; query: string; position: number; ctr: number }): Promise<SnippetPlan> {
  const slug = slugFromUrl(input.page);
  if (!slug) throw new Error(`Not a post URL: ${input.page}`);
  const post = await readPublished({ slug });
  // /tag/foo/ or /author/foo/ would otherwise land on a post whose slug is "foo".
  if (bareUrl(post.url) !== bareUrl(input.page)) throw new Error(`${input.page} is not the URL of the post "${post.title}" (${post.url})`);
  const excerpt = (post.custom_excerpt || post.plaintext || post.excerpt || '').replace(/\s+/g, ' ').slice(0, 1500);
  const { data, usage } = await suggestSnippet({
    title: post.title,
    query: input.query,
    position: input.position,
    ctr: input.ctr,
    metaTitle: post.meta_title ?? '',
    metaDescription: post.meta_description ?? '',
    excerpt,
    language: '',
  });
  recordExtraCost({ agent: 'snippet', usd: usage.usd ?? 0, tokensIn: usage.inputTokens, tokensOut: usage.outputTokens });
  const plan: SnippetPlan = {
    postId: post.id,
    title: post.title,
    url: post.url,
    query: input.query,
    gscPage: input.page,
    position: input.position,
    ctr: input.ctr,
    at: new Date().toISOString(),
    current: { meta_title: post.meta_title ?? '', meta_description: post.meta_description ?? '' },
    options: data.options.map((o) => ({ ...o, meta_title: capitalizeTitle(o.meta_title.trim()), meta_description: o.meta_description.trim() })),
  };
  saveSnippet(plan);
  return plan;
}

export type SnippetWriteStatus = 'applied' | 'restored' | 'conflict' | 'failed' | 'unavailable';

async function writeMeta(postId: string, meta: { meta_title: string; meta_description: string }, expected: { meta_title: string; meta_description: string }) {
  const release = acquireWriteLock(`snippet:${postId}`);
  try {
    const fresh = await readPublished({ id: postId });
    const now = { meta_title: fresh.meta_title ?? '', meta_description: fresh.meta_description ?? '' };
    // Someone edited them in Ghost meanwhile: don't overwrite blindly.
    if (now.meta_title !== expected.meta_title || now.meta_description !== expected.meta_description) {
      return { status: 'conflict' as const, now };
    }
    try {
      // Only these two fields: no status (it stays published), no content, no slug.
      const saved = (await ghostLimiter(() =>
        ghostApi().posts.edit({ id: postId, updated_at: fresh.updated_at, meta_title: meta.meta_title || null, meta_description: meta.meta_description || null }),
      )) as { updated_at?: string };
      return { status: 'ok' as const, now, updatedAt: saved?.updated_at };
    } catch (err) {
      // Ghost's updated_at check: edited between our read and our write.
      if ((err as { response?: { status?: number }; statusCode?: number }).response?.status === 409 || (err as { statusCode?: number }).statusCode === 409) {
        return { status: 'conflict' as const, now };
      }
      throw err;
    }
  } finally {
    release();
  }
}

export async function applySnippet(postId: string, meta: { meta_title: string; meta_description: string }): Promise<{ status: SnippetWriteStatus; message?: string }> {
  const plan = loadSnippet(postId);
  if (!plan) return { status: 'unavailable' };
  const clean = { meta_title: meta.meta_title.trim().slice(0, 70), meta_description: meta.meta_description.trim().slice(0, 200) };
  try {
    const r = await writeMeta(postId, clean, plan.applied ? { meta_title: plan.applied.meta_title, meta_description: plan.applied.meta_description } : plan.current);
    if (r.status === 'conflict') return { status: 'conflict' };
    const previous = plan.applied ? plan.applied.previous : plan.current;
    saveSnippet({ ...plan, applied: { at: new Date().toISOString(), ...(currentActor() ? { by: currentActor()! } : {}), ...clean, previous, ...(r.updatedAt ? { updatedAt: r.updatedAt } : {}) }, restoredAt: undefined, followUp: undefined });
    return { status: 'applied' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ postId, err: message }, 'Snippet apply failed');
    return { status: 'failed', message };
  }
}

export async function restoreSnippet(postId: string): Promise<{ status: SnippetWriteStatus; message?: string }> {
  const plan = loadSnippet(postId);
  if (!plan?.applied) return { status: 'unavailable' };
  try {
    const r = await writeMeta(postId, plan.applied.previous, { meta_title: plan.applied.meta_title, meta_description: plan.applied.meta_description });
    if (r.status === 'conflict') return { status: 'conflict' };
    saveSnippet({ ...plan, current: plan.applied.previous, applied: undefined, restoredAt: new Date().toISOString(), followUp: undefined });
    return { status: 'restored' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ postId, err: message }, 'Snippet restore failed');
    return { status: 'failed', message };
  }
}

/** Saved proposal per page URL (for the "Good position, few clicks" table). */
export function snippetsByUrl(): Map<string, SnippetPlan> {
  const out = new Map<string, SnippetPlan>();
  if (!existsSync(dir())) return out;
  for (const name of readdirSafe(dir())) {
    const plan = loadSnippet(name.replace(/\.json$/, ''));
    if (plan) out.set(bareUrl(plan.gscPage ?? plan.url), plan);
  }
  return out;
}

function readdirSafe(path: string): string[] {
  try {
    return readdirSync(path).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
}

/** Days Google needs after a change before the numbers mean anything. */
const SETTLE_DAYS = 3;

/** CTR since the change for every applied proposal (one Search Console call each). */
export async function refreshFollowUps(fetchRange: (start: Date, end: Date, page: string) => Promise<Array<{ query: string; page: string; clicks: number; impressions: number; position: number }>>): Promise<void> {
  for (const plan of snippetsByUrl().values()) {
    if (!plan.applied) continue;
    const start = new Date(new Date(plan.applied.at).getTime() + 86400_000);
    const end = new Date(Date.now() - 2 * 86400_000);
    if (end.getTime() - start.getTime() < (SETTLE_DAYS - 1) * 86400_000) continue;
    try {
      const q = plan.query.trim().toLowerCase();
      const rows = (await fetchRange(start, end, plan.gscPage ?? plan.url)).filter((r) => r.query.trim().toLowerCase() === q);
      const impressions = rows.reduce((n, r) => n + r.impressions, 0);
      const clicks = rows.reduce((n, r) => n + r.clicks, 0);
      const position = impressions ? rows.reduce((n, r) => n + r.position * r.impressions, 0) / impressions : 0;
      const day = (d: Date) => d.toISOString().slice(0, 10);
      saveSnippet({ ...plan, followUp: { at: new Date().toISOString(), from: day(start), to: day(end), impressions, clicks, ctr: impressions ? clicks / impressions : 0, position } });
    } catch (err) {
      logger.warn({ postId: plan.postId, err: err instanceof Error ? err.message : String(err) }, 'Snippet follow-up failed');
    }
  }
}

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfig } from '../config.js';
import { getDb } from '../db/index.js';
import { ghostApi } from '../ghost/client.js';
import { bareUrl, snippetsByUrl } from '../orchestrator/snippet.js';
import { ghostLimiter } from '../util/limiter.js';
import { withRetry } from '../util/retry.js';
import { bingConfigured, bingPageStats, type BingPageRow } from './bingWebmaster.js';
import { searchAnalyticsQuery, searchConsoleConfigured, type GscRow, type SearchSource } from './searchConsole.js';

/**
 * Results: how the posts the panel worked on do in search once published.
 * Per page, from Google Search Console and/or Bing Webmaster (added up when
 * both are set): the last 28 days against the 28 before, a weekly series
 * (with the dates the panel applied changes) and, from Google, the top
 * queries. Refreshed by hand, like Ideas, and cached until the next refresh.
 */

/** Search Console data lags 2-3 days: the periods end that far back. */
export const GSC_LAG_DAYS = 3;
export const PERIOD_DAYS = 28;
export const WEEKS = 16;
const TOP_QUERIES = 5;

export interface Metrics {
  clicks: number;
  impressions: number;
  /** Average position, weighted by impressions (0 when there were none). */
  position: number;
}

export interface WeekPoint {
  /** First day of the week (YYYY-MM-DD). */
  start: string;
  clicks: number;
  impressions: number;
}

export interface PostResult {
  postId: string;
  title: string;
  url: string;
  publishedAt: string | null;
  /** When the panel changed it: plans applied, or a new title/meta from Ideas (oldest first). Empty: not touched. */
  appliedAt: string[];
  current: Metrics;
  previous: Metrics;
  weekly: WeekPoint[];
  queries: Array<{ query: string; clicks: number; impressions: number; position: number }>;
}

export interface ResultsCache {
  at: string;
  /** Which properties it was built from: a settings change invalidates it. */
  site: string;
  sources: SearchSource[];
  current: { start: string; end: string };
  previous: { start: string; end: string };
  /** Every published post with search data or touched by the panel. */
  posts: PostResult[];
  /** Posts the panel applied that are still drafts in Ghost (nothing to measure yet). */
  unpublished: number;
}

// ---------- pure helpers ----------

const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400_000);

export function periods(now = new Date()) {
  const end = addDays(new Date(`${day(now)}T00:00:00Z`), -GSC_LAG_DAYS);
  const curStart = addDays(end, -(PERIOD_DAYS - 1));
  const prevEnd = addDays(curStart, -1);
  const prevStart = addDays(prevEnd, -(PERIOD_DAYS - 1));
  const seriesStart = addDays(end, -(WEEKS * 7 - 1));
  return { current: { start: curStart, end }, previous: { start: prevStart, end: prevEnd }, series: { start: seriesStart, end } };
}

/** Sums rows whose first key is a page into per-URL metrics (position weighted by impressions). */
export function metricsByPage(rows: GscRow[]): Map<string, Metrics> {
  const acc = new Map<string, { clicks: number; impressions: number; posSum: number }>();
  for (const r of rows) {
    const key = bareUrl(r.keys[0]!);
    const a = acc.get(key) ?? { clicks: 0, impressions: 0, posSum: 0 };
    a.clicks += r.clicks;
    a.impressions += r.impressions;
    a.posSum += r.position * r.impressions;
    acc.set(key, a);
  }
  return new Map([...acc].map(([k, a]) => [k, { clicks: a.clicks, impressions: a.impressions, position: a.impressions ? a.posSum / a.impressions : 0 }]));
}

/** WEEKS empty weeks from `start` (a post with no data yet). */
export function blankWeeks(start: Date, weeks = WEEKS): WeekPoint[] {
  return Array.from({ length: weeks }, (_, i) => ({ start: day(addDays(start, i * 7)), clicks: 0, impressions: 0 }));
}

/** Rows keyed [page, date] → per-URL weekly buckets from `start` (WEEKS of them, empty weeks included). */
export function weeklyByPage(rows: GscRow[], start: Date, weeks = WEEKS): Map<string, WeekPoint[]> {
  const out = new Map<string, WeekPoint[]>();
  const blank = () => blankWeeks(start, weeks);
  for (const r of rows) {
    const key = bareUrl(r.keys[0]!);
    const i = Math.floor((Date.parse(`${r.keys[1]}T00:00:00Z`) - start.getTime()) / (7 * 86400_000));
    if (i < 0 || i >= weeks) continue;
    if (!out.has(key)) out.set(key, blank());
    const w = out.get(key)![i]!;
    w.clicks += r.clicks;
    w.impressions += r.impressions;
  }
  return out;
}

/** Rows keyed [page, query] → each URL's top queries by clicks, then impressions. */
export function topQueriesByPage(rows: GscRow[], n = TOP_QUERIES): Map<string, PostResult['queries']> {
  const out = new Map<string, PostResult['queries']>();
  for (const r of rows) {
    const key = bareUrl(r.keys[0]!);
    const list = out.get(key) ?? [];
    list.push({ query: r.keys[1]!, clicks: r.clicks, impressions: r.impressions, position: r.position });
    out.set(key, list);
  }
  for (const [k, list] of out) out.set(k, list.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, n));
  return out;
}

/** Bing's weekly page rows as Search Console-shaped rows: [page] within a period, or [page, date]. */
export function bingAsRows(rows: BingPageRow[], from: Date, to: Date, withDate: boolean): GscRow[] {
  const a = day(from);
  const b = day(to);
  return rows
    .filter((r) => r.date >= a && r.date <= b)
    .map((r) => ({ keys: withDate ? [r.page, r.date] : [r.page], clicks: r.clicks, impressions: r.impressions, ctr: r.impressions ? r.clicks / r.impressions : 0, position: r.position }));
}

/** Relative change, or null when there's nothing to compare against. */
export function change(now: number, before: number): number | null {
  if (!before) return null;
  return (now - before) / before;
}

export const EMPTY: Metrics = { clicks: 0, impressions: 0, position: 0 };

// ---------- data ----------

/** Posts the panel applied a plan to, with the dates (oldest first). */
export function appliedPosts(): Map<string, string[]> {
  const rows = getDb()
    .prepare(`SELECT post_id, at FROM apply_attempts WHERE result = 'applied' AND post_id IS NOT NULL ORDER BY at`)
    .all() as Array<{ post_id: string; at: string }>;
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.post_id, [...(out.get(r.post_id) ?? []), r.at]);
  return out;
}

/** Every date the panel changed each post: applied plans plus titles/metas applied from Ideas. */
export function touchedPosts(): Map<string, string[]> {
  const out = appliedPosts();
  for (const plan of snippetsByUrl().values()) {
    if (plan.applied?.at) out.set(plan.postId, [...(out.get(plan.postId) ?? []), plan.applied.at].sort());
  }
  return out;
}

interface PublishedPost {
  id: string;
  title: string;
  url: string;
  published_at: string | null;
}

/** Every published post (read-only Ghost query, 100 per page). */
async function allPublished(): Promise<PublishedPost[]> {
  const out: PublishedPost[] = [];
  for (let page = 1; page <= 50; page++) {
    const batch = (await ghostLimiter(() =>
      withRetry(() => ghostApi().posts.browse({ filter: 'status:published', fields: 'id,title,url,published_at', limit: 100, page })),
    )) as unknown as PublishedPost[] & { meta?: { pagination?: { pages: number } } };
    out.push(...batch);
    if (page >= (batch.meta?.pagination?.pages ?? page) || batch.length === 0) break;
  }
  return out;
}

const cacheFile = () => join(getConfig().DATA_DIR, 'results.json');

export function resultsSourcesConfigured(): boolean {
  return searchConsoleConfigured() || bingConfigured();
}

const sourcesKey = () => {
  const cfg = getConfig();
  return JSON.stringify([searchConsoleConfigured() ? cfg.GSC_SITE_URL : null, bingConfigured() ? cfg.BING_SITE_URL : null]);
};

export function loadResults(): ResultsCache | null {
  try {
    if (!existsSync(cacheFile())) return null;
    const c = JSON.parse(readFileSync(cacheFile(), 'utf8')) as ResultsCache;
    // A different Search Console property (settings changed): the old numbers don't apply.
    return c.site === sourcesKey() ? c : null;
  } catch {
    return null;
  }
}

/** Asks Ghost and Search Console again and saves the result. */
export async function refreshResults(now = new Date()): Promise<ResultsCache> {
  if (!resultsSourcesConfigured()) throw new Error('Neither Search Console nor Bing Webmaster is configured');
  const google = searchConsoleConfigured();
  const bing = bingConfigured();
  const touched = touchedPosts();
  const published = await allPublished();
  const p = periods(now);
  const none: GscRow[] = [];
  const [gCur, gPrev, gSeries, queries, bingRows] = published.length
    ? await Promise.all([
        google ? searchAnalyticsQuery({ start: p.current.start, end: p.current.end, dimensions: ['page'] }) : none,
        google ? searchAnalyticsQuery({ start: p.previous.start, end: p.previous.end, dimensions: ['page'] }) : none,
        google ? searchAnalyticsQuery({ start: p.series.start, end: p.series.end, dimensions: ['page', 'date'] }) : none,
        google ? searchAnalyticsQuery({ start: p.current.start, end: p.current.end, dimensions: ['page', 'query'] }) : none,
        bing ? bingPageStats() : ([] as BingPageRow[]),
      ])
    : [none, none, none, none, [] as BingPageRow[]];
  const cur = [...gCur, ...bingAsRows(bingRows, p.current.start, p.current.end, false)];
  const prev = [...gPrev, ...bingAsRows(bingRows, p.previous.start, p.previous.end, false)];
  const series = [...gSeries, ...bingAsRows(bingRows, p.series.start, p.series.end, true)];
  const current = metricsByPage(cur);
  const previous = metricsByPage(prev);
  const weekly = weeklyByPage(series, p.series.start);
  const top = topQueriesByPage(queries);

  const cache: ResultsCache = {
    at: now.toISOString(),
    site: sourcesKey(),
    sources: [...(google ? (['google'] as const) : []), ...(bing ? (['bing'] as const) : [])],
    current: { start: day(p.current.start), end: day(p.current.end) },
    previous: { start: day(p.previous.start), end: day(p.previous.end) },
    posts: published
      .map((g) => {
      const key = bareUrl(g.url);
      return {
        postId: g.id,
        title: g.title,
        url: g.url,
        publishedAt: g.published_at,
        appliedAt: touched.get(g.id) ?? [],
        current: current.get(key) ?? EMPTY,
        previous: previous.get(key) ?? EMPTY,
        weekly: weekly.get(key) ?? blankWeeks(p.series.start),
        queries: top.get(key) ?? [],
      };
      })
      // Only what has something to show: search data, or the panel touched it.
      .filter((r) => r.appliedAt.length || r.current.impressions || r.previous.impressions || r.weekly.some((w) => w.impressions)),
    unpublished: [...appliedPosts().keys()].filter((id) => !published.some((g) => g.id === id)).length,
  };
  writeFileSync(cacheFile(), JSON.stringify(cache));
  return cache;
}

/** One post's results from the cache (for its detail page). */
export function resultFor(postId: string): { result: PostResult; cache: ResultsCache } | null {
  const cache = loadResults();
  const result = cache?.posts.find((p) => p.postId === postId);
  return cache && result ? { result, cache } : null;
}

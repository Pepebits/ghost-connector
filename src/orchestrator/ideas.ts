import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { suggestIdeas } from '../agents/ideas.agent.js';
import { getConfig } from '../config.js';
import { recordExtraCost } from '../db/repo.js';
import { logger } from '../logger.js';
import { listPublished } from '../research/internalLinks.js';
import { bingConfigured, bingQueryStats } from '../research/bingWebmaster.js';
import { refreshFollowUps } from './snippet.js';
import { lowCtr, opportunities, searchAnalytics, searchAnalyticsRange, searchConsoleConfigured, type LowCtr, type Opportunity } from '../research/searchConsole.js';
import type { IdeasOutput } from '../types.js';
import { readPostSummaries } from '../state/postState.js';
import { capitalizeTitle } from '../util/title.js';

export interface SavedIdeas {
  at: string;
  ideas: IdeasOutput['ideas'];
  /** Whether Search Console queries were part of the input. */
  withSearchConsole: boolean;
}

const file = () => join(getConfig().DATA_DIR, 'ideas.json');
const historyFile = () => join(getConfig().DATA_DIR, 'ideas-history.json');

/** Stable id of an idea (its title), so the history survives regenerating. */
export const ideaId = (title: string) => createHash('sha1').update(title.trim().toLowerCase()).digest('hex').slice(0, 12);

export interface IdeaHistory {
  dismissed: Array<{ id: string; title: string; at: string }>;
  used: Array<{ id: string; title: string; postId: string; at: string }>;
}

export function loadIdeaHistory(): IdeaHistory {
  try {
    if (existsSync(historyFile())) return { dismissed: [], used: [], ...(JSON.parse(readFileSync(historyFile(), 'utf8')) as Partial<IdeaHistory>) };
  } catch {
    // A broken file just starts over.
  }
  return { dismissed: [], used: [] };
}

function saveIdeaHistory(h: IdeaHistory): void {
  mkdirSync(getConfig().DATA_DIR, { recursive: true });
  writeFileSync(historyFile(), JSON.stringify(h, null, 2));
}

const ideaTitle = (id: string) => loadIdeas()?.ideas.find((i) => ideaId(i.title) === id)?.title;

/** "Discard": hidden from the page and never proposed again. */
export function dismissIdea(id: string): boolean {
  const title = ideaTitle(id);
  if (!title) return false;
  const h = loadIdeaHistory();
  if (!h.dismissed.some((d) => d.id === id)) h.dismissed.push({ id, title, at: new Date().toISOString() });
  saveIdeaHistory(h);
  return true;
}

/** Undo a discard. */
export function restoreIdea(id: string): void {
  const h = loadIdeaHistory();
  saveIdeaHistory({ ...h, dismissed: h.dismissed.filter((d) => d.id !== id) });
}

/** The idea became a draft ("New post" from its card). */
export function markIdeaUsed(id: string, postId: string): void {
  const title = ideaTitle(id);
  if (!title) return;
  const h = loadIdeaHistory();
  saveIdeaHistory({ ...h, used: [...h.used.filter((u) => u.id !== id), { id, title, postId, at: new Date().toISOString() }] });
}

export function loadIdeas(): SavedIdeas | null {
  try {
    return existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf8')) as SavedIdeas) : null;
  } catch {
    return null;
  }
}

export interface OpportunityWithPost extends Opportunity {
  /** Title of the blog post that ranks for it, if it's one of the published ones. */
  postTitle: string | null;
}

/** Google Search Console and/or Bing Webmaster set up. */
export function searchSourcesConfigured(): boolean {
  return searchConsoleConfigured() || bingConfigured();
}

/** How many searches each engine returned, so an empty table can say why. */
export interface SearchScanned {
  google: number | null;
  bing: number | null;
}
interface SearchCache {
  at: string;
  /** Which engines/sites it was built with: a settings change invalidates it. */
  sources: string;
  list: OpportunityWithPost[];
  /** Google searches on page 1 with far fewer clicks than usual for the position. */
  lowCtr?: LowCtrWithPost[];
  scanned: SearchScanned;
}

export interface LowCtrWithPost extends LowCtr {
  postTitle: string | null;
}

const cacheFile = () => join(getConfig().DATA_DIR, 'search-opportunities.json');
const sourcesKey = () => {
  const cfg = getConfig();
  return JSON.stringify([searchConsoleConfigured() ? cfg.GSC_SITE_URL : null, bingConfigured() ? cfg.BING_SITE_URL : null]);
};

let cached: SearchCache | null = null;

function readCache(): SearchCache | null {
  if (!cached) {
    try {
      cached = existsSync(cacheFile()) ? (JSON.parse(readFileSync(cacheFile(), 'utf8')) as SearchCache) : null;
    } catch {
      cached = null;
    }
  }
  return cached && cached.sources === sourcesKey() ? cached : null;
}

/** The saved table's metadata: when it was fetched and how many rows were behind it. */
export function searchCacheInfo(): { at: string; scanned: SearchScanned; lowCtr: LowCtrWithPost[] } | null {
  const c = readCache();
  return c ? { at: c.at, scanned: c.scanned, lowCtr: c.lowCtr ?? [] } : null;
}

// Bing comes aggregated by week and with far less traffic: 28 days rarely
// leaves anything, so it looks back a quarter.
const BING_DAYS = 90;

const bare = (url: string) => url.replace(/[?#].*$/, '').replace(/\/+$/, '');

/**
 * "Almost there" searches, with the post that ranks for each. Saved to disk
 * until the user refreshes (the data lags days anyway) or the sources change.
 */
export async function searchOpportunities(force = false): Promise<OpportunityWithPost[]> {
  const saved = force ? null : readCache();
  if (saved) return saved.list;
  const [google, bing, posts] = await Promise.all([
    searchConsoleConfigured() ? searchAnalytics() : [],
    bingConfigured() ? bingQueryStats(BING_DAYS) : [],
    listPublished().catch(() => []),
  ]);
  const rows = [...google, ...bing];
  if (searchConsoleConfigured()) await refreshFollowUps((start, end, page) => searchAnalyticsRange(start, end, undefined, undefined, page));
  const byUrl = new Map(posts.map((p) => [bare(p.url), p.title]));
  const list = opportunities(rows).map((o) => ({ ...o, postTitle: o.page ? (byUrl.get(bare(o.page)) ?? null) : null }));
  const queries = (rows: { query: string }[]) => new Set(rows.map((r) => r.query.toLowerCase())).size;
  cached = {
    at: new Date().toISOString(),
    sources: sourcesKey(),
    list,
    lowCtr: lowCtr(google).map((o) => ({ ...o, postTitle: byUrl.get(bare(o.page)) ?? null })),
    scanned: { google: searchConsoleConfigured() ? queries(google) : null, bing: bingConfigured() ? queries(bing) : null },
  };
  mkdirSync(getConfig().DATA_DIR, { recursive: true });
  writeFileSync(cacheFile(), JSON.stringify(cached, null, 2));
  return list;
}

/** Asks the AI for topic ideas from the published posts (and Search Console if configured), and saves them. */
export async function generateIdeas(): Promise<SavedIdeas> {
  const posts = await listPublished();
  let queries: Opportunity[] = [];
  if (searchSourcesConfigured()) {
    try {
      queries = (await searchOpportunities()).slice(0, 20);
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Search data unavailable: ideas from the posts only');
    }
  }
  const history = loadIdeaHistory();
  const avoid = [...history.dismissed, ...history.used].map((h) => h.title).slice(-60);
  const drafts = readPostSummaries().map((d) => d.title).filter(Boolean).slice(0, 100);
  const { data, usage } = await suggestIdeas({ posts: posts.map((p) => ({ title: p.title, excerpt: p.excerpt })), drafts, avoid, queries });
  recordExtraCost({ agent: 'ideas', usd: usage.usd ?? 0, tokensIn: usage.inputTokens, tokensOut: usage.outputTokens });
  const titles = new Set(posts.map((p) => p.title));
  const saved: SavedIdeas = {
    at: new Date().toISOString(),
    ideas: data.ideas.map((i) => ({ ...i, title: capitalizeTitle(i.title), related: i.related.filter((r) => titles.has(r)) })),
    withSearchConsole: queries.length > 0,
  };
  mkdirSync(getConfig().DATA_DIR, { recursive: true });
  writeFileSync(file(), JSON.stringify(saved, null, 2));
  return saved;
}

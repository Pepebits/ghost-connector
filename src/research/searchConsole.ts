import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { getConfig } from '../config.js';
import { withRetry } from '../util/retry.js';

/**
 * Google Search Console (read-only), with a service account: create one in
 * Google Cloud, download its JSON key and add its email as a user of the
 * property in Search Console. No OAuth flow, no extra dependency: the token
 * request is a JWT signed here (RS256).
 */

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** GSC_SERVICE_ACCOUNT: the JSON key itself, or the path to the file. */
export function loadServiceAccount(value: string): ServiceAccount {
  const text = value.trim().startsWith('{') ? value : existsSync(value.trim()) ? readFileSync(value.trim(), 'utf8') : '';
  if (!text) throw new Error('GSC_SERVICE_ACCOUNT is neither JSON nor an existing file');
  let parsed: Partial<ServiceAccount>;
  try {
    parsed = JSON.parse(text) as Partial<ServiceAccount>;
  } catch {
    // Pasted into .env, the key's "\n" can come back as real line breaks inside the string.
    parsed = JSON.parse(text.replace(/\r?\n/g, '\\n')) as Partial<ServiceAccount>;
  }
  if (!parsed.client_email || !parsed.private_key) throw new Error('The service account key has no client_email/private_key');
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

const b64url = (input: string | Buffer) => Buffer.from(input).toString('base64url');

/** Signed assertion for the token endpoint (exported for the tests). */
export function signedJwt(sa: ServiceAccount, now = Math.floor(Date.now() / 1000)): string {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signature = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(sa.private_key);
  return `${head}.${claims}.${b64url(signature)}`;
}

let token: { value: string; until: number; email: string } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (token && token.email === sa.client_email && Date.now() < token.until) return token.value;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signedJwt(sa) }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !data.access_token) throw new Error(`Google rejected the service account (${res.status}): ${data.error_description ?? data.error ?? 'no token'}`);
  token = { value: data.access_token, until: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000, email: sa.client_email };
  return data.access_token;
}

export interface SearchRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  /** Average position (1 = top). */
  position: number;
  /** Where the row comes from (Google when missing). */
  source?: SearchSource;
}

export type SearchSource = 'google' | 'bing';

export function searchConsoleConfigured(): boolean {
  const cfg = getConfig();
  return !!cfg.GSC_SITE_URL && !!cfg.GSC_SERVICE_ACCOUNT;
}

/** Query x page for the last `days` days (Search Console data lags ~2-3 days). */
export async function searchAnalytics(days = 28, site = getConfig().GSC_SITE_URL, account = getConfig().GSC_SERVICE_ACCOUNT): Promise<SearchRow[]> {
  const end = new Date(Date.now() - 2 * 86400_000);
  return searchAnalyticsRange(new Date(end.getTime() - (days - 1) * 86400_000), end, site, account);
}

/** Same, between two dates (inclusive), optionally for one page only. */
export type GscDimension = 'query' | 'page' | 'date';

export interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** One Search Analytics query, any dimensions, paging through every row (25,000 per request). */
export async function searchAnalyticsQuery(o: {
  start: Date;
  end: Date;
  dimensions: GscDimension[];
  page?: string;
  site?: string;
  account?: string;
  maxRows?: number;
}): Promise<GscRow[]> {
  const site = o.site ?? getConfig().GSC_SITE_URL;
  const sa = loadServiceAccount(o.account ?? getConfig().GSC_SERVICE_ACCOUNT);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const pageSize = 25_000;
  const max = o.maxRows ?? 100_000;
  const all: GscRow[] = [];
  for (let startRow = 0; startRow < max; startRow += pageSize) {
    const rows = await withRetry(async () => {
      const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await accessToken(sa)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: day(o.start),
          endDate: day(o.end),
          dimensions: o.dimensions,
          rowLimit: Math.min(pageSize, max - startRow),
          startRow,
          ...(o.page ? { dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'equals', expression: o.page }] }] } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        const err = new Error(`Search Console answered ${res.status}: ${body.slice(0, 200)}`) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      return ((await res.json()) as { rows?: GscRow[] }).rows ?? [];
    });
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

export async function searchAnalyticsRange(start: Date, end: Date, site = getConfig().GSC_SITE_URL, account = getConfig().GSC_SERVICE_ACCOUNT, page?: string): Promise<SearchRow[]> {
  const rows = await searchAnalyticsQuery({ start, end, dimensions: ['query', 'page'], page, site, account, maxRows: 5000 });
  return rows.map((r) => ({ query: r.keys[0]!, page: r.keys[1]!, clicks: r.clicks, impressions: r.impressions, position: r.position, source: 'google' as const }));
}

export interface Opportunity {
  query: string;
  impressions: number;
  clicks: number;
  position: number;
  /** Page of the blog that ranks for it (the one with most impressions; empty if only Bing knows it). */
  page: string;
  sources: SearchSource[];
}

/**
 * "Almost there" searches: shown on page 1-2 of Google (average position
 * 8-20) with real impressions, on Google and/or Bing, but few clicks. A new post, or a better one,
 * can move them to the first page.
 */
export function opportunities(rows: SearchRow[], opts: { minImpressions?: number; max?: number } = {}): Opportunity[] {
  // Grouped case-insensitively, so Google and Bing rows for the same search add up.
  const byQuery = new Map<string, { query: string; impressions: number; clicks: number; weighted: number; page: string; pageImpr: number; sources: Set<SearchSource> }>();
  for (const r of rows) {
    const key = r.query.trim().toLowerCase();
    const q = byQuery.get(key) ?? { query: r.query, impressions: 0, clicks: 0, weighted: 0, page: '', pageImpr: 0, sources: new Set() };
    q.impressions += r.impressions;
    q.clicks += r.clicks;
    q.weighted += r.position * r.impressions;
    q.sources.add(r.source ?? 'google');
    if (r.page && r.impressions > q.pageImpr) {
      q.page = r.page;
      q.pageImpr = r.impressions;
    }
    byQuery.set(key, q);
  }
  return [...byQuery.values()]
    .map((q) => ({ query: q.query, impressions: q.impressions, clicks: q.clicks, position: q.weighted / (q.impressions || 1), page: q.page, sources: [...q.sources].sort().reverse() }))
    .filter((o) => o.position >= 8 && o.position <= 20 && o.impressions >= (opts.minImpressions ?? 10))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, opts.max ?? 30);
}

/** Typical organic CTR by position (page 1), from public CTR studies; rough on purpose. */
const EXPECTED_CTR = [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03];

export interface LowCtr {
  query: string;
  page: string;
  impressions: number;
  clicks: number;
  position: number;
  ctr: number;
  expectedCtr: number;
}

/**
 * "Good position, few clicks": Google searches at positions 1-7 with real
 * impressions and less than half the usual CTR. The post ranks, but its
 * title or meta description doesn't convince: rewriting them is the cheap fix.
 * Google only: Bing gives no page.
 */
export function lowCtr(rows: SearchRow[], opts: { minImpressions?: number; max?: number } = {}): LowCtr[] {
  const byKey = new Map<string, LowCtr & { weighted: number }>();
  for (const r of rows) {
    if ((r.source ?? 'google') !== 'google' || !r.page) continue;
    const key = `${r.query.trim().toLowerCase()}\n${r.page}`;
    const q = byKey.get(key) ?? { query: r.query, page: r.page, impressions: 0, clicks: 0, position: 0, ctr: 0, expectedCtr: 0, weighted: 0 };
    q.impressions += r.impressions;
    q.clicks += r.clicks;
    q.weighted += r.position * r.impressions;
    byKey.set(key, q);
  }
  return [...byKey.values()]
    .map(({ weighted, ...q }) => {
      const position = weighted / (q.impressions || 1);
      const expectedCtr = EXPECTED_CTR[Math.min(EXPECTED_CTR.length, Math.max(1, Math.round(position))) - 1] ?? 0;
      return { ...q, position, ctr: q.clicks / (q.impressions || 1), expectedCtr };
    })
    .filter((q) => q.position < 7.5 && q.impressions >= (opts.minImpressions ?? 50) && q.ctr < q.expectedCtr / 2)
    .sort((a, b) => b.impressions * (b.expectedCtr - b.ctr) - a.impressions * (a.expectedCtr - a.ctr))
    .slice(0, opts.max ?? 15);
}

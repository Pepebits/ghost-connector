import { getConfig } from '../config.js';
import { withRetry } from '../util/retry.js';
import type { SearchRow } from './searchConsole.js';

/**
 * Bing Webmaster Tools (read-only), with the API key from Settings → API
 * access in Bing Webmaster. GetQueryStats has no page dimension and comes
 * aggregated by week, so rows carry an empty page.
 */

export function bingConfigured(): boolean {
  const cfg = getConfig();
  return !!cfg.BING_SITE_URL && !!cfg.BING_API_KEY;
}

interface BingQueryStat {
  Query: string;
  Impressions: number;
  Clicks: number;
  AvgImpressionPosition: number;
  /** WCF date: "/Date(1700000000000)/" */
  Date: string;
}

const wcfDate = (value: string) => Number(/\/Date\((-?\d+)/.exec(value)?.[1] ?? NaN);

/** Converts GetQueryStats rows (exported for the tests): only the last `days` days, valid positions. */
export function bingRows(stats: BingQueryStat[], days: number, now = Date.now()): SearchRow[] {
  const since = now - days * 86400_000;
  return stats
    .filter((s) => s.Query && s.Impressions > 0 && s.AvgImpressionPosition > 0 && !(wcfDate(s.Date) < since))
    .map((s) => ({ query: s.Query, page: '', clicks: s.Clicks, impressions: s.Impressions, position: s.AvgImpressionPosition, source: 'bing' as const }));
}

export async function bingQueryStats(days = 28, site = getConfig().BING_SITE_URL, key = getConfig().BING_API_KEY): Promise<SearchRow[]> {
  const url = `https://ssl.bing.com/webmaster/api.svc/json/GetQueryStats?${new URLSearchParams({ siteUrl: site, apikey: key })}`;
  const stats = await withRetry(async () => {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const body = await res.text();
      const err = new Error(`Bing Webmaster answered ${res.status}: ${body.slice(0, 200)}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return ((await res.json()) as { d?: BingQueryStat[] }).d ?? [];
  });
  return bingRows(stats, days);
}

interface BingPageStat {
  /** The page URL (Bing reuses the "Query" field). */
  Query: string;
  Impressions: number;
  Clicks: number;
  AvgImpressionPosition: number;
  Date: string;
}

export interface BingPageRow {
  page: string;
  /** YYYY-MM-DD: Bing aggregates by week. */
  date: string;
  clicks: number;
  impressions: number;
  position: number;
}

/** Converts GetPageStats rows (exported for the tests). */
export function bingPageRows(stats: BingPageStat[]): BingPageRow[] {
  return stats
    .filter((s) => s.Query && Number.isFinite(wcfDate(s.Date)))
    .map((s) => ({ page: s.Query, date: new Date(wcfDate(s.Date)).toISOString().slice(0, 10), clicks: s.Clicks, impressions: s.Impressions, position: s.AvgImpressionPosition > 0 ? s.AvgImpressionPosition : 0 }));
}

/** Weekly clicks and impressions per page, for about the last year and a half. */
export async function bingPageStats(site = getConfig().BING_SITE_URL, key = getConfig().BING_API_KEY): Promise<BingPageRow[]> {
  const url = `https://ssl.bing.com/webmaster/api.svc/json/GetPageStats?${new URLSearchParams({ siteUrl: site, apikey: key })}`;
  const stats = await withRetry(async () => {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const body = await res.text();
      const err = new Error(`Bing Webmaster answered ${res.status}: ${body.slice(0, 200)}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return ((await res.json()) as { d?: BingPageStat[] }).d ?? [];
  });
  return bingPageRows(stats);
}

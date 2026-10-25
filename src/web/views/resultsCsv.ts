import { t } from '../../i18n/index.js';
import { change, type Metrics, type PostResult, type ResultsCache } from '../../research/results.js';
import { resultsView, sorted, type ResultsScope, type ResultsSort } from './results.js';

/**
 * Results as CSV (RFC 4180, comma-separated, CRLF, UTF-8 with BOM so Excel
 * reads the accents). Built from the cache: exporting never asks Google or Bing.
 */

/**
 * One cell. Text a spreadsheet would run as a formula (= + - @, tab, CR)
 * gets a leading apostrophe: a post title or a search query is untrusted.
 * Numbers go as they are (a negative change is not a formula).
 */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 10000) / 10000) : '';
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const ctr = (m: Metrics) => (m.impressions ? m.clicks / m.impressions : null);
const pos = (m: Metrics) => (m.impressions ? m.position : null);
const c = (k: string) => t(`results.csv.${k}`);

/** The list as shown (same scope and order), one row per post. */
export function resultsCsv(cache: ResultsCache, scope?: ResultsScope, sort?: ResultsSort): string {
  const v = resultsView(cache, scope, sort);
  const head = [
    c('title'), c('url'), c('postId'), c('published'), c('changedByPanel'),
    c('clicks'), c('impressions'), c('ctr'), c('position'),
    c('prevClicks'), c('prevImpressions'), c('prevCtr'), c('prevPosition'),
    c('clicksChange'), c('periodStart'), c('periodEnd'), c('prevStart'), c('prevEnd'), c('sources'),
  ];
  const rows = sorted(v.posts, v.sort).map((p) => [
    p.title, p.url, p.postId, p.publishedAt?.slice(0, 10), p.appliedAt.map((d) => d.slice(0, 10)).join(' '),
    p.current.clicks, p.current.impressions, ctr(p.current), pos(p.current),
    p.previous.clicks, p.previous.impressions, ctr(p.previous), pos(p.previous),
    change(p.current.clicks, p.previous.clicks),
    cache.current.start, cache.current.end, cache.previous.start, cache.previous.end, cache.sources.join('+'),
  ]);
  return toCsv([head, ...rows]);
}

/** One post: its weekly series, then its top queries. */
export function postResultsCsv(r: PostResult): string {
  return toCsv([
    [c('weekStart'), c('clicks'), c('impressions')],
    ...r.weekly.map((w) => [w.start, w.clicks, w.impressions]),
    [],
    [c('query'), c('clicks'), c('impressions'), c('position')],
    ...r.queries.map((q) => [q.query, q.clicks, q.impressions, q.position]),
  ]);
}

/** A safe download name: "results-2026-10-25.csv", "results-my-post-2026-10-25.csv". */
export function csvFilename(at: string, slugOf?: string): string {
  const slug = (slugOf ?? '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_-]+/g, '-').slice(0, 60).replace(/-$/, '');
  return `${c('file')}${slug ? `-${slug}` : ''}-${at.slice(0, 10)}.csv`;
}

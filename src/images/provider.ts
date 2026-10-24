import { t } from '../i18n/index.js';
import type { ImagePlan } from '../types.js';

export interface ImageAttribution {
  provider: 'unsplash' | 'pixabay' | 'pexels' | 'openverse' | 'wikimedia' | 'generated';
  authorName?: string;
  authorUrl?: string;
  providerUrl?: string;
  licenseNote: string;
  /** Openverse: work title and license text URL, to rebuild the credit in another language. */
  title?: string;
  licenseUrl?: string;
  /** Credit as built at search time (English); formatCredit() rebuilds it in the post's language. */
  htmlCredit: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Link for the caption (goes as is into Ghost's caption HTML). The
 * names and titles come from third parties (on Openverse, any Flickr
 * user): they're escaped, and only http(s) URLs are linked (never javascript:).
 */
export function creditLink(text: string, url: string | undefined | null): string {
  const label = escapeHtml(text);
  if (!url) return label;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return label;
    return `<a href="${escapeHtml(u.toString())}">${label}</a>`;
  } catch {
    return label;
  }
}

const PROVIDER_NAMES = { unsplash: 'Unsplash', pixabay: 'Pixabay', pexels: 'Pexels' } as const;

/**
 * Caption credit in the POST's language (not the UI's): it ends up
 * published under the image. Falls back to the stored htmlCredit when
 * the attribution lacks the fields to rebuild it (older plans).
 */
export function formatCredit(a: ImageAttribution, lang: string): string {
  if (a.provider === 'pixabay' && a.authorName) {
    return t('image.credit.pixabay', { author: creditLink(a.authorName, a.authorUrl), provider: creditLink(PROVIDER_NAMES.pixabay, a.providerUrl) }, lang);
  }
  if ((a.provider === 'unsplash' || a.provider === 'pexels') && a.authorName) {
    return t('image.credit.photo', { author: creditLink(a.authorName, a.authorUrl), provider: creditLink(PROVIDER_NAMES[a.provider], a.providerUrl) }, lang);
  }
  if ((a.provider === 'openverse' || a.provider === 'wikimedia') && a.licenseUrl !== undefined) {
    const title = a.title ? creditLink(`"${a.title}"`, a.providerUrl) : creditLink(t('image.credit.image', undefined, lang), a.providerUrl);
    const by = a.authorName ? t('image.credit.by', { author: creditLink(a.authorName, a.authorUrl) }, lang) : '';
    return t(`image.credit.${a.provider}`, { title, by, license: creditLink(a.licenseNote, a.licenseUrl) }, lang);
  }
  return a.htmlCredit;
}

/** Generic HTTP error with status, so util/retry.ts knows whether to retry. */
export class HttpStatusError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Hourly quota exhausted (Unsplash 403, Pexels 429): not a transient
 * throttle that a few seconds of backoff will fix, so it isn't marked
 * as retryable even though the status (429) normally would be.
 */
export class QuotaExhaustedError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'QuotaExhaustedError';
  }
}

export interface ImageCandidate {
  buffer: Buffer;
  contentType: string;
  filename: string;
  sourceUrl: string;
  attribution: ImageAttribution | null;
}

export interface ImageProvider {
  readonly name: string;
  supports(strategy: ImagePlan['strategy']): boolean;
  acquire(plan: ImagePlan, ctx: { postTitle: string }): Promise<ImageCandidate | null>;
}

/**
 * A photo found in a stock source, NOT downloaded: what the UI
 * shows for choosing. It's stored in the plan and only the one the editor
 * picks is downloaded (and uploaded to Ghost), on apply.
 */
export interface ImageOption {
  provider: 'unsplash' | 'pixabay' | 'pexels' | 'openverse' | 'wikimedia';
  id: string;
  /** Thumbnail for the grid (hotlinked, as Unsplash and Pexels require). */
  thumbUrl: string;
  /** The one downloaded if chosen. */
  downloadUrl: string;
  width: number | null;
  height: number | null;
  /** The photo's page on its source. */
  pageUrl: string | null;
  attribution: ImageAttribution;
  /** Unsplash: download_location, which must be notified when it's used. */
  trackUrl?: string;
}

/** Stock source that can search for candidates and download the chosen one. */
export interface StockSource extends ImageProvider {
  readonly name: ImageOption['provider'];
  /** null = the source isn't configured (no key or disabled). */
  searchOptions(query: string, orientation: ImagePlan['orientation'], limit: number): Promise<ImageOption[] | null>;
  download(option: ImageOption): Promise<ImageCandidate>;
}

/** Those matching the requested size and aspect ratio first (stable order). */
export function bestFirst<T extends { width: number | null; height: number | null }>(items: T[], minWidth = 1600, minRatio = 1.4): T[] {
  const good = (x: T) => (x.width ?? 0) >= minWidth && (x.width ?? 0) / (x.height || 1) >= minRatio;
  return [...items.filter(good), ...items.filter((x) => !good(x))];
}

export function degradeQuery(query: string): string {
  const words = query.trim().split(/\s+/);
  return words.length > 1 ? words.slice(0, -1).join(' ') : query;
}

/** The classic acquire() built from searchOptions/download: the first good candidate. */
export async function acquireFirst(source: StockSource, plan: ImagePlan): Promise<ImageCandidate | null> {
  if (!plan.unsplash_query) return null;
  let options = await source.searchOptions(plan.unsplash_query, plan.orientation, 10);
  if (options && options.length === 0) {
    const degraded = degradeQuery(plan.unsplash_query);
    if (degraded !== plan.unsplash_query) options = await source.searchOptions(degraded, plan.orientation, 10);
  }
  const first = options?.[0];
  return first ? source.download(first) : null;
}

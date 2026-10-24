import { getConfig } from '../config.js';
import { recordProviderCall } from '../db/repo.js';
import type { ImagePlan } from '../types.js';
import { openverseLimiter } from '../util/limiter.js';
import { withRetry } from '../util/retry.js';
import { openverseAuthHeaders } from './openverseAuth.js';
import { acquireFirst, bestFirst, creditLink, HttpStatusError, QuotaExhaustedError, type ImageCandidate, type ImageOption, type StockSource } from './provider.js';
import { safeFetch } from '../util/safeFetch.js';

/** Subset of the /v1/images/ response (see https://api.openverse.org/v1/schema/). */
interface OpenverseImage {
  id: string;
  title: string | null;
  url: string;
  thumbnail?: string | null;
  creator: string | null;
  creator_url: string | null;
  license: string;
  license_version: string | null;
  license_url: string | null;
  source: string;
  foreign_landing_url: string | null;
  width: number | null;
  height: number | null;
  filetype: string | null;
}

interface OpenverseSearchResponse {
  results: OpenverseImage[];
}

/** A Flickr/Wikimedia image can be very large; anything above this isn't downloaded. */
const MAX_BYTES = 15 * 1024 * 1024;

const ASPECT: Record<ImagePlan['orientation'], string> = { landscape: 'wide', portrait: 'tall', squarish: 'square' };

const LICENSE_LABELS: Record<string, string> = {
  cc0: 'CC0',
  pdm: 'Dominio público',
  by: 'CC BY',
  'by-sa': 'CC BY-SA',
};


/**
 * Requests left today. The header name changes depending on the rate-limit
 * model (anon_sustained without credentials, standard_sustained with them...).
 */
export function remainingFrom(headers: Headers): number | null {
  for (const [name, value] of headers) {
    if (/^x-ratelimit-available-.*sustained$/i.test(name)) return Number.parseInt(value, 10);
  }
  return null;
}

/** License text for the caption: "CC BY 2.0" linked to its legal text. */
function licenseLabel(img: OpenverseImage): string {
  const base = LICENSE_LABELS[img.license] ?? img.license.toUpperCase();
  return img.license_version && img.license !== 'pdm' ? `${base} ${img.license_version}` : base;
}

/**
 * Attribution in the style Creative Commons asks for (TASL: title, author,
 * source, license), all escaped: anyone can write the title and author.
 */
export function openverseCredit(img: OpenverseImage): string {
  const title = img.title?.trim() ? creditLink(`"${img.title.trim()}"`, img.foreign_landing_url) : creditLink('Image', img.foreign_landing_url);
  const author = img.creator?.trim() ? ` by ${creditLink(img.creator.trim(), img.creator_url)}` : '';
  return `${title}${author} via Openverse, ${creditLink(licenseLabel(img), img.license_url)}`;
}

/**
 * Third stock source (after Unsplash and Pexels): the Openverse
 * catalog aggregates Flickr, Wikimedia Commons, StockSnap and others, all with
 * open licenses. No key needed (with OPENVERSE_CLIENT_ID/SECRET it uses
 * an OAuth2 token and gets more quota). Only licenses that
 * allow commercial use and modification are requested (OPENVERSE_LICENSES, default
 * cc0, pdm and by) and attribution always goes in the caption.
 */
export class OpenverseProvider implements StockSource {
  readonly name = 'openverse';

  supports(strategy: ImagePlan['strategy']): boolean {
    return strategy === 'unsplash';
  }

  acquire(plan: ImagePlan): Promise<ImageCandidate | null> {
    return acquireFirst(this, plan);
  }

  async searchOptions(query: string, orientation: ImagePlan['orientation'], limit: number): Promise<ImageOption[] | null> {
    const cfg = getConfig();
    if (!cfg.OPENVERSE_ENABLED) return null;
    const results = await openverseLimiter(() =>
      withRetry(async () => {
        const url = new URL('https://api.openverse.org/v1/images/');
        url.searchParams.set('q', query.slice(0, 200));
        url.searchParams.set('license', cfg.OPENVERSE_LICENSES);
        url.searchParams.set('category', 'photograph');
        url.searchParams.set('aspect_ratio', ASPECT[orientation] ?? 'wide');
        url.searchParams.set('size', 'large');
        url.searchParams.set('mature', 'false');
        url.searchParams.set('filter_dead', 'true');
        url.searchParams.set('page_size', String(Math.min(limit, 20)));

        const baseHeaders = { 'User-Agent': `ghost-connector (${cfg.UNSPLASH_APP_NAME})` };
        let res = await fetch(url, { headers: { ...baseHeaders, ...(await openverseAuthHeaders()) } });
        // Expired or revoked token: renewed once and, if it still fails, search without a token.
        if (res.status === 401) {
          const fresh = await openverseAuthHeaders({ forceRefresh: true });
          res = await fetch(url, { headers: { ...baseHeaders, ...fresh } });
          if (res.status === 401) res = await fetch(url, { headers: baseHeaders });
        }
        recordProviderCall({ provider: 'openverse', kind: 'search', status: res.status, remaining: remainingFrom(res.headers) });
        if (res.status === 429) throw new QuotaExhaustedError('Openverse: request limit reached (429)', 429);
        if (!res.ok) throw new HttpStatusError(`Openverse search failed: ${res.status}`, res.status);
        return ((await res.json()) as OpenverseSearchResponse).results;
      }),
    );
    const usable = results.filter((r) => r.url && (r.filetype ?? 'jpg') !== 'gif' && r.filetype !== 'svg');
    return bestFirst(
      usable.map(
        (img): ImageOption => ({
          provider: 'openverse',
          id: img.id,
          thumbUrl: img.thumbnail || img.url,
          downloadUrl: img.url,
          width: img.width,
          height: img.height,
          pageUrl: img.foreign_landing_url,
          attribution: {
            provider: 'openverse',
            authorName: img.creator ?? undefined,
            authorUrl: img.creator_url ?? undefined,
            providerUrl: img.foreign_landing_url ?? undefined,
            licenseNote: licenseLabel(img),
            title: img.title?.trim() || undefined,
            licenseUrl: img.license_url ?? '',
            htmlCredit: openverseCredit(img),
          },
        }),
      ),
    );
  }

  async download(option: ImageOption): Promise<ImageCandidate> {
    const { buffer, contentType } = await openverseLimiter(() =>
      withRetry(async () => {
        const res = await safeFetch(option.downloadUrl, { timeoutMs: 30_000 });
        if (!res.ok) throw new HttpStatusError(`Openverse: could not download the image (${res.status})`, res.status);
        const type = res.headers.get('content-type') ?? '';
        if (!type.startsWith('image/')) throw new HttpStatusError(`Openverse: the URL is not an image (${type || 'no type'})`, 415);
        const declared = Number(res.headers.get('content-length') ?? 0);
        if (declared > MAX_BYTES) throw new HttpStatusError('Openverse: image too large', 413);
        const data = Buffer.from(await res.arrayBuffer());
        if (data.length > MAX_BYTES) throw new HttpStatusError('Openverse: image too large', 413);
        return { buffer: data, contentType: type.split(';')[0]! };
      }),
    );
    const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
    return { buffer, contentType, filename: `openverse-${option.id}.${ext}`, sourceUrl: option.downloadUrl, attribution: option.attribution };
  }
}

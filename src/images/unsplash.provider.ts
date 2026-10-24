import { getConfig } from '../config.js';
import { recordProviderCall } from '../db/repo.js';
import type { ImagePlan } from '../types.js';
import { unsplashLimiter } from '../util/limiter.js';
import { withRetry } from '../util/retry.js';
import { acquireFirst, bestFirst, creditLink, HttpStatusError, QuotaExhaustedError, type ImageCandidate, type ImageOption, type StockSource } from './provider.js';

export { QuotaExhaustedError };

function remainingFrom(res: Response): number | null {
  const header = res.headers.get('x-ratelimit-remaining');
  return header ? Number.parseInt(header, 10) : null;
}

interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  urls: { regular: string; raw: string; small: string };
  links: { html: string; download_location: string };
  user: { name: string; links: { html: string } };
}

interface UnsplashSearchResponse {
  results: UnsplashPhoto[];
}

/**
 * Unsplash's terms require firing a GET to `download_location`
 * every time the app "downloads" a photo, in addition to the visible attribution.
 * See https://unsplash.com/documentation#track-a-photo-download
 */
export class UnsplashProvider implements StockSource {
  readonly name = 'unsplash';

  supports(strategy: ImagePlan['strategy']): boolean {
    return strategy === 'unsplash';
  }

  acquire(plan: ImagePlan): Promise<ImageCandidate | null> {
    return acquireFirst(this, plan);
  }

  async searchOptions(query: string, orientation: ImagePlan['orientation'], limit: number): Promise<ImageOption[] | null> {
    const cfg = getConfig();
    if (!cfg.UNSPLASH_ACCESS_KEY) return null;
    const key = cfg.UNSPLASH_ACCESS_KEY;
    const photos = await unsplashLimiter(() =>
      withRetry(async () => {
        const url = new URL('https://api.unsplash.com/search/photos');
        url.searchParams.set('query', query);
        url.searchParams.set('orientation', orientation);
        url.searchParams.set('per_page', String(Math.min(limit, 30)));
        url.searchParams.set('content_filter', 'high');

        const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}` } });
        recordProviderCall({ provider: 'unsplash', kind: 'search', status: res.status, remaining: remainingFrom(res) });
        // 403 = quota exhausted: not transient, no point retrying.
        if (res.status === 403) throw new QuotaExhaustedError('Unsplash: quota exhausted (403)', 403);
        if (!res.ok) throw new HttpStatusError(`Unsplash search failed: ${res.status}`, res.status);
        return ((await res.json()) as UnsplashSearchResponse).results;
      }),
    );
    const utm = `utm_source=${encodeURIComponent(cfg.UNSPLASH_APP_NAME)}&utm_medium=referral`;
    const providerUrl = `https://unsplash.com/?${utm}`;
    return bestFirst(
      photos.map((p): ImageOption => {
        const authorUrl = `${p.user.links.html}?${utm}`;
        return {
          provider: 'unsplash',
          id: p.id,
          thumbUrl: p.urls.small,
          downloadUrl: `${p.urls.raw}&w=2000&fm=jpg&q=80`,
          width: p.width,
          height: p.height,
          pageUrl: `${p.links.html}?${utm}`,
          trackUrl: p.links.download_location,
          attribution: {
            provider: 'unsplash',
            authorName: p.user.name,
            authorUrl,
            providerUrl,
            licenseNote: 'Unsplash License',
            htmlCredit: `Photo by ${creditLink(p.user.name, authorUrl)} on ${creditLink('Unsplash', providerUrl)}`,
          },
        };
      }),
    );
  }

  async download(option: ImageOption): Promise<ImageCandidate> {
    const key = getConfig().UNSPLASH_ACCESS_KEY;
    if (option.trackUrl && key) await this.triggerDownload(option.trackUrl, key);
    const buffer = await unsplashLimiter(() =>
      withRetry(async () => {
        const res = await fetch(option.downloadUrl);
        if (!res.ok) throw new HttpStatusError(`Unsplash: could not download the image (${res.status})`, res.status);
        return Buffer.from(await res.arrayBuffer());
      }),
    );
    return { buffer, contentType: 'image/jpeg', filename: `${option.id}.jpg`, sourceUrl: option.downloadUrl, attribution: option.attribution };
  }

  private async triggerDownload(downloadLocation: string, key: string): Promise<void> {
    await unsplashLimiter(() =>
      withRetry(async () => {
        const res = await fetch(downloadLocation, { headers: { Authorization: `Client-ID ${key}` } });
        recordProviderCall({ provider: 'unsplash', kind: 'download', status: res.status, remaining: remainingFrom(res) });
        if (!res.ok) throw new HttpStatusError(`Unsplash download_location failed: ${res.status}`, res.status);
      }),
    );
  }
}

import { getConfig } from '../config.js';
import { recordProviderCall } from '../db/repo.js';
import type { ImagePlan } from '../types.js';
import { pexelsLimiter } from '../util/limiter.js';
import { withRetry } from '../util/retry.js';
import { acquireFirst, bestFirst, creditLink, HttpStatusError, QuotaExhaustedError, type ImageCandidate, type ImageOption, type StockSource } from './provider.js';

function remainingFrom(res: Response): number | null {
  const header = res.headers.get('x-ratelimit-remaining');
  return header ? Number.parseInt(header, 10) : null;
}

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  src: { original: string; large2x: string; medium: string };
}

interface PexelsSearchResponse {
  photos: PexelsPhoto[];
}

/**
 * Pexels doesn't require a "trigger download" step like Unsplash; its license
 * doesn't legally require attribution, but it's added anyway as good practice.
 * Limit: 200 req/h on the free tier.
 */
export class PexelsProvider implements StockSource {
  readonly name = 'pexels';

  supports(strategy: ImagePlan['strategy']): boolean {
    return strategy === 'unsplash';
  }

  acquire(plan: ImagePlan): Promise<ImageCandidate | null> {
    return acquireFirst(this, plan);
  }

  async searchOptions(query: string, orientation: ImagePlan['orientation'], limit: number): Promise<ImageOption[] | null> {
    const key = getConfig().PEXELS_API_KEY;
    if (!key) return null;
    // Pexels uses "square", not "squarish" (Unsplash's own vocabulary that ImagePlan reuses).
    const pexelsOrientation = orientation === 'squarish' ? 'square' : orientation;
    const photos = await pexelsLimiter(() =>
      withRetry(async () => {
        const url = new URL('https://api.pexels.com/v1/search');
        url.searchParams.set('query', query);
        url.searchParams.set('orientation', pexelsOrientation);
        url.searchParams.set('per_page', String(Math.min(limit, 40)));

        const res = await fetch(url, { headers: { Authorization: key } });
        recordProviderCall({ provider: 'pexels', kind: 'search', status: res.status, remaining: remainingFrom(res) });
        if (res.status === 429) throw new QuotaExhaustedError('Pexels: quota exhausted (429)', 429);
        if (!res.ok) throw new HttpStatusError(`Pexels search failed: ${res.status}`, res.status);
        return ((await res.json()) as PexelsSearchResponse).photos;
      }),
    );
    return bestFirst(
      photos.map(
        (p): ImageOption => ({
          provider: 'pexels',
          id: String(p.id),
          thumbUrl: p.src.medium,
          downloadUrl: p.src.large2x,
          width: p.width,
          height: p.height,
          pageUrl: p.url,
          attribution: {
            provider: 'pexels',
            authorName: p.photographer,
            authorUrl: p.photographer_url,
            providerUrl: p.url,
            licenseNote: 'Pexels License',
            htmlCredit: `Photo by ${creditLink(p.photographer, p.photographer_url)} on ${creditLink('Pexels', p.url)}`,
          },
        }),
      ),
    );
  }

  async download(option: ImageOption): Promise<ImageCandidate> {
    const buffer = await pexelsLimiter(() =>
      withRetry(async () => {
        const res = await fetch(option.downloadUrl);
        if (!res.ok) throw new HttpStatusError(`Pexels: could not download the image (${res.status})`, res.status);
        return Buffer.from(await res.arrayBuffer());
      }),
    );
    return { buffer, contentType: 'image/jpeg', filename: `${option.id}.jpg`, sourceUrl: option.downloadUrl, attribution: option.attribution };
  }
}

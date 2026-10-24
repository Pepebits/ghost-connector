import { getConfig } from '../config.js';
import { recordProviderCall } from '../db/repo.js';
import type { ImagePlan } from '../types.js';
import { pixabayLimiter } from '../util/limiter.js';
import { withRetry } from '../util/retry.js';
import { acquireFirst, bestFirst, creditLink, HttpStatusError, QuotaExhaustedError, type ImageCandidate, type ImageOption, type StockSource } from './provider.js';

function remainingFrom(res: Response): number | null {
  const header = res.headers.get('x-ratelimit-remaining');
  return header ? Number.parseInt(header, 10) : null;
}

interface PixabayHit {
  id: number;
  pageURL: string;
  webformatURL: string;
  largeImageURL: string;
  imageWidth: number;
  imageHeight: number;
  user: string;
  user_id: number;
}

interface PixabaySearchResponse {
  hits: PixabayHit[];
}

/**
 * Pixabay: free key issued on sign-up, 100 requests/minute. Its license
 * doesn't require attribution; it's added anyway, like Pexels. The image
 * URLs are temporary (24 h): the chosen one is downloaded, never hotlinked
 * in the post.
 */
export class PixabayProvider implements StockSource {
  readonly name = 'pixabay';

  supports(strategy: ImagePlan['strategy']): boolean {
    return strategy === 'unsplash';
  }

  acquire(plan: ImagePlan): Promise<ImageCandidate | null> {
    return acquireFirst(this, plan);
  }

  async searchOptions(query: string, orientation: ImagePlan['orientation'], limit: number): Promise<ImageOption[] | null> {
    const key = getConfig().PIXABAY_API_KEY;
    if (!key) return null;
    // Pixabay only has horizontal/vertical/all.
    const pixabayOrientation = orientation === 'landscape' ? 'horizontal' : orientation === 'portrait' ? 'vertical' : 'all';
    const hits = await pixabayLimiter(() =>
      withRetry(async () => {
        const url = new URL('https://pixabay.com/api/');
        url.searchParams.set('key', key);
        url.searchParams.set('q', query.slice(0, 100));
        url.searchParams.set('image_type', 'photo');
        url.searchParams.set('orientation', pixabayOrientation);
        url.searchParams.set('safesearch', 'true');
        url.searchParams.set('per_page', String(Math.max(3, Math.min(limit, 200))));

        const res = await fetch(url);
        recordProviderCall({ provider: 'pixabay', kind: 'search', status: res.status, remaining: remainingFrom(res) });
        if (res.status === 429) throw new QuotaExhaustedError('Pixabay: quota exhausted (429)', 429);
        if (!res.ok) throw new HttpStatusError(`Pixabay search failed: ${res.status}`, res.status);
        return ((await res.json()) as PixabaySearchResponse).hits;
      }),
    );
    return bestFirst(
      hits.map((p): ImageOption => {
        const userUrl = `https://pixabay.com/users/${encodeURIComponent(p.user)}-${p.user_id}/`;
        return {
          provider: 'pixabay',
          id: String(p.id),
          thumbUrl: p.webformatURL,
          downloadUrl: p.largeImageURL,
          width: p.imageWidth,
          height: p.imageHeight,
          pageUrl: p.pageURL,
          attribution: {
            provider: 'pixabay',
            authorName: p.user,
            authorUrl: userUrl,
            providerUrl: p.pageURL,
            licenseNote: 'Pixabay Content License',
            htmlCredit: `Image by ${creditLink(p.user, userUrl)} from ${creditLink('Pixabay', p.pageURL)}`,
          },
        };
      }),
    );
  }

  async download(option: ImageOption): Promise<ImageCandidate> {
    const res = await pixabayLimiter(() =>
      withRetry(async () => {
        const r = await fetch(option.downloadUrl);
        if (!r.ok) throw new HttpStatusError(`Pixabay: could not download the image (${r.status})`, r.status);
        return { buffer: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') ?? 'image/jpeg' };
      }),
    );
    const ext = res.type.includes('png') ? 'png' : 'jpg';
    return { buffer: res.buffer, contentType: res.type, filename: `${option.id}.${ext}`, sourceUrl: option.downloadUrl, attribution: option.attribution };
  }
}

import { getConfig } from '../config.js';
import { recordProviderCall } from '../db/repo.js';
import type { ImagePlan } from '../types.js';
import { wikimediaLimiter } from '../util/limiter.js';
import { withRetry } from '../util/retry.js';
import { acquireFirst, bestFirst, creditLink, HttpStatusError, QuotaExhaustedError, type ImageCandidate, type ImageOption, type StockSource } from './provider.js';

/** Wikimedia asks every client to identify itself (https://meta.wikimedia.org/wiki/User-Agent_policy). */
export const WIKIMEDIA_USER_AGENT = 'ghost-connector/0.1 (self-hosted Ghost editing tool)';
const API = 'https://commons.wikimedia.org/w/api.php';
/** Thumbnail widths Wikimedia serves (it only renders standard steps). */
const GRID_WIDTH = 500;
const DOWNLOAD_WIDTH = 1920;

interface Meta {
  value?: string;
}
interface CommonsPage {
  pageid: number;
  title: string;
  imageinfo?: Array<{
    url: string;
    thumburl?: string;
    descriptionurl: string;
    width: number;
    height: number;
    mime: string;
    extmetadata?: Record<string, Meta | undefined>;
  }>;
}

export type WikimediaLicense = 'cc0' | 'pdm' | 'by' | 'by-sa';

/** "CC BY-SA 4.0" -> by-sa; anything that isn't free for commercial use and modification -> null. */
export function licenseCode(shortName: string): WikimediaLicense | null {
  const s = shortName.trim().toLowerCase();
  if (/^cc0\b/.test(s)) return 'cc0';
  if (/^public domain\b|^pd\b|^pd-/.test(s)) return 'pdm';
  if (/\b(nc|nd)\b/.test(s)) return null;
  if (/^cc[ -]by[ -]sa\b/.test(s)) return 'by-sa';
  if (/^cc[ -]by\b/.test(s)) return 'by';
  return null;
}

/** Commons metadata comes as HTML (written by anyone): plain text only. */
export function plainText(htmlText: string): string {
  return htmlText
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Author for the credit: none when Commons says it's unknown; a repeated name ("Ana Ana") once. */
export function authorName(artistHtml: string): string | undefined {
  let text = plainText(artistHtml);
  const words = text.split(' ');
  const half = words.length / 2;
  if (words.length % 2 === 0 && words.slice(0, half).join(' ') === words.slice(half).join(' ')) text = words.slice(0, half).join(' ');
  if (!text || /^unknown\b|^anonymous\b|^desconocido\b/i.test(text)) return undefined;
  return text;
}

/** First link of the "Artist" field, made absolute (Commons uses //host/... and /wiki/...). */
function authorLink(htmlText: string): string | undefined {
  const href = /href="([^"]+)"/.exec(htmlText)?.[1];
  if (!href) return undefined;
  if (href.startsWith('//')) return `https:${href}`;
  if (href.startsWith('/')) return `https://commons.wikimedia.org${href}`;
  return href;
}

/**
 * Wikimedia Commons (the image library behind Wikipedia): keyless, good for
 * people, places, logos and technical or historical topics. Only bitmap
 * files with licenses that allow commercial use and modification; the
 * attribution (title, author, license) always goes in the caption.
 */
export class WikimediaProvider implements StockSource {
  readonly name = 'wikimedia';

  supports(strategy: ImagePlan['strategy']): boolean {
    return strategy === 'unsplash';
  }

  acquire(plan: ImagePlan): Promise<ImageCandidate | null> {
    return acquireFirst(this, plan);
  }

  async searchOptions(query: string, _orientation: ImagePlan['orientation'], limit: number): Promise<ImageOption[] | null> {
    const cfg = getConfig();
    if (!cfg.WIKIMEDIA_ENABLED) return null;
    const allowed = new Set(cfg.WIKIMEDIA_LICENSES.split(',').map((l) => l.trim()));
    const pages = await wikimediaLimiter(() =>
      withRetry(async () => {
        const url = new URL(API);
        for (const [k, v] of Object.entries({
          action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrnamespace: '6',
          gsrsearch: `${query} filetype:bitmap`, gsrlimit: String(Math.min(limit * 2, 50)),
          prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(DOWNLOAD_WIDTH),
          iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|ObjectName',
        })) url.searchParams.set(k, v);
        const res = await fetch(url, { headers: { 'User-Agent': WIKIMEDIA_USER_AGENT, 'Api-User-Agent': WIKIMEDIA_USER_AGENT } });
        recordProviderCall({ provider: 'wikimedia', kind: 'search', status: res.status, remaining: null });
        if (res.status === 429) throw new QuotaExhaustedError('Wikimedia: too many requests (429)', 429);
        if (!res.ok) throw new HttpStatusError(`Wikimedia search failed: ${res.status}`, res.status);
        return ((await res.json()) as { query?: { pages?: CommonsPage[] } }).query?.pages ?? [];
      }),
    );
    const options = pages.flatMap((p): ImageOption[] => {
      const info = p.imageinfo?.[0];
      if (!info || !/^image\/(jpeg|png|webp)$/.test(info.mime)) return [];
      const meta = info.extmetadata ?? {};
      const license = licenseCode(meta.LicenseShortName?.value ?? '');
      if (!license || !allowed.has(license)) return [];
      const download = info.thumburl ?? info.url;
      const artistHtml = meta.Artist?.value ?? '';
      const author = authorName(artistHtml);
      const title = plainText(meta.ObjectName?.value ?? '') || p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '');
      const licenseNote = plainText(meta.LicenseShortName?.value ?? '');
      const licenseUrl = meta.LicenseUrl?.value;
      const authorUrl = authorLink(artistHtml);
      return [
        {
          provider: 'wikimedia',
          id: String(p.pageid),
          thumbUrl: download.replace(`/${DOWNLOAD_WIDTH}px-`, `/${GRID_WIDTH}px-`),
          downloadUrl: download,
          width: info.thumburl ? Math.min(info.width, DOWNLOAD_WIDTH) : info.width,
          height: info.thumburl && info.width > DOWNLOAD_WIDTH ? Math.round((info.height * DOWNLOAD_WIDTH) / info.width) : info.height,
          pageUrl: info.descriptionurl,
          attribution: {
            provider: 'wikimedia',
            ...(author ? { authorName: author } : {}),
            ...(authorUrl ? { authorUrl } : {}),
            providerUrl: info.descriptionurl,
            title,
            licenseNote,
            licenseUrl: licenseUrl ?? '',
            htmlCredit: `${creditLink(`"${title}"`, info.descriptionurl)}${author ? ` by ${creditLink(author, authorUrl)}` : ''} via Wikimedia Commons, ${creditLink(licenseNote, licenseUrl)}`,
          },
        },
      ];
    });
    return bestFirst(options).slice(0, limit);
  }

  async download(option: ImageOption): Promise<ImageCandidate> {
    const res = await wikimediaLimiter(() =>
      withRetry(async () => {
        const r = await fetch(option.downloadUrl, { headers: { 'User-Agent': WIKIMEDIA_USER_AGENT } });
        if (!r.ok) throw new HttpStatusError(`Wikimedia: could not download the image (${r.status})`, r.status);
        return { buffer: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') ?? 'image/jpeg' };
      }),
    );
    const ext = res.type.includes('png') ? 'png' : res.type.includes('webp') ? 'webp' : 'jpg';
    return { buffer: res.buffer, contentType: res.type, filename: `${option.id}.${ext}`, sourceUrl: option.downloadUrl, attribution: option.attribution };
  }
}

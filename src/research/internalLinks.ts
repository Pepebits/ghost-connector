import { getConfig } from '../config.js';
import { ghostApi } from '../ghost/client.js';
import { logger } from '../logger.js';
import type { DraftSnapshot } from '../types.js';
import { ghostLimiter } from '../util/limiter.js';
import { withRetry } from '../util/retry.js';

export interface PublishedPost {
  title: string;
  url: string;
  excerpt: string;
}

const CACHE_MS = 10 * 60 * 1000;
let cache: { at: number; posts: PublishedPost[] } | null = null;

/** Recently published posts of the blog (title, URL, excerpt), cached for a few minutes. */
export async function listPublished(): Promise<PublishedPost[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.posts;
  const raw = (await ghostLimiter(() =>
    withRetry(() => ghostApi().posts.browse({ filter: 'status:published', fields: 'title,url,custom_excerpt,excerpt', limit: 200, order: 'published_at DESC' })),
  )) as unknown as Array<{ title: string; url: string; custom_excerpt?: string | null; excerpt?: string | null }>;
  const posts = raw.map((p) => ({ title: p.title, url: p.url, excerpt: (p.custom_excerpt || p.excerpt || '').slice(0, 200) }));
  cache = { at: Date.now(), posts };
  return posts;
}

/** Forgets the cache (tests). */
export function resetPublishedCache(): void {
  cache = null;
}

function terms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/<[^>]+>/g, ' ')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 4),
  );
}

// Words too common to say two posts are about the same thing (es/en, 4+ letters).
const STOPWORDS = new Set(
  ('como para pero este esta estos estas sobre entre desde hasta cuando donde todo todos toda todas nuevo nueva nuevos nuevas mejor mejores '
    + 'multiples varios varias otros otras cosas parte forma manera puede pueden hacer tiene tienen ayuda gente version versiones '
    + 'with from that this what when your about more como guia tutorial instalar install using cada solo tambien porque aqui')
    .split(' '),
);

function contentTerms(text: string): Set<string> {
  return new Set([...terms(text)].filter((w) => !STOPWORDS.has(w)));
}

/**
 * The published posts that share the most meaningful words with the draft
 * (TF-IDF style: a word in many posts counts less; title words count
 * double). At least two distinct shared words, one in the title. No AI, no embeddings:
 * cheap, and the writer still decides whether each one fits.
 */
export function rankRelated(posts: PublishedPost[], draft: { title: string; text: string; url?: string }, max = 6): PublishedPost[] {
  const title = contentTerms(draft.title);
  const body = contentTerms(draft.text.slice(0, 4000));
  const docs = posts.map((p) => ({ p, words: contentTerms(`${p.title} ${p.excerpt}`) }));
  const df = new Map<string, number>();
  for (const d of docs) for (const w of d.words) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = (w: string) => Math.log((docs.length + 1) / (df.get(w) ?? 1));
  return docs
    .filter((d) => d.p.url !== draft.url)
    .map((d) => {
      let score = 0;
      let shared = 0;
      let inTitle = false;
      for (const w of d.words) {
        const weight = title.has(w) ? 2 : body.has(w) ? 1 : 0;
        if (weight) {
          shared += 1;
          inTitle ||= weight === 2;
          score += weight * idf(w);
        }
      }
      return { p: d.p, score, shared, inTitle };
    })
    // About the same topic: two shared words, one of them in the draft's title.
    .filter((x) => x.shared >= 2 && x.inTitle)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.p);
}

/** Related posts for the writer; never fails the plan (no links if Ghost doesn't answer). */
export async function relatedPosts(snapshot: DraftSnapshot, extraInstructions?: string): Promise<PublishedPost[]> {
  if (!getConfig().INTERNAL_LINKS) return [];
  try {
    return rankRelated(await listPublished(), { title: snapshot.title, text: `${extraInstructions ?? ''} ${snapshot.html ?? ''}`, url: snapshot.url });
  } catch (err) {
    logger.warn({ id: snapshot.id, err: err instanceof Error ? err.message : String(err) }, 'Could not list published posts for internal links');
    return [];
  }
}

/** Block for the writer prompt. Titles are untrusted data, like any source. */
export function internalLinksBlock(posts: PublishedPost[]): string {
  if (posts.length === 0) return '';
  const lines = posts.map((p) => `- ${p.title.replace(/[\r\n]+/g, ' ')} — ${p.url}`);
  return `POSTS PUBLICADOS DEL BLOG PARA ENLAZAR (enlaces internos, ver regla de enlaces internos):\n${lines.join('\n')}`;
}

import { t } from '../i18n/index.js';
import { uploadImage } from '../ghost/images.js';
import { logger } from '../logger.js';
import type { ImagePlan } from '../types.js';
import { getConfig } from '../config.js';
import { slugify } from '../util/slug.js';
import { UnsupportedProviderError } from './generated.provider.js';
import { PexelsProvider } from './pexels.provider.js';
import { configuredSources, resolveProvider, stockSource } from './registry.js';
import { degradeQuery, QuotaExhaustedError, type ImageOption } from './provider.js';
import { StockPhotoProvider } from './stock.provider.js';
import { UnsplashProvider } from './unsplash.provider.js';

export interface FeatureImageResult {
  url: string;
  alt: string;
  caption: string | null;
}

export interface FeatureImageContext {
  postTitle: string;
  slug: string;
  /** If the post ALREADY has a feature image, it's never touched: neither the plan nor the upload runs. */
  existingFeatureImage: string | null;
}

function extensionFor(contentType: string): string {
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  return '.jpg';
}

/**
 * Hard rule, not just a prompt suggestion: if the post already has a
 * feature_image, this pipeline doesn't run at all, regardless of
 * what the ImageAgent decided.
 */
export async function acquireFeatureImage(
  plan: ImagePlan,
  ctx: FeatureImageContext,
): Promise<FeatureImageResult | null> {
  if (ctx.existingFeatureImage) {
    logger.info(
      { existingFeatureImage: ctx.existingFeatureImage },
      'The post already has a feature image; keeping it and skipping the image pipeline.',
    );
    return null;
  }

  if (plan.strategy === 'skip') return null;

  let provider = resolveProvider(plan.strategy);
  let effectivePlan = plan;

  if (plan.strategy === 'generate' && getConfig().IMAGE_GENERATION_PROVIDER === 'none') {
    logger.warn('IMAGE_GENERATION_PROVIDER=none: downgrading the "generate" strategy to stock (Unsplash/Pexels).');
    provider = new StockPhotoProvider([new UnsplashProvider(), new PexelsProvider()]);
    effectivePlan = {
      ...plan,
      strategy: 'unsplash',
      unsplash_query: plan.unsplash_query || plan.generation_prompt,
    };
  }
  if (!provider) return null;

  const candidate = await provider
    .acquire(effectivePlan, { postTitle: ctx.postTitle })
    .catch((err) => {
      if (err instanceof UnsupportedProviderError) return null;
      throw err;
    });
  if (!candidate) return null;

  // Filename describing the image's CONTENT (derived from the
  // alt_text: "Cabezal termostatico blanco..." -> "cabezal-termostatico-
  // blanco...jpg"), not an opaque id. The internal `ref` is still tied to the post,
  // so logs can trace which image belongs to which draft.
  const filename = `${slugify(plan.alt_text)}${extensionFor(candidate.contentType)}`;
  const uploaded = await uploadImage(candidate.buffer, filename, `${ctx.slug}-feature`);

  return {
    url: uploaded.url,
    alt: plan.alt_text,
    caption: candidate.attribution?.htmlCredit || plan.caption || null,
  };
}

export interface ImageSearchResult {
  query: string;
  options: ImageOption[];
  /** Sources that failed (or the forced one isn't configured), with the reason. */
  notes: string[];
  /** The search was limited to this source. */
  source?: string;
}

const PER_SOURCE = 8;

/** "pexels" -> "Pexels", for the notes shown to the editor. */
const label = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/**
 * Searches for candidates in all configured sources (in their order) WITHOUT
 * downloading anything: only metadata and thumbnails, for the editor to choose.
 */
export async function searchImageOptions(query: string, orientation: ImagePlan['orientation'], only?: string): Promise<ImageSearchResult> {
  const notes: string[] = [];
  // Sources without a key are skipped silently: a note about them is noise.
  // Forcing one source brings more of its results.
  const forced = only ? stockSource(only) : null;
  const sources = forced ? [forced] : configuredSources();
  const limit = forced ? PER_SOURCE * 3 : PER_SOURCE;
  if (sources.length === 0) return { query, options: [], notes: [t('image.notes.noSources')], ...(only ? { source: only } : {}) };
  const perSource = await Promise.all(
    sources.map(async (source) => {
      try {
        let found = await source.searchOptions(query, orientation, limit);
        if (found === null) {
          notes.push(t('image.notes.notConfigured', { source: label(source.name) }));
          return [];
        }
        if (found.length === 0 && degradeQuery(query) !== query) found = (await source.searchOptions(degradeQuery(query), orientation, limit)) ?? [];
        return found.slice(0, limit);
      } catch (err) {
        notes.push(err instanceof QuotaExhaustedError ? t('image.notes.quota', { source: label(source.name) }) : t('image.notes.failed', { source: label(source.name), error: err instanceof Error ? err.message : String(err) }));
        return [];
      }
    }),
  );
  return { query, options: perSource.flat(), notes, ...(forced ? { source: forced.name } : {}) };
}

/** Downloads the candidate chosen by the editor and uploads it to Ghost. */
export async function uploadChosenImage(option: ImageOption, alt: string, slug: string): Promise<FeatureImageResult> {
  const source = stockSource(option.provider);
  if (!source) throw new Error(`Unknown image source: ${option.provider}`);
  const candidate = await source.download(option);
  const filename = `${slugify(alt || option.id)}${extensionFor(candidate.contentType)}`;
  const uploaded = await uploadImage(candidate.buffer, filename, `${slug}-feature`);
  return { url: uploaded.url, alt, caption: option.attribution.htmlCredit || null };
}

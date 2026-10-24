import { getConfig } from '../config.js';
import { toPostContent } from '../ghost/lexical.js';
import { markdownToHtml } from '../util/markdown.js';
import type { DraftSnapshot, PostPatch, SeoOutput, UploadedFeatureImage, WriterOutput } from '../types.js';

/** Internal tag (starts with #) so already-processed posts can be filtered out in future runs. */
export const AI_PROCESSED_TAG = '#ai-processed';

export interface MergeInput {
  snapshot: DraftSnapshot;
  writer: WriterOutput;
  seo: SeoOutput | null;
  uploadedImage: UploadedFeatureImage | null;
}

export interface MergeResult {
  patch: PostPatch;
  contentSource?: 'html';
}

function dedupeByLowerName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = item.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Ghost REPLACES the tag list on each update, it doesn't merge it. That's why
 * the full union is always sent: existing tags (by id, so they don't
 * lose their identity) + the new ones proposed by the SeoAgent (by name) +
 * the internal traceability tag, avoiding duplicates by name.
 */
function buildTags(snapshot: DraftSnapshot, seo: SeoOutput): Array<{ id: string } | { name: string }> {
  const existingLower = new Set(snapshot.tags.map((t) => t.name.toLowerCase()));
  const proposedNew = seo.tags
    .filter((name) => !existingLower.has(name.toLowerCase()))
    .map((name) => ({ name }));
  const dedupedNew = dedupeByLowerName(proposedNew);

  const alreadyMarked = existingLower.has(AI_PROCESSED_TAG.toLowerCase());
  const withMarker = alreadyMarked ? dedupedNew : [...dedupedNew, { name: AI_PROCESSED_TAG }];

  return [...snapshot.tags.map((t) => ({ id: t.id })), ...withMarker];
}

export function buildPostPatch(input: MergeInput): MergeResult {
  const cfg = getConfig();
  const { snapshot, writer, seo, uploadedImage } = input;

  const html = markdownToHtml(writer.markdown);
  const content = toPostContent(html);

  const patch: PostPatch = {
    status: 'draft',
    ...content.fields,
  };

  if (writer.title && writer.title !== snapshot.title) {
    patch.title = writer.title;
  }

  if (seo) {
    if (seo.meta_title !== snapshot.meta_title) patch.meta_title = seo.meta_title;
    if (seo.meta_description !== snapshot.meta_description) patch.meta_description = seo.meta_description;
    if (seo.custom_excerpt !== snapshot.custom_excerpt) patch.custom_excerpt = seo.custom_excerpt;

    // Null og_*/twitter_* mean "add nothing different from meta_*":
    // they're omitted (not sent); null is never forced over a value that
    // might already exist in Ghost, set by hand.
    if (seo.og_title && seo.og_title !== snapshot.og_title) patch.og_title = seo.og_title;
    if (seo.og_description && seo.og_description !== snapshot.og_description) patch.og_description = seo.og_description;
    if (seo.twitter_title && seo.twitter_title !== snapshot.twitter_title) patch.twitter_title = seo.twitter_title;
    if (seo.twitter_description && seo.twitter_description !== snapshot.twitter_description) {
      patch.twitter_description = seo.twitter_description;
    }

    patch.tags = buildTags(snapshot, seo);

    // The slug only changes if the user explicitly allows it: breaking
    // an already-shared preview URL is a real cost, even in draft.
    if (cfg.ALLOW_SLUG_CHANGE && seo.slug !== snapshot.slug) {
      patch.slug = seo.slug;
    }
  }

  if (uploadedImage) {
    patch.feature_image = uploadedImage.url;
    patch.feature_image_alt = uploadedImage.alt;
    // Explicit null: when replacing an image, the old caption must not stay.
    patch.feature_image_caption = uploadedImage.caption ?? null;
  }

  return { patch, contentSource: content.source };
}

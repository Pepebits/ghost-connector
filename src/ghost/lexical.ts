import { getConfig } from '../config.js';

export interface PostContent {
  fields: { html: string } | { lexical: string };
  source?: 'html';
}

/**
 * v1 uses `?source=html`: Ghost converts to lexical server-side. Known
 * risk (TryGhost/Ghost#18448): inline images can get lost in
 * that conversion; that's why the WriterAgent never emits inline images, only
 * the feature_image, which doesn't go through this converter.
 *
 * The `lexical` strategy (building the JSON locally with
 * @tryghost/kg-html-to-lexical so image cards can be included) is left for
 * a v2; for now it fails explicitly instead of generating invalid lexical.
 */
export function toPostContent(html: string): PostContent {
  const cfg = getConfig();
  if (cfg.CONTENT_STRATEGY === 'html') {
    return { fields: { html }, source: 'html' };
  }
  throw new Error(
    'CONTENT_STRATEGY=lexical is not implemented yet. Use CONTENT_STRATEGY=html in .env (see src/ghost/lexical.ts).',
  );
}

import type { RunArtifact } from '../../types.js';
import { t } from '../../i18n/index.js';
import { html, raw } from '../html.js';

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/**
 * How the post will look in Google and when shared, with what applying
 * would set (the plan's patch, falling back to what Ghost has). Approximate
 * on purpose: Google truncates by pixels (~60 characters for the title,
 * ~155 for the description) and each network crops images its own way.
 */
export function sharePreview(plan: RunArtifact): string {
  const p = plan.patch;
  const s = plan.snapshot;
  const title = p.title ?? s.title;
  const metaTitle = p.meta_title || s.meta_title || title;
  const description = p.meta_description || s.meta_description || p.custom_excerpt || s.custom_excerpt || '';
  const ogTitle = p.og_title || s.og_title || metaTitle;
  const ogDescription = p.og_description || s.og_description || description;
  let origin = '';
  try {
    origin = new URL(s.url).origin;
  } catch {
    // no URL in the snapshot: the address line just shows the slug
  }
  const host = origin.replace(/^https?:\/\//, '');
  const slug = p.slug ?? s.slug;
  const choice = plan.imageChoice;
  const image =
    choice?.kind === 'option'
      ? `/posts/${plan.postId}/image/chosen?v=${encodeURIComponent(choice.localFile)}`
      : choice?.kind === 'remove' || choice?.kind === 'none'
        ? null
        : s.feature_image;

  // min-w-0: the slug line doesn't wrap, and without it the card would grow to its width.
  return html`<div class="card min-w-0 max-w-full overflow-hidden p-3.5">
    <h3 class="m-0 text-sm">${t('post.share.title')}</h3>
    <p class="!mb-1 mt-3 text-xs font-medium uppercase tracking-wide text-muted">Google</p>
    <div class="rounded-md border border-line bg-bg p-3">
      <p class="m-0 truncate text-xs text-muted">${host} › ${slug}</p>
      <p class="m-0 mt-0.5 text-base leading-snug text-accent [overflow-wrap:anywhere]">${cut(metaTitle, 60)}</p>
      <p class="m-0 mt-1 text-xs leading-relaxed text-muted">${description ? cut(description, 155) : t('post.share.noDescription')}</p>
    </div>
    <p class="!mb-1 mt-3 text-xs font-medium uppercase tracking-wide text-muted">${t('post.share.social')}</p>
    <div class="overflow-hidden rounded-md border border-line bg-bg">
      ${raw(image ? html`<img src="${image}" alt="" referrerpolicy="no-referrer" class="aspect-[1.91/1] w-full bg-panel-2 object-cover">` : html`<div class="flex aspect-[1.91/1] items-center justify-center bg-panel-2 text-xs text-muted">${t('post.share.noImage')}</div>`)}
      <div class="p-2.5">
        <p class="m-0 text-[0.7rem] uppercase text-muted">${host}</p>
        <p class="m-0 mt-0.5 text-sm font-semibold leading-snug [overflow-wrap:anywhere]">${cut(ogTitle, 70)}</p>
        <p class="m-0 mt-0.5 line-clamp-2 text-xs text-muted">${ogDescription}</p>
      </div>
    </div>
  </div>`;
}

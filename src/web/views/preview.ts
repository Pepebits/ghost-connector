import sanitizeHtml from 'sanitize-html';
import { t } from '../../i18n/index.js';
import { escapeHtml } from '../html.js';
import { markdownToHtml } from '../../util/markdown.js';

/** Highlights [[PENDING:]] (or the former [[PENDIENTE:]]) inside already-sanitized HTML (the marker text is already escaped). */
function highlightPending(html: string): string {
  const mark = `<mark class="pending-marker" title="${escapeHtml(t('post.preview.pendingMarker'))}">[[$1:$2]]</mark>`;
  // Only in text between tags: a marker inside an attribute (title="…") is left alone.
  return html.replace(/(<[^>]*>)|([^<]+)/g, (_m, tag: string | undefined, text: string | undefined) =>
    tag ?? text!.replace(/\[\[(PENDING|PENDIENTE):([^\]]*)\]\]/g, mark),
  );
}

/** Writer Markdown -> safe HTML to show in the UI. */
export function renderWriterPreview(markdown: string): string {
  return highlightPending(markdownToHtml(markdown));
}

/** HTML coming from Ghost (original content) -> safe HTML to show in the UI. */
export function renderGhostPreview(html: string | null): string {
  if (!html) return '';
  return highlightPending(
    sanitizeHtml(html, {
      allowedTags: [...sanitizeHtml.defaults.allowedTags, 'mark', 'img', 'figure', 'figcaption'],
      allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt', 'referrerpolicy', 'loading'], code: ['class'] },
      allowedSchemes: ['http', 'https', 'mailto'],
      // Draft images load from wherever they're hosted: without telling that site which panel page shows them.
      transformTags: { img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, referrerpolicy: 'no-referrer', loading: 'lazy' } }) },
    }),
  );
}

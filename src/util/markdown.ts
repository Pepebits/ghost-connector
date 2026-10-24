import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { getConfig } from '../config.js';

const ALLOWED_TAGS = [
  'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'strong', 'em', 'hr', 'br',
  // GFM tables (marked supports them by default): useful for comparisons.
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
];

// Known affiliate domains: their links get rel="sponsored" in addition
// to noopener/noreferrer, as Google's guidelines require for
// paid/affiliate links. Extend if other affiliate programs are used.
const AFFILIATE_HOST_SUBSTRINGS = ['amazon.', 'amzn.to'];

type LinkKind = 'internal' | 'affiliate' | 'external';

function siteHostname(): string | null {
  try {
    return new URL(getConfig().GHOST_API_URL).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function classifyLink(href: string | undefined, siteHost: string | null): LinkKind {
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('/')) return 'internal';
  let host: string;
  try {
    host = new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return 'internal'; // relative href without protocol (rare after marked, but just in case)
  }
  if (siteHost && (host === siteHost || host.endsWith(`.${siteHost}`))) return 'internal';
  if (AFFILIATE_HOST_SUBSTRINGS.some((d) => host.includes(d))) return 'affiliate';
  return 'external';
}

/** WriterAgent Markdown -> HTML that Ghost understands via `?source=html`. */
export function markdownToHtml(markdown: string): string {
  const rawHtml = marked.parse(markdown, { async: false, gfm: true }) as string;
  const siteHost = siteHostname();

  return sanitizeHtml(rawHtml, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title', 'rel', 'target'],
      code: ['class'],
      th: ['align'],
      td: ['align'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: (tagName, attribs) => {
        const kind = classifyLink(attribs.href, siteHost);
        if (kind === 'internal') return { tagName, attribs };
        return {
          tagName,
          attribs: {
            ...attribs,
            rel: kind === 'affiliate' ? 'sponsored noopener noreferrer' : 'noopener noreferrer',
            target: '_blank',
          },
        };
      },
    },
  });
}

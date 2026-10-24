import type { RunArtifact } from '../types.js';
import { extractUrls } from '../research/sources.js';
import { markdownToHtml } from '../util/markdown.js';

/**
 * Prompt injection defense that does not depend on the model: every link or
 * image in the planned text must come from something the editor
 * controls (the original draft, its instructions or answers, or a
 * page given as a source and the links that page contains). If the
 * writer adds another one (e.g. because a website "asked" it to), apply is blocked
 * until the editor reviews it and explicitly allows it.
 */

function normalize(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return u.protocol;
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    return u.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

/**
 * Sites where anyone can publish under the same host: citing one page there
 * must not vouch for every other page, only for the same account (the first
 * path segment: github.com/acme/*, medium.com/@ana/*).
 */
const SHARED_HOSTS = new Set([
  'github.com', 'gist.github.com', 'gitlab.com', 'bitbucket.org', 'medium.com', 'dev.to', 'substack.com', 'youtube.com', 'youtu.be',
  'x.com', 'twitter.com', 'reddit.com', 'linkedin.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'docs.google.com',
  'drive.google.com', 'sites.google.com', 'notion.site', 'wordpress.com', 'blogspot.com', 'tumblr.com', 'npmjs.com', 'pypi.org', 'hub.docker.com',
]);

/** What a trusted link vouches for: its host, or host + account on a shared site. */
function host(url: string): string | null {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!SHARED_HOSTS.has(h)) return h;
    const first = u.pathname.split('/').filter(Boolean)[0];
    return first ? `${h}/${first.toLowerCase()}` : `${h}/`;
  } catch {
    return null;
  }
}

/** Links and images in a markdown/HTML text: [](url), ![](url), <url>, href/src and bare URLs. */
export function extractLinks(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) out.add(m[1]!);
  for (const m of text.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) out.add(m[1]!);
  for (const m of text.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)) out.add(m[1]!);
  for (const u of text.match(/(?:https?:|data:|javascript:)[^\s<>"')\]]+/gi) ?? []) out.add(u.replace(/[.,;:!?]+$/, ''));
  return [...out].filter((u) => /^(https?:|data:|javascript:|\/\/)/i.test(u));
}

const decodeEntities = (v: string) =>
  v.replace(/&(?:#(\d+)|#x([0-9a-f]+)|amp|quot|lt|gt|apos);/gi, (m, dec, hex) =>
    dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : ({ '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&apos;': "'" })[m.toLowerCase()]!,
  );

/**
 * The links exactly as they would reach Ghost: the markdown rendered and
 * sanitized like on apply. Catches what a text scan misses, such as GFM
 * autolinks ("www.example.com") or entity-encoded hrefs ("&#104;ttps://…").
 */
export function publishedLinks(markdown: string): string[] {
  const out = new Set<string>();
  for (const m of markdownToHtml(markdown).matchAll(/\b(?:href|src)\s*=\s*"([^"]*)"/gi)) out.add(decodeEntities(m[1]!));
  return [...out].filter((u) => /^(https?:|\/\/)/i.test(u));
}

/** What the editor provided or accepted as a source (excluding the writer's output). */
export function trustedLinks(artifact: RunArtifact): string[] {
  return [
    ...extractLinks(artifact.snapshot.html ?? ''),
    ...extractUrls(artifact.extraInstructions ?? ''),
    ...(artifact.allowedLinks ?? []),
  ];
}

/** Links in the planned text that do not come from any known source. */
export function unknownLinks(artifact: RunArtifact): string[] {
  if (!artifact.writer) return [];
  const trusted = trustedLinks(artifact);
  const exact = new Set(trusted.map(normalize).filter((x): x is string => !!x));
  // The same site as a source counts as known (subpages of the cited website).
  const hosts = new Set(trusted.map(host).filter((x): x is string => !!x));
  const unknown = new Set<string>();
  for (const link of new Set([...extractLinks(artifact.writer.markdown), ...publishedLinks(artifact.writer.markdown)])) {
    const url = link.startsWith('//') ? `https:${link}` : link;
    const n = normalize(url);
    if (n && (exact.has(n) || (n.startsWith('http') && hosts.has(host(url) ?? '')))) continue;
    unknown.add(link);
  }
  return [...unknown];
}

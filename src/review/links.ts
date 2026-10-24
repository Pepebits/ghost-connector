import type { RunArtifact } from '../types.js';
import { extractUrls } from '../research/sources.js';

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

function host(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
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
  for (const link of extractLinks(artifact.writer.markdown)) {
    const url = link.startsWith('//') ? `https:${link}` : link;
    const n = normalize(url);
    if (n && (exact.has(n) || (n.startsWith('http') && hosts.has(host(url) ?? '')))) continue;
    unknown.add(link);
  }
  return [...unknown];
}

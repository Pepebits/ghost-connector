import { createHash } from 'node:crypto';
import { marked } from 'marked';
import TurndownService from 'turndown';

/**
 * Block review of a plan: compares the writer's Markdown with the
 * original content (Ghost HTML converted to Markdown) at the level of
 * top-level blocks (paragraph, heading, list, code...) and groups the
 * differences into "hunks" that the editor accepts or rejects one by one.
 *
 * Everything is deterministic: the review POST recomputes the same hunks
 * from the same artifact, so the UI only has to send, by
 * index, which version it wants for each one.
 */

export type BlockKind = 'heading' | 'paragraph' | 'list' | 'code' | 'table' | 'blockquote' | 'other';

export interface Block {
  kind: BlockKind;
  markdown: string;
}

export type Hunk =
  | { type: 'equal'; blocks: Block[] }
  | { type: 'change'; before: Block[]; after: Block[] };

/** `true` = keep the writer's new version; `false` = keep the original. */
export type Decisions = boolean[];

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
// <mark> (Ghost highlight) has no standard Markdown equivalent: kept as HTML.
turndown.keep(['mark']);

export function htmlToMarkdown(html: string | null): string {
  if (!html) return '';
  return turndown.turndown(html).trim();
}

function kindOf(type: string): BlockKind {
  switch (type) {
    case 'heading':
    case 'paragraph':
    case 'list':
    case 'code':
    case 'table':
    case 'blockquote':
      return type;
    default:
      return 'other';
  }
}

export function splitBlocks(markdown: string): Block[] {
  return marked
    .lexer(markdown, { gfm: true })
    .filter((t) => t.type !== 'space' && t.raw.trim() !== '')
    .map((t) => ({ kind: kindOf(t.type), markdown: t.raw.trim() }));
}

/** Comparison key: ignores formatting (bold, whitespace, case) so non-changes are not flagged as changes. */
function normalize(block: Block): string {
  return block.markdown
    .toLowerCase()
    .replace(/[*_`#>\-|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Classic LCS over the normalized keys; returns the pairs of equal indices in order. */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

function wordSet(block: Block): Set<string> {
  return new Set(normalize(block).split(' ').filter((w) => w.length > 2));
}

/** Similarity between two blocks (word Jaccard): used to pair a paragraph with its rewritten version. */
function similarity(a: Block, b: Block): number {
  if (a.kind !== b.kind) return 0;
  const wa = wordSet(a);
  const wb = wordSet(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / (wa.size + wb.size - common);
}

const MIN_SIMILARITY = 0.25;

/**
 * Within a differing region, aligns old and new blocks (in order)
 * maximizing total similarity, so each hunk is "this paragraph ->
 * its new version", "block added" or "block removed". Without this, a
 * full rewrite would show up as a single change from N blocks to M, and
 * rejecting it would also discard everything the writer added.
 */
function alignRegion(before: Block[], after: Block[]): Hunk[] {
  const n = before.length;
  const m = after.length;
  const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const sim = similarity(before[i]!, after[j]!);
      const match = sim >= MIN_SIMILARITY ? sim + best[i + 1]![j + 1]! : -1;
      best[i]![j] = Math.max(match, best[i + 1]![j]!, best[i]![j + 1]!);
    }
  }
  const hunks: Hunk[] = [];
  const pending = { before: [] as Block[], after: [] as Block[] };
  const flush = () => {
    if (!pending.before.length && !pending.after.length) return;
    const before = pending.before.splice(0);
    const after = pending.after.splice(0);
    // What is removed and added at the same point is shown as a replacement
    // (original -> new up to the next heading), which is how a rewrite
    // reads; new sections that follow go separately.
    let rest = after;
    if (before.length > 0) {
      const cut = after.findIndex((b, idx) => idx > 0 && b.kind === 'heading');
      const replacement = cut === -1 ? after : after.slice(0, cut);
      rest = cut === -1 ? [] : after.slice(cut);
      hunks.push({ type: 'change', before, after: replacement });
    }
    if (rest.length === 0) return;
    // Purely added content: one hunk per section (each heading starts
    // a new one), so some new sections can be kept and others not.
    let section: Block[] = [];
    for (const block of rest) {
      if (block.kind === 'heading' && section.length > 0) {
        hunks.push({ type: 'change', before: [], after: section });
        section = [];
      }
      section.push(block);
    }
    hunks.push({ type: 'change', before: [], after: section });
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m) {
      const sim = similarity(before[i]!, after[j]!);
      if (sim >= MIN_SIMILARITY && best[i]![j] === sim + best[i + 1]![j + 1]!) {
        flush();
        hunks.push({ type: 'change', before: [before[i]!], after: [after[j]!] });
        i++;
        j++;
        continue;
      }
    }
    // Unpaired blocks: accumulated until the next match (see flush).
    if (j < m && (i >= n || best[i]![j] === best[i]![j + 1]!)) pending.after.push(after[j++]!);
    else pending.before.push(before[i++]!);
  }
  flush();
  return hunks;
}

export function diffBlocks(before: Block[], after: Block[]): Hunk[] {
  const pairs = lcsPairs(before.map(normalize), after.map(normalize));
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  const pushEqual = (block: Block) => {
    const last = hunks.at(-1);
    if (last?.type === 'equal') last.blocks.push(block);
    else hunks.push({ type: 'equal', blocks: [block] });
  };
  for (const [pi, pj] of [...pairs, [before.length, after.length] as [number, number]]) {
    if (pi > i || pj > j) hunks.push(...alignRegion(before.slice(i, pi), after.slice(j, pj)));
    // For an equal pair the writer's version is used: it may carry formatting tweaks that normalize() ignores.
    if (pi < before.length && pj < after.length) pushEqual(after[pj]!);
    i = pi + 1;
    j = pj + 1;
  }
  return hunks;
}

export function changeCount(hunks: Hunk[]): number {
  return hunks.filter((h) => h.type === 'change').length;
}

/** Final Markdown according to the decisions (one per `change` hunk, in order; if missing, the new version is accepted). */
export function applyDecisions(hunks: Hunk[], decisions: Decisions): string {
  const out: string[] = [];
  let k = 0;
  for (const h of hunks) {
    if (h.type === 'equal') {
      out.push(...h.blocks.map((b) => b.markdown));
      continue;
    }
    const acceptNew = decisions[k++] ?? true;
    out.push(...(acceptNew ? h.after : h.before).map((b) => b.markdown));
  }
  return out.join('\n\n');
}

/** Hunks of a plan: original (Ghost snapshot) versus what the writer proposes. */
export function planHunks(originalHtml: string | null, writerMarkdown: string): Hunk[] {
  return diffBlocks(splitBlocks(htmlToMarkdown(originalHtml)), splitBlocks(writerMarkdown));
}

/** Fingerprint of the Markdown the hunks were computed from: if it changes, the submitted review is no longer valid. */
export function markdownFingerprint(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex').slice(0, 16);
}

export type WordOp = { op: 'same' | 'add' | 'del'; text: string };

/**
 * Word-level diff to highlight inside a change. Quadratic: above
 * ~1500 words per side it is not worth it and "all
 * deleted / all added" is returned.
 */
export function diffWords(before: string, after: string): WordOp[] {
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  if (a.length * b.length > 2_250_000) return [{ op: 'del', text: before }, { op: 'add', text: after }];
  const pairs = lcsPairs(a, b);
  const ops: WordOp[] = [];
  const push = (op: WordOp['op'], text: string) => {
    const last = ops.at(-1);
    if (last && last.op === op) last.text += text;
    else ops.push({ op, text });
  };
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...pairs, [a.length, b.length] as [number, number]]) {
    while (i < pi) push('del', a[i++]!);
    while (j < pj) push('add', b[j++]!);
    if (pi < a.length && pj < b.length) push('same', b[pj]!);
    i = pi + 1;
    j = pj + 1;
  }
  return ops;
}

export type HunkAction = 'modified' | 'added' | 'removed';

export function hunkAction(h: Extract<Hunk, { type: 'change' }>): HunkAction {
  if (h.before.length === 0) return 'added';
  if (h.after.length === 0) return 'removed';
  return 'modified';
}

/**
 * Category for review statistics: action + block type, and
 * "intro" if the change touches the first block of the article (the intro,
 * where the writer tends to over-rewrite).
 */
export function hunkCategory(h: Extract<Hunk, { type: 'change' }>, isFirst: boolean): string {
  const kind = isFirst ? 'intro' : (h.after[0] ?? h.before[0])?.kind ?? 'other';
  return `${hunkAction(h)}:${kind}`;
}

/** `change` hunks with their category, in the same order as the decisions. */
export function categorizedChanges(hunks: Hunk[]): Array<{ hunk: Extract<Hunk, { type: 'change' }>; category: string }> {
  const out: Array<{ hunk: Extract<Hunk, { type: 'change' }>; category: string }> = [];
  hunks.forEach((h, idx) => {
    if (h.type === 'change') out.push({ hunk: h, category: hunkCategory(h, idx === 0) });
  });
  return out;
}

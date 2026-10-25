import type { PostResult, WeekPoint } from './results.js';

/**
 * Did the panel's changes help? For each post it changed: up to 4 full weeks
 * before the change against the same number after (the week of the change
 * itself is left out), from the cached weekly series. The rest of the blog
 * over the same weeks is the baseline, so a seasonal dip or a Google update
 * isn't credited to (or blamed on) the panel. Indicative, not an experiment.
 */

export const IMPACT_WEEKS = 4;
/** Fewer weeks than this on either side: too recent (or too old) to say. */
export const MIN_IMPACT_WEEKS = 2;
/** Fewer clicks than this before and after together: a percentage would mean nothing (3 → 14 is "+367%"). */
export const MIN_IMPACT_CLICKS = 20;

export const enoughClicks = (before: number, after: number) => before + after >= MIN_IMPACT_CLICKS;

export interface Window {
  clicks: number;
  impressions: number;
}

export interface PostImpact {
  postId: string;
  /** The change being measured: the latest one. */
  changedAt: string;
  weeks: number;
  before: Window;
  after: Window;
  /** The rest of the blog over the same weeks. */
  blogBefore: Window;
  blogAfter: Window;
  /** Clicks the post would have had after if it had moved like the rest of the blog. */
  expectedClicks: number;
}

export interface ImpactSummary {
  measured: PostImpact[];
  /** Latest change too recent: fewer than MIN_IMPACT_WEEKS full weeks after it. */
  pending: number;
  /** Latest change too early in the 16-week window: not enough weeks before it. */
  tooOld: number;
  before: number;
  after: number;
  expected: number;
}

const WEEK_MS = 7 * 86400_000;

const sumWeeks = (weeks: WeekPoint[], from: number, to: number): Window =>
  weeks.slice(from, to).reduce((a, w) => ({ clicks: a.clicks + w.clicks, impressions: a.impressions + w.impressions }), { clicks: 0, impressions: 0 });

/** The week index a date falls in, from the series start. */
function weekIndex(weekly: WeekPoint[], at: string): number {
  return Math.floor((Date.parse(at) - Date.parse(`${weekly[0]!.start}T00:00:00Z`)) / WEEK_MS);
}

type Measure = { kind: 'measured'; impact: PostImpact } | { kind: 'pending' | 'tooOld' | 'none' };

/** One post against the rest (`others`: every other post, same weekly grid). */
export function measurePost(p: PostResult, others: PostResult[]): Measure {
  if (!p.appliedAt.length || !p.weekly.length) return { kind: 'none' };
  const len = p.weekly.length;
  // Only the latest change: an earlier one's "after" would include it.
  const at = p.appliedAt.at(-1)!;
  const k = weekIndex(p.weekly, at);
  if (k < MIN_IMPACT_WEEKS) return { kind: 'tooOld' };
  const n = Math.min(IMPACT_WEEKS, k, len - 1 - k);
  if (n < MIN_IMPACT_WEEKS) return { kind: 'pending' };
  const [b0, b1, a0, a1] = [k - n, k, k + 1, k + 1 + n];
  const blog = (from: number, to: number) =>
    others.reduce((a, o) => {
      const w = sumWeeks(o.weekly, from, to);
      return { clicks: a.clicks + w.clicks, impressions: a.impressions + w.impressions };
    }, { clicks: 0, impressions: 0 });
  const before = sumWeeks(p.weekly, b0, b1);
  const after = sumWeeks(p.weekly, a0, a1);
  const blogBefore = blog(b0, b1);
  const blogAfter = blog(a0, a1);
  const ratio = blogBefore.clicks ? blogAfter.clicks / blogBefore.clicks : 1;
  return { kind: 'measured', impact: { postId: p.postId, changedAt: at, weeks: n, before, after, blogBefore, blogAfter, expectedClicks: before.clicks * ratio } };
}

/** Every changed post, measured against the posts the panel didn't touch. */
export function measureImpact(posts: PostResult[]): ImpactSummary {
  const untouched = posts.filter((p) => !p.appliedAt.length);
  const out: ImpactSummary = { measured: [], pending: 0, tooOld: 0, before: 0, after: 0, expected: 0 };
  for (const p of posts) {
    const m = measurePost(p, untouched);
    if (m.kind === 'measured') {
      out.measured.push(m.impact);
      out.before += m.impact.before.clicks;
      out.after += m.impact.after.clicks;
      out.expected += m.impact.expectedClicks;
    } else if (m.kind === 'pending') out.pending++;
    else if (m.kind === 'tooOld') out.tooOld++;
  }
  return out;
}

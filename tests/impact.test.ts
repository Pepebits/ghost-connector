import { describe, expect, it } from 'vitest';
import { measureImpact, measurePost } from '../src/research/impact.js';
import type { PostResult } from '../src/research/results.js';

const START = Date.parse('2026-07-03T00:00:00Z');
const weekStart = (i: number) => new Date(START + i * 7 * 86400_000).toISOString().slice(0, 10);
const post = (id: string, clicks: number[], applied: string[] = []): PostResult => ({
  postId: id,
  title: id,
  url: `https://blog.com/${id}/`,
  publishedAt: null,
  appliedAt: applied,
  current: { clicks: 0, impressions: 0, position: 0 },
  previous: { clicks: 0, impressions: 0, position: 0 },
  weekly: clicks.map((c, i) => ({ start: weekStart(i), clicks: c, impressions: c * 10 })),
  queries: [],
});
// A date in the middle of week i.
const inWeek = (i: number) => new Date(START + i * 7 * 86400_000 + 3 * 86400_000).toISOString();

describe('impact of the panel changes', () => {
  it('compares 4 weeks before and after, leaving the change week out, against the rest of the blog', () => {
    const changed = post('a', [0, 0, 0, 0, 10, 10, 10, 10, 99, 20, 20, 20, 20, 0, 0, 0], [inWeek(8)]);
    // The rest of the blog grew 50% over the same weeks.
    const blog = post('b', [0, 0, 0, 0, 100, 100, 100, 100, 0, 150, 150, 150, 150, 0, 0, 0]);
    const m = measurePost(changed, [blog]);
    expect(m.kind).toBe('measured');
    if (m.kind !== 'measured') return;
    expect(m.impact.weeks).toBe(4);
    expect(m.impact.before.clicks).toBe(40);
    expect(m.impact.after.clicks).toBe(80);
    expect(m.impact.blogBefore.clicks).toBe(400);
    expect(m.impact.blogAfter.clicks).toBe(600);
    expect(m.impact.expectedClicks).toBe(60);
  });

  it('shrinks the windows near the edges, and only measures the latest change', () => {
    const w = Array(16).fill(5);
    const m = measurePost(post('a', w, [inWeek(2), inWeek(13)]), []);
    expect(m.kind === 'measured' && m.impact.weeks).toBe(2);
    expect(m.kind === 'measured' && m.impact.changedAt).toBe(inWeek(13));
    // No blog to compare against: expected = before.
    expect(m.kind === 'measured' && m.impact.expectedClicks).toBe(10);
  });

  it('too recent is pending; too early (or before the series) cannot be compared', () => {
    const w = Array(16).fill(5);
    expect(measurePost(post('a', w, [inWeek(14)]), []).kind).toBe('pending');
    expect(measurePost(post('a', w, [inWeek(1)]), []).kind).toBe('tooOld');
    expect(measurePost(post('a', w, ['2026-01-01T00:00:00Z']), []).kind).toBe('tooOld');
    expect(measurePost(post('a', w), []).kind).toBe('none');
  });

  it('adds up the measured posts; untouched posts are the baseline', () => {
    const s = measureImpact([
      post('a', [1, 1, 1, 1, 1, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0], [inWeek(5)]),
      post('b', Array(16).fill(1), [inWeek(15)]),
      post('c', Array(16).fill(3)),
    ]);
    expect(s.measured.map((m) => m.postId)).toEqual(['a']);
    expect(s.pending).toBe(1);
    expect([s.before, s.after, s.expected]).toEqual([4, 8, 4]);
  });
});

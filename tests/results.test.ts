import { describe, expect, it } from 'vitest';
import { bingPageRows } from '../src/research/bingWebmaster.js';
import { bingAsRows, blankWeeks, change, metricsByPage, periods, topQueriesByPage, weeklyByPage } from '../src/research/results.js';

const row = (keys: string[], clicks: number, impressions: number, position: number) => ({ keys, clicks, impressions, ctr: 0, position });

describe('results', () => {
  it('periods end 3 days back and compare 28 days against the 28 before', () => {
    const p = periods(new Date('2026-10-25T15:00:00Z'));
    expect(p.current.end.toISOString().slice(0, 10)).toBe('2026-10-22');
    expect(p.current.start.toISOString().slice(0, 10)).toBe('2026-09-25');
    expect(p.previous.end.toISOString().slice(0, 10)).toBe('2026-09-24');
    expect(p.previous.start.toISOString().slice(0, 10)).toBe('2026-08-28');
  });

  it('adds up a page across sources and URL forms, weighting position by impressions', () => {
    const m = metricsByPage([row(['https://www.blog.com/a/'], 2, 100, 4), row(['http://blog.com/a?x=1'], 1, 300, 8)]);
    expect(m.get('blog.com/a')).toEqual({ clicks: 3, impressions: 400, position: 7 });
  });

  it('buckets days into weeks and keeps empty weeks', () => {
    const start = new Date('2026-07-03T00:00:00Z');
    const w = weeklyByPage([row(['https://blog.com/a/', '2026-07-04'], 1, 10, 3), row(['https://blog.com/a/', '2026-07-12'], 2, 5, 3), row(['https://blog.com/a/', '2026-06-01'], 9, 9, 1)], start, 4).get('blog.com/a')!;
    expect(w.map((x) => x.clicks)).toEqual([1, 2, 0, 0]);
    expect(blankWeeks(start, 2).map((x) => x.start)).toEqual(['2026-07-03', '2026-07-10']);
  });

  it('keeps the top queries by clicks, then impressions', () => {
    const q = topQueriesByPage([row(['https://blog.com/a', 'x'], 1, 5, 2), row(['https://blog.com/a', 'y'], 1, 50, 2), row(['https://blog.com/a', 'z'], 3, 1, 2)], 2).get('blog.com/a')!;
    expect(q.map((x) => x.query)).toEqual(['z', 'y']);
  });

  it('turns Bing page stats into rows within a period', () => {
    const rows = bingPageRows([{ Query: 'https://blog.com/a/', Impressions: 10, Clicks: 1, AvgImpressionPosition: -1, Date: '/Date(1758758400000)/' }]);
    expect(rows[0]).toMatchObject({ date: '2025-09-25', position: 0 });
    expect(bingAsRows(rows, new Date('2025-09-01'), new Date('2025-09-30'), true)[0]!.keys).toEqual(['https://blog.com/a/', '2025-09-25']);
    expect(bingAsRows(rows, new Date('2025-10-01'), new Date('2025-10-30'), false)).toEqual([]);
  });

  it('change is relative, and null without a baseline', () => {
    expect(change(15, 10)).toBe(0.5);
    expect(change(5, 0)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import type { PostResult, ResultsCache } from '../src/research/results.js';
import { csvCell, csvFilename, postResultsCsv, resultsCsv, toCsv } from '../src/web/views/resultsCsv.js';

const post = (id: string, title: string, clicks: number, prev: number, applied: string[] = []): PostResult => ({
  postId: id,
  title,
  url: `https://blog.com/${id}/`,
  publishedAt: '2026-09-01T10:00:00.000Z',
  appliedAt: applied,
  current: { clicks, impressions: clicks * 10, position: 4.25 },
  previous: { clicks: prev, impressions: prev * 10, position: 5 },
  weekly: [{ start: '2026-07-03', clicks: 1, impressions: 9 }],
  queries: [{ query: '=HYPERLINK("http://x")', clicks: 2, impressions: 20, position: 3.5 }],
});

const cache: ResultsCache = {
  at: '2026-10-25T09:00:00.000Z',
  site: '[]',
  sources: ['google', 'bing'],
  current: { start: '2026-09-25', end: '2026-10-22' },
  previous: { start: '2026-08-28', end: '2026-09-24' },
  posts: [post('a', 'Uno, "dos"', 5, 10, ['2026-10-01T08:00:00Z']), post('b', '+cmd|calc', 50, 0), post('c', 'Tocado', 1, 1, ['2026-09-30T00:00:00Z'])],
  unpublished: 0,
};

const lines = (csv: string) => csv.replace(/^﻿/, '').trimEnd().split('\r\n');

describe('results CSV', () => {
  it('quotes and neutralises formulas in text, not in numbers', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('\tx')).toBe("'\tx");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell('-x,y')).toBe(`"'-x,y"`);
    // Excel in Spanish splits on ';': quoted, so "a;=cmd" can't become a formula cell.
    expect(csvCell('a;=cmd()')).toBe('"a;=cmd()"');
    expect(csvCell(-0.5)).toBe('-0.5');
    expect(csvCell(1 / 3)).toBe('0.3333');
    expect(csvCell(null)).toBe('');
    expect(csvCell(Infinity)).toBe('');
    expect(toCsv([['a', 1]]).startsWith('﻿a,1\r\n')).toBe(true);
  });

  it('exports what the list shows: panel scope by default, in its order', () => {
    const l = lines(resultsCsv(cache));
    expect(l).toHaveLength(3);
    expect(l[1]).toMatch(/^"Uno, ""dos""",https:\/\/blog.com\/a\/,a,2026-09-01,2026-10-01,5,50,0.1,4.25,10,100,0.1,5,-0.5,2026-09-25/);
    expect(l[1]!.endsWith(',google+bing')).toBe(true);
    const all = lines(resultsCsv(cache, 'all', 'clicks'));
    expect(all).toHaveLength(4);
    expect(all[1]!.startsWith("'+cmd|calc,")).toBe(true);
    // No previous clicks: no change figure.
    expect(all[1]!.split(',')[13]).toBe('');
  });

  it('exports one post: weeks, then queries (neutralised)', () => {
    const l = lines(postResultsCsv(cache.posts[0]!));
    expect(l[1]).toBe('2026-07-03,1,9');
    expect(l[2]).toBe('');
    expect(l[4]).toBe(`"'=HYPERLINK(""http://x"")",2,20,3.5`);
  });

  it('builds a header-safe file name', () => {
    expect(csvFilename(cache.at)).toMatch(/^[a-z]+-2026-10-25\.csv$/);
    expect(csvFilename(cache.at, 'Año "nuevo"\r\n; x=1/../')).toMatch(/^[a-z]+-ano-nuevo-x1-2026-10-25\.csv$/);
  });
});

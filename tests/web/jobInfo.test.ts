import { describe, expect, it } from 'vitest';
import type { JobRecord } from '../../src/db/jobs.js';
import { formatDuration, jobDuration, jobOptions, jobTarget, relativeTime } from '../../src/web/views/jobInfo.js';

const job = (over: Partial<JobRecord>): JobRecord => ({
  id: 'j', type: 'plan', params_json: null, state: 'done', created_at: '2026-01-01T00:00:00.000Z', started_at: null,
  finished_at: null, updated_at: '', total: 1, done: 1, result_json: null, error: null, created_by: null, ...over,
});

describe('web/jobInfo', () => {
  it('describes which posts it works on', () => {
    const titles = new Map([['a', 'Post A']]);
    expect(jobTarget(job({ params_json: '{"postIds":["a"]}' }), titles)).toBe('Post A');
    expect(jobTarget(job({ params_json: '{"postIds":["a","b","c"]}' }), titles)).toBe('Post A and 2 more');
    expect(jobTarget(job({ type: 'sync' }), titles)).toBe('All Ghost drafts');
    expect(jobTarget(job({ params_json: 'corrupto' }), titles)).toBe('—');
  });

  it('readable options', () => {
    expect(jobOptions(job({ params_json: '{"mode":"improve","extraInstructions":"x"}' }))).toEqual(['mode: improve version', 'with instructions']);
  });

  it('durations and relative dates', () => {
    expect(formatDuration(500)).toBe('<1 s');
    expect(formatDuration(26_000)).toBe('26 s');
    expect(formatDuration(125_000)).toBe('2 min 5 s');
    expect(jobDuration(job({ started_at: '2026-01-01T00:00:00.000Z', finished_at: '2026-01-01T00:00:26.000Z' }))).toBe('26 s');
    const now = Date.parse('2026-01-01T01:00:00.000Z');
    expect(relativeTime('2026-01-01T00:50:00.000Z', now)).toBe('10 min. ago');
    expect(relativeTime('2026-01-01T00:59:50.000Z', now)).toBe('just now');
  });
});

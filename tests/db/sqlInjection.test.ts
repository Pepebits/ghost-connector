import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ensureColumn, getDb } from '../../src/db/index.js';
import { getReviewStats, listApplyAttempts, recordReviewDecisions } from '../../src/db/repo.js';

const PAYLOAD = "x'); DROP TABLE jobs; --";

describe('db: SQL injection', () => {
  it('values are bound as parameters: a payload is stored as text and executes nothing', () => {
    recordReviewDecisions({ postId: PAYLOAD, runId: PAYLOAD, decisions: [{ category: PAYLOAD, accepted: false }] });
    const tables = getDb().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'`).all();
    expect(tables).toHaveLength(1);
    expect(getReviewStats().find((s) => s.category === PAYLOAD)?.rejected).toBe(1);
    expect(listApplyAttempts(PAYLOAD)).toEqual([]);
  });

  it('ensureColumn rejects anything but an identifier and a known type', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (id INTEGER)');
    expect(() => ensureColumn(db, 't; DROP TABLE t', 'c', 'TEXT')).toThrow();
    expect(() => ensureColumn(db, 't', 'c', 'TEXT; DROP TABLE t')).toThrow();
    expect(() => ensureColumn(db, 't', 'c"', 'TEXT')).toThrow();
    ensureColumn(db, 't', 'c', 'TEXT');
    expect(db.prepare('PRAGMA table_info(t)').all().map((r) => (r as { name: string }).name)).toEqual(['id', 'c']);
  });
});

describe('db/jobs: filters', () => {
  it('filters by status and type, and odd ids are just data', async () => {
    const { createJob, setJobState, listJobs, countJobEventsByLevel, appendJobEvent } = await import('../../src/db/jobs.js');
    createJob({ id: 'job-a', type: 'plan', params: {}, total: 1 });
    createJob({ id: 'job-b', type: 'sync', params: {}, total: 0 });
    setJobState('job-b', 'error', { error: 'x' });
    appendJobEvent('job-b', 'error', 'fallo');
    expect(listJobs({ state: 'active' }).map((j) => j.id)).toContain('job-a');
    expect(listJobs({ state: 'failed' }).map((j) => j.id)).toEqual(['job-b']);
    expect(listJobs({ type: 'sync' }).map((j) => j.id)).toEqual(['job-b']);
    expect(countJobEventsByLevel(['job-b', PAYLOAD]).get('job-b')).toEqual({ warn: 0, error: 1 });
  });
});

describe('db/jobs: clearing history', () => {
  it('deletes finished jobs and their log, and keeps running ones', async () => {
    const { createJob, setJobState, getJob, deleteFinishedJobs, appendJobEvent, listJobEvents } = await import('../../src/db/jobs.js');
    createJob({ id: 'del-done', type: 'plan', params: {}, total: 1 });
    setJobState('del-done', 'done');
    appendJobEvent('del-done', 'info', 'hecho');
    createJob({ id: 'del-running', type: 'plan', params: {}, total: 1 });
    setJobState('del-running', 'running');
    appendJobEvent('del-running', 'info', 'trabajando');
    expect(deleteFinishedJobs()).toBeGreaterThanOrEqual(1);
    expect(getJob('del-done')).toBeUndefined();
    expect(listJobEvents('del-done')).toEqual([]);
    expect(getJob('del-running')?.state).toBe('running');
    expect(listJobEvents('del-running')).toHaveLength(1);
  });
});

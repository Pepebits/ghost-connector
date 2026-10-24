import { currentActor } from '../auth/context.js';
import { getDb } from './index.js';

export type JobState = 'queued' | 'running' | 'cancelling' | 'cancelled' | 'done' | 'error' | 'interrupted';
export type JobType = 'plan' | 'apply' | 'resolve' | 'sync';

export const TERMINAL_JOB_STATES: JobState[] = ['cancelled', 'done', 'error', 'interrupted'];

export interface JobRecord {
  id: string;
  type: JobType;
  params_json: string | null;
  state: JobState;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
  total: number;
  done: number;
  result_json: string | null;
  error: string | null;
  /** Who started it (null: automatic, CLI or before there were users). */
  created_by: string | null;
}

export interface JobEventRecord {
  id: number;
  job_id: string;
  at: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  data_json: string | null;
}

export function createJob(input: { id: string; type: JobType; params: unknown; total: number }): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO jobs (id, type, params_json, state, created_at, updated_at, total, done, created_by) VALUES (?,?,?,?,?,?,?,0,?)`,
    )
    .run(input.id, input.type, JSON.stringify(input.params), 'queued', now, now, input.total, currentActor());
}

export function setJobState(id: string, state: JobState, extra: { error?: string; resultJson?: string } = {}): void {
  const now = new Date().toISOString();
  const db = getDb();
  if (state === 'running') {
    db.prepare(`UPDATE jobs SET state=?, started_at=COALESCE(started_at, ?), updated_at=? WHERE id=?`).run(state, now, now, id);
  } else if (['done', 'error', 'cancelled', 'interrupted'].includes(state)) {
    db.prepare(`UPDATE jobs SET state=?, finished_at=?, updated_at=?, error=?, result_json=COALESCE(?, result_json) WHERE id=?`).run(
      state,
      now,
      now,
      extra.error ?? null,
      extra.resultJson ?? null,
      id,
    );
  } else {
    db.prepare(`UPDATE jobs SET state=?, updated_at=? WHERE id=?`).run(state, now, id);
  }
}

export function touchJob(id: string): void {
  getDb().prepare(`UPDATE jobs SET updated_at=? WHERE id=?`).run(new Date().toISOString(), id);
}

export function setJobTotal(id: string, total: number): void {
  getDb().prepare(`UPDATE jobs SET total=?, updated_at=? WHERE id=?`).run(total, new Date().toISOString(), id);
}

export function incrementJobDone(id: string): void {
  getDb().prepare(`UPDATE jobs SET done = done + 1, updated_at=? WHERE id=?`).run(new Date().toISOString(), id);
}

export function getJob(id: string): JobRecord | undefined {
  return getDb().prepare(`SELECT * FROM jobs WHERE id=?`).get(id) as JobRecord | undefined;
}

export function listRecentJobs(limit = 20): JobRecord[] {
  return getDb().prepare(`SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?`).all(limit) as unknown as JobRecord[];
}

export const ACTIVE_JOB_STATES: JobState[] = ['queued', 'running', 'cancelling'];
const FAILED_JOB_STATES: JobState[] = ['error', 'interrupted'];

export type JobStateFilter = 'all' | 'active' | 'failed';

export interface JobListFilter {
  state?: JobStateFilter;
  type?: JobType;
  limit?: number;
}

/**
 * Filtered list for the Jobs tab. The status lists are code
 * constants, but they are still passed as parameters (?), never concatenated.
 */
export function listJobs(filter: JobListFilter = {}): JobRecord[] {
  const states = filter.state === 'active' ? ACTIVE_JOB_STATES : filter.state === 'failed' ? FAILED_JOB_STATES : null;
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (states) {
    where.push(`state IN (${states.map(() => '?').join(',')})`);
    params.push(...states);
  }
  if (filter.type) {
    where.push('type = ?');
    params.push(filter.type);
  }
  params.push(Math.min(Math.max(filter.limit ?? 50, 1), 500));
  const sql = `SELECT * FROM jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`;
  return getDb().prepare(sql).all(...params) as unknown as JobRecord[];
}

export interface JobEventCounts {
  warn: number;
  error: number;
}

/** Warnings/errors per job, to flag in the list those that finished "fine" but with problems. */
export function countJobEventsByLevel(jobIds: string[]): Map<string, JobEventCounts> {
  const out = new Map<string, JobEventCounts>();
  if (jobIds.length === 0) return out;
  const rows = getDb()
    .prepare(
      `SELECT job_id, level, COUNT(*) AS n FROM job_events
       WHERE level IN ('warn','error') AND job_id IN (${jobIds.map(() => '?').join(',')})
       GROUP BY job_id, level`,
    )
    .all(...jobIds) as Array<{ job_id: string; level: 'warn' | 'error'; n: number }>;
  for (const r of rows) {
    const c = out.get(r.job_id) ?? { warn: 0, error: 0 };
    c[r.level] = r.n;
    out.set(r.job_id, c);
  }
  return out;
}

export function isJobType(value: string | undefined): value is JobType {
  return value === 'plan' || value === 'apply' || value === 'resolve' || value === 'sync';
}

/** On server startup: any job left "running"/"cancelling" from a previous crash becomes "interrupted". */
export function interruptOrphanedJobs(): number {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(`UPDATE jobs SET state='interrupted', finished_at=?, updated_at=? WHERE state IN ('running','cancelling','queued')`)
    .run(now, now);
  return Number(result.changes);
}

export function appendJobEvent(jobId: string, level: 'info' | 'warn' | 'error', message: string, data?: unknown): JobEventRecord {
  const db = getDb();
  const at = new Date().toISOString();
  const dataJson = data !== undefined ? JSON.stringify(data) : null;
  const result = db.prepare(`INSERT INTO job_events (job_id, at, level, message, data_json) VALUES (?,?,?,?,?)`).run(
    jobId,
    at,
    level,
    message,
    dataJson,
  );
  return { id: Number(result.lastInsertRowid), job_id: jobId, at, level, message, data_json: dataJson };
}

export function listJobEvents(jobId: string, sinceId = 0): JobEventRecord[] {
  return getDb()
    .prepare(`SELECT * FROM job_events WHERE job_id=? AND id > ? ORDER BY id ASC`)
    .all(jobId, sinceId) as unknown as JobEventRecord[];
}

/**
 * Deletes the history of finished jobs (and their log). Running jobs are not
 * touched: they keep writing events and the queue waits for them. Returns how many were deleted.
 */
export function deleteFinishedJobs(): number {
  const db = getDb();
  const placeholders = TERMINAL_JOB_STATES.map(() => '?').join(',');
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM job_events WHERE job_id IN (SELECT id FROM jobs WHERE state IN (${placeholders}))`).run(...TERMINAL_JOB_STATES);
    const result = db.prepare(`DELETE FROM jobs WHERE state IN (${placeholders})`).run(...TERMINAL_JOB_STATES);
    db.exec('COMMIT');
    return Number(result.changes);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

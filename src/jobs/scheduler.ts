import { budgetStatus } from '../agents/budget.js';
import { getConfig } from '../config.js';
import { getMeta, setMeta } from '../db/repo.js';
import { listDrafts } from '../ghost/posts.js';
import { logger } from '../logger.js';
import { findLatestArtifactsByPost } from '../review/store.js';
import { computePostState } from '../state/postState.js';
import { enqueuePlanJob } from './queue.js';

/**
 * Nightly plan (AUTO_PLAN_TIME, "HH:MM" local time, empty = off): once a
 * day it plans the drafts that were never planned, at most AUTO_PLAN_MAX of
 * them. It only plans: nothing is applied to Ghost without you. The daily
 * AI cap still applies on top of that.
 */

const META_KEY = 'auto_plan_last_day';
const RESULT_KEY = 'auto_plan_last_result';

export interface AutoPlanNotice {
  at: string;
  jobId: string | null;
  planned: number;
  reason?: 'none' | 'budget';
  dismissed?: boolean;
}

function saveResult(r: AutoPlanResult): AutoPlanResult {
  setMeta(RESULT_KEY, JSON.stringify({ at: new Date().toISOString(), ...r } satisfies AutoPlanNotice));
  return r;
}

/** Last nightly run, for the notice on Drafts (only the last 20 h, unless dismissed). */
export function autoPlanNotice(now = Date.now()): AutoPlanNotice | null {
  try {
    const n = JSON.parse(getMeta(RESULT_KEY) ?? 'null') as AutoPlanNotice | null;
    if (!n || n.dismissed || now - new Date(n.at).getTime() > 20 * 3600_000) return null;
    // "Nothing new" isn't worth a notice.
    return n.reason === 'none' ? null : n;
  } catch {
    return null;
  }
}

export function dismissAutoPlanNotice(): void {
  const raw = getMeta(RESULT_KEY);
  if (raw) setMeta(RESULT_KEY, JSON.stringify({ ...(JSON.parse(raw) as AutoPlanNotice), dismissed: true }));
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Whether the nightly plan is due now (exported for the tests). */
export function isDue(time: string, lastDay: string | undefined, now = new Date()): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= Number(m[1]) * 60 + Number(m[2]) && lastDay !== localDay(now);
}

/** Drafts never planned, oldest edit first, capped (exported for the tests). */
export function pickNeverPlanned<T extends { id: string; updated_at: string }>(drafts: T[], kindOf: (d: T) => string, max: number): string[] {
  return drafts
    .filter((d) => kindOf(d) === 'never-planned')
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
    .slice(0, Math.max(0, max))
    .map((d) => d.id);
}

export interface AutoPlanResult {
  jobId: string | null;
  planned: number;
  reason?: 'none' | 'budget';
}

export async function runAutoPlan(now = new Date()): Promise<AutoPlanResult> {
  const cfg = getConfig();
  // The day is marked only once there is an outcome: a Ghost/network error
  // leaves it unmarked, so the next minute's tick tries again.
  const done = (r: AutoPlanResult) => {
    setMeta(META_KEY, localDay(now));
    return saveResult(r);
  };
  if (budgetStatus()?.exceeded) {
    logger.warn('Nightly plan skipped: daily AI cap reached');
    return done({ jobId: null, planned: 0, reason: 'budget' });
  }
  const [drafts, latest] = await Promise.all([listDrafts(), findLatestArtifactsByPost()]);
  const ids = pickNeverPlanned(drafts, (d) => computePostState(d, latest.get(d.id) ?? null).kind, cfg.AUTO_PLAN_MAX);
  if (ids.length === 0) {
    logger.info('Nightly plan: no new drafts');
    return done({ jobId: null, planned: 0, reason: 'none' });
  }
  const jobId = enqueuePlanJob({ postIds: ids });
  logger.info({ jobId, posts: ids.length }, 'Nightly plan started');
  return done({ jobId, planned: ids.length });
}

let timer: NodeJS.Timeout | null = null;
let inFlight = false;
let lastError = 0;

/** Checks every minute; a missed time (server off) runs on the next start of that day. */
export function startScheduler(): void {
  if (timer) return;
  const tick = () => {
    const time = getConfig().AUTO_PLAN_TIME;
    if (inFlight || !time || !isDue(time, getMeta(META_KEY))) return;
    // After a failure, retry every 15 minutes instead of every minute.
    if (Date.now() - lastError < 15 * 60_000) return;
    inFlight = true;
    runAutoPlan()
      .catch((err) => {
        lastError = Date.now();
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Nightly plan failed: retrying in 15 min');
      })
      .finally(() => {
        inFlight = false;
      });
  };
  timer = setInterval(tick, 60_000);
  timer.unref();
  tick();
}

export function lastAutoPlanDay(): string | undefined {
  return getMeta(META_KEY);
}

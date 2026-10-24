import type { JobRecord, JobType } from '../../db/jobs.js';
import { t } from '../../i18n/index.js';
import { html, raw } from '../html.js';
import { confirmDialog } from './ui.js';

const JOB_TYPES: JobType[] = ['plan', 'apply', 'resolve', 'sync'];
const MODES = ['draft', 'improve'];

export function jobTypeLabel(type: JobType): string {
  return t(`jobs.type.${type}`);
}

/** Labels translated on read (the language can change at runtime). */
export const JOB_TYPE_LABELS = Object.defineProperties(
  {},
  Object.fromEntries(JOB_TYPES.map((k) => [k, { get: () => jobTypeLabel(k), enumerable: true }])),
) as Readonly<Record<JobType, string>>;

export interface JobParams {
  postIds?: string[];
  extraInstructions?: string;
  mode?: string;
  allowPending?: boolean;
  forceSanity?: boolean;
}

export function jobParams(job: JobRecord): JobParams {
  try {
    return (job.params_json ? JSON.parse(job.params_json) : {}) as JobParams;
  } catch {
    return {}; // corrupt or old-format params_json: doesn't block the view
  }
}

export function jobRunId(job: JobRecord): string | null {
  try {
    return (job.result_json ? (JSON.parse(job.result_json) as { runId?: string }).runId : null) ?? null;
  } catch {
    return null;
  }
}

/** "What" the job works on, as text: post titles (if in the index) or "all drafts". */
export function jobTarget(job: JobRecord, titles: Map<string, string>): string {
  if (job.type === 'sync') return t('jobs.target.allDrafts');
  const ids = jobParams(job).postIds ?? [];
  if (ids.length === 0) return '—';
  const first = titles.get(ids[0]!) ?? ids[0]!;
  return ids.length === 1 ? first : t('jobs.target.more', { first, count: ids.length - 1 });
}

/** Secondary details (mode, options), shown under the target. */
export function jobOptions(job: JobRecord): string[] {
  const p = jobParams(job);
  const out: string[] = [];
  if (p.mode && MODES.includes(p.mode)) out.push(t('jobs.options.mode', { mode: t(`jobs.mode.${p.mode}`) }));
  if (p.extraInstructions) out.push(t('jobs.options.instructions'));
  if (p.allowPending) out.push(t('jobs.options.allowPending'));
  if (p.forceSanity) out.push(t('jobs.options.forceSanity'));
  return out;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return '<1 s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Actual duration (start -> end), or elapsed time if still running. */
export function jobDuration(job: JobRecord, now = Date.now()): string {
  if (!job.started_at) return '—';
  const end = job.finished_at ? Date.parse(job.finished_at) : now;
  return formatDuration(end - Date.parse(job.started_at));
}

export { relativeTime, timeTag } from './ui.js';

/** Cancel a job: the same button (and the same confirmation) in the list and the console. */
export function cancelJobControl(jobId: string): string {
  const id = `cancel-${jobId}`;
  return html`<button type="button" class="btn btn-ghost btn-sm" data-open-dialog="${id}">${t('jobs.cancel.button')}</button>${raw(
    confirmDialog({
      id,
      title: t('jobs.cancel.title'),
      body: t('jobs.cancel.body'),
      confirmLabel: t('jobs.cancel.confirm'),
      danger: true,
      action: `/jobs/${jobId}/cancel`,
    }),
  )}`;
}

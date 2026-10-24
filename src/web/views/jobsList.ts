import { t } from '../../i18n/index.js';
import { ACTIVE_JOB_STATES, type JobEventCounts, type JobRecord, type JobStateFilter, type JobType } from '../../db/jobs.js';
import { jobStateBadge } from './badge.js';
import { html, raw } from '../html.js';
import { layout } from './layout.js';
import { chip, confirmDialog, emptyRow, flash, pageHeader } from './ui.js';
import { cancelJobControl, JOB_TYPE_LABELS, jobDuration, jobOptions, jobTarget, timeTag } from './jobInfo.js';

export interface JobsListOpts {
  jobs: JobRecord[];
  /** Running jobs, always (even if the active filter hides them from the table). */
  active: JobRecord[];
  counts: Map<string, JobEventCounts>;
  titles: Map<string, string>;
  filter: { state: JobStateFilter; type?: JobType };
  limit: number;
  /** Jobs deleted in the previous action (for the notice after redirect). */
  deleted?: number;
}

function progressBar(job: JobRecord): string {
  const pct = job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;
  return html`<div class="h-1.5 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-label="${t('jobs.list.progress')}" aria-valuemin="0" aria-valuemax="${job.total}" aria-valuenow="${job.done}">
    <div class="h-full bg-accent transition-[width] duration-300" style="width:${pct}%" data-job-bar></div>
  </div>`;
}

function problemFlags(job: JobRecord, counts: JobEventCounts | undefined): string {
  const out: string[] = [];
  if (counts?.error) out.push(html`<span class="flag text-err border-err/50">${t('jobs.list.errors', { count: counts.error })}</span>`);
  if (counts?.warn) out.push(html`<span class="flag text-warn border-warn/50">${t('jobs.list.warnings', { count: counts.warn })}</span>`);
  if (job.error) out.push(html`<span class="flag text-err border-err/50" title="${job.error}">${t('jobs.list.jobFailed')}</span>`);
  return out.join(' ');
}

function activeCard(job: JobRecord, titles: Map<string, string>): string {
  return html`<li class="card p-3.5" data-active-job="${job.id}">
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
      <div class="min-w-0">
        <a href="/jobs/${job.id}" class="font-medium">${JOB_TYPE_LABELS[job.type]}: ${jobTarget(job, titles)}</a>
        <div class="text-xs text-muted">${raw(t('jobs.list.started', { time: timeTag(job.started_at ?? job.created_at) }))} · <span data-job-progress>${job.done}/${job.total || '?'}</span></div>
      </div>
      <div class="flex items-center gap-2">
        <span data-job-state>${raw(jobStateBadge(job.state))}</span>
        ${job.state !== 'cancelling' ? raw(cancelJobControl(job.id)) : ''}
      </div>
    </div>
    ${raw(progressBar(job))}
    <p class="!mb-0 truncate text-xs text-muted" data-job-last></p>
  </li>`;
}

function jobRow(job: JobRecord, opts: JobsListOpts): string {
  const options = jobOptions(job);
  return html`
    <tr>
      <td class="whitespace-nowrap">${JOB_TYPE_LABELS[job.type]}</td>
      <td class="min-w-48">
        <a href="/jobs/${job.id}" class="font-medium">${jobTarget(job, opts.titles)}</a>
        ${options.length ? raw(html`<div class="text-xs text-muted">${options.join(' · ')}</div>`) : ''}
      </td>
      <td><div class="flex flex-wrap items-center gap-2">${raw(jobStateBadge(job.state))} ${raw(problemFlags(job, opts.counts.get(job.id)))}</div></td>
      <td class="text-right tabular-nums">${job.done}/${job.total}</td>
      <td class="whitespace-nowrap text-right tabular-nums max-sm:hidden">${jobDuration(job)}</td>
      <td class="whitespace-nowrap text-muted">${raw(timeTag(job.created_at))}${job.created_by ? raw(html`<span class="block text-xs">${t('auth.by', { name: job.created_by })}</span>`) : ''}</td>
    </tr>`;
}

function filterHref(state: JobStateFilter, type?: JobType, limit?: number): string {
  const q = new URLSearchParams();
  if (state !== 'all') q.set('state', state);
  if (type) q.set('type', type);
  if (limit) q.set('limit', String(limit));
  const s = q.toString();
  return s ? `/jobs?${s}` : '/jobs';
}

export function jobsListPage(opts: JobsListOpts): string {
  const { filter } = opts;
  const filtered = filter.state !== 'all' || !!filter.type;
  const stateChips = (
    [
      ['all', t('jobs.list.filter.all')],
      ['active', t('jobs.list.filter.active')],
      ['failed', t('jobs.list.filter.failed')],
    ] as Array<[JobStateFilter, string]>
  )
    .map(([s, label]) => chip(label, filterHref(s, filter.type), filter.state === s))
    .join('');
  const typeChips = [
    chip(t('jobs.list.filter.anyType'), filterHref(filter.state), !filter.type),
    ...(Object.keys(JOB_TYPE_LABELS) as JobType[]).map((ty) => chip(JOB_TYPE_LABELS[ty], filterHref(filter.state, ty), filter.type === ty)),
  ].join('');

  const activeBlock =
    opts.active.length > 0
      ? html`<section class="mb-6" aria-labelledby="active-title">
          <h2 id="active-title" class="section-heading">${t('jobs.list.active')} <span class="font-normal text-muted">(${opts.active.length})</span></h2>
          <ul class="grid gap-3">${raw(opts.active.map((j) => activeCard(j, opts.titles)).join(''))}</ul>
        </section>`
      : '';

  const rows = opts.jobs.map((j) => jobRow(j, opts)).join('\n');
  const more =
    opts.jobs.length >= opts.limit
      ? html`<p class="mt-3"><a href="${filterHref(filter.state, filter.type, opts.limit + 50)}">${t('jobs.list.more')}</a></p>`
      : '';

  const hasFinished = opts.jobs.some((j) => !isActiveJob(j)) || filter.state !== 'all' || !!filter.type;
  const deleteControl = hasFinished
    ? html`<button type="button" class="btn btn-ghost btn-sm" data-open-dialog="delete-jobs-dialog">${t('jobs.list.delete.button')}</button>${raw(
        confirmDialog({
          id: 'delete-jobs-dialog',
          title: t('jobs.list.delete.title'),
          body: t('jobs.list.delete.body'),
          confirmLabel: t('jobs.list.delete.confirm'),
          danger: true,
          action: '/jobs/delete-finished',
        }),
      )}`
    : '';
  const deletedNotice =
    opts.deleted !== undefined
      ? flash(opts.deleted === 0 ? t('jobs.list.delete.none') : t('jobs.list.delete.done', { count: opts.deleted }), opts.deleted === 0 ? 'info' : 'ok')
      : '';

  const body = html`
    ${raw(pageHeader({ title: t('jobs.list.title'), meta: t('jobs.list.meta'), actions: deleteControl }))}
    ${raw(deletedNotice)}
    ${raw(activeBlock)}
    <div class="mb-4 flex flex-col gap-2">
      <nav class="flex flex-wrap gap-2" aria-label="${t('jobs.list.filter.byState')}">${raw(stateChips)}</nav>
      <nav class="flex flex-wrap items-center gap-2" aria-label="${t('jobs.list.filter.byType')}">${raw(typeChips)}${filtered ? raw(html`<a class="chip-clear ml-1" href="/jobs">${t('common.actions.clearFilters')}</a>`) : ''}</nav>
    </div>
    <div class="overflow-x-auto">
      <table class="data-table">
        <thead><tr><th>${t('jobs.list.col.type')}</th><th>${t('jobs.list.col.target')}</th><th>${t('jobs.list.col.state')}</th><th class="text-right">${t('jobs.list.col.progress')}</th><th class="text-right max-sm:hidden">${t('jobs.list.col.duration')}</th><th>${t('jobs.list.col.created')}</th></tr></thead>
        <tbody>${raw(
          rows ||
            (filtered
              ? emptyRow(6, { title: t('jobs.list.empty.filtered'), action: { href: '/jobs', label: t('common.actions.clearFilters') } })
              : emptyRow(6, { title: t('jobs.list.empty.title'), body: t('jobs.list.empty.body'), action: { href: '/', label: t('jobs.list.empty.action') } }))
        )}</tbody>
      </table>
    </div>
    ${raw(more)}
    ${opts.active.length > 0 || hasFinished ? raw('<script src="/jobs-list.js" defer></script>') : ''}
  `;
  return layout({ title: t('jobs.list.title'), bodyHtml: body, section: 'jobs' });
}

export function isActiveJob(job: JobRecord): boolean {
  return ACTIVE_JOB_STATES.includes(job.state);
}

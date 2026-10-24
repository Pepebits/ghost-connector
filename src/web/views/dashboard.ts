import type { AutoPlanNotice } from '../../jobs/scheduler.js';
import type { BudgetStatus } from '../../agents/budget.js';
import type { CostSummary, PostGoneRow, ProviderQuota } from '../../db/repo.js';
import type { PostStateKind, PostSummary } from '../../state/postState.js';
import { badge, KIND_LABELS } from './badge.js';
import { formatUsd } from './format.js';
import { escapeHtml, html, raw } from '../html.js';
import { layout } from './layout.js';
import { reviewQueue } from '../../state/reviewQueue.js';
import { chip, confirmDialog, emptyRow, flash, pageHeader, relativeTime, timeTag } from './ui.js';
import { t } from '../../i18n/index.js';

const ALL_KINDS = Object.keys(KIND_LABELS) as PostStateKind[];

/** Assignee, notes and who has each post open (only with more than one user). */
export interface DashboardTeam {
  me: string;
  assignments: Map<string, string>;
  notes: Map<string, number>;
  viewing: Map<string, string[]>;
}

function row(s: PostSummary, team?: DashboardTeam): string {
  return html`
    <tr data-post-row="${s.id}" class="[&.is-current]:bg-panel-2 [&.is-current]:outline-2 [&.is-current]:-outline-offset-2 [&.is-current]:outline-accent">
      <td class="w-8"><input type="checkbox" name="postIds" value="${s.id}" class="row-check" aria-label="${t('dashboard.selectRow', { title: s.title })}" /></td>
      <td><a href="/posts/${s.id}" class="font-medium">${s.title}</a>${s.plannedTitle ? raw(html`<div class="text-xs text-accent">${t('dashboard.plannedTitle', { title: s.plannedTitle })}</div>`) : ''}<div class="text-xs text-muted">${s.slug}</div></td>
      <td>${raw(badge(s.kind))}</td>
      <td class="max-sm:hidden">${raw(teamFlags(s.id, team))}${raw(flags(s))}</td>
      <td class="text-right tabular-nums">${s.wordCount}</td>
    </tr>`;
}

function teamFlags(id: string, team?: DashboardTeam): string {
  if (!team) return '';
  const out: string[] = [];
  const assignee = team.assignments.get(id);
  if (assignee) out.push(html`<span class="flag ${assignee.toLowerCase() === team.me.toLowerCase() ? 'text-accent border-accent/50' : ''}" title="${t('dashboard.flags.assignedTitle', { name: assignee })}">${t('dashboard.flags.assigned', { name: assignee })}</span>`);
  const viewing = team.viewing.get(id);
  if (viewing) out.push(html`<span class="flag text-warn border-warn/50">${t('dashboard.flags.viewing', { names: viewing.join(', ') })}</span>`);
  const notes = team.notes.get(id);
  if (notes) out.push(html`<a class="flag hover:no-underline" href="/posts/${id}#notas">${t('dashboard.flags.notes', { count: notes })}</a>`);
  return out.join(' ');
}

/** A single column of notices instead of three mostly empty columns. */
function flags(s: PostSummary): string {
  const out: string[] = [];
  if (s.issues.length > 0) out.push(html`<span class="flag text-warn border-warn/50" title="${t('dashboard.flags.issuesTitle')}">${t('dashboard.flags.issues', { count: s.issues.length })}</span>`);
  if (s.pendingCount > 0) out.push(html`<span class="flag text-accent border-accent/50" title="${t('dashboard.flags.pendingTitle')}">${t('dashboard.flags.pending', { count: s.pendingCount })}</span>`);
  if (!s.featureImage) out.push(html`<span class="flag text-muted">${t('dashboard.flags.noImage')}</span>`);
  return out.join(' ');
}

const GHOST_STATUSES = new Set(['published', 'scheduled', 'sent', 'draft']);

/** Dashboard URL with the given filters; no empty params. */
function dashHref(f: { kind?: PostStateKind; noImage?: boolean; mine?: boolean; q?: string }): string {
  const p = new URLSearchParams();
  if (f.kind) p.set('kind', f.kind);
  if (f.noImage) p.set('noImage', '1');
  if (f.mine) p.set('mine', '1');
  if (f.q) p.set('q', f.q);
  const s = p.toString();
  return s ? `/?${s}` : '/';
}

function goneRow(g: PostGoneRow): string {
  return html`<tr><td>${g.title}</td><td>${GHOST_STATUSES.has(g.last_status) ? t(`dashboard.ghostStatus.${g.last_status}`) : g.last_status}</td><td>${raw(timeTag(g.detected_at))}</td></tr>`;
}

function quotaLine(q: ProviderQuota): string {
  const limit = q.provider === 'unsplash' ? 50 : q.provider === 'pixabay' ? 100 : 200;
  const value = q.lastRemaining === null ? '?' : q.lastRemaining;
  return html`${q.provider} ~${value}/${limit}`;
}

const QUEUE_HINT_KINDS = new Set<PostStateKind>(['planned', 'has-pending', 'plan-stale', 'failed', 'blocked']);

function queueHint(kind: PostStateKind): string {
  return QUEUE_HINT_KINDS.has(kind) ? t(`dashboard.queue.hint.${kind}`) : '';
}

const QUEUE_TARGET: Partial<Record<PostStateKind, string>> = { planned: '#revisar', 'has-pending': '#pendientes', 'plan-stale': '#planificar' };

/** "To review" inbox: what needs a decision, ahead of the full list. */
function queueSection(summaries: PostSummary[], justFinished: boolean): string {
  const queue = reviewQueue(summaries);
  if (queue.length === 0) {
    return justFinished
      ? flash(t('dashboard.queue.empty'))
      : '';
  }
  const items = queue
    .slice(0, 8)
    .map(
      (s) => html`<li class="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 last:border-b-0">
        <span class="min-w-0"><a href="/posts/${s.id}${QUEUE_TARGET[s.kind] ?? ''}" class="font-medium">${s.title}</a>
          <span class="block text-xs text-muted">${queueHint(s.kind)}</span></span>
        ${raw(badge(s.kind))}
      </li>`,
    )
    .join('');
  const more = queue.length > 8 ? html`<p class="mt-2 text-xs text-muted">${t('dashboard.queue.more', { count: queue.length - 8 })}</p>` : '';
  return html`<section class="card mb-6 p-4" aria-labelledby="queue-title">
    <div class="mb-1 flex flex-wrap items-center justify-between gap-2">
      <h2 id="queue-title" class="section-heading !mb-0">${t('dashboard.queue.title')} <span class="font-normal text-muted">(${queue.length})</span></h2>
      <a class="btn btn-sm" href="/posts/${queue[0]!.id}${QUEUE_TARGET[queue[0]!.kind] ?? ''}">${t('dashboard.queue.startFirst')}</a>
    </div>
    <ul>${raw(items)}</ul>
    ${raw(more)}
  </section>`;
}

export interface DashboardOpts {
  summaries: PostSummary[];
  activeKind?: PostStateKind;
  q?: string;
  noImage?: boolean;
  /** Only the posts assigned to me. */
  mine?: boolean;
  team?: DashboardTeam;
  ghostUrl: string;
  draftFilter: string;
  syncedAt: string | null;
  quotas: ProviderQuota[];
  gone: PostGoneRow[];
  cost: CostSummary;
  budget?: BudgetStatus | null;
  /** Arrived from "Next to review" with nothing left in the inbox. */
  queueDone?: boolean;
  /** Last nightly plan (AUTO_PLAN_TIME), if recent. */
  autoPlan?: AutoPlanNotice | null;
  /** "Enable 2FA" banner (already rendered), or ''. */
  nag2fa?: string;
}


function autoPlanFlash(n: AutoPlanNotice | null | undefined): string {
  if (!n) return '';
  const text =
    n.reason === 'budget'
      ? t('dashboard.autoPlan.budget', { time: relativeTime(n.at) })
      : html`${t('dashboard.autoPlan.done', { count: n.planned, time: relativeTime(n.at) })} ${n.jobId ? raw(html`<a href="/jobs/${n.jobId}">${t('dashboard.autoPlan.view')}</a>`) : ''}`;
  return html`<div class="flash flash-${n.reason === 'budget' ? 'warn' : 'info'} flex flex-wrap items-center justify-between gap-2" role="status">
    <span>${raw(text)}</span>
    <form method="post" action="/auto-plan/dismiss"><button type="submit" class="btn btn-ghost btn-sm">${t('dashboard.autoPlan.dismiss')}</button></form>
  </div>`;
}

export function dashboardPage(opts: DashboardOpts): string {
  const q = (opts.q ?? '').trim().toLowerCase();
  const isMine = (id: string) => !!opts.team && opts.team.assignments.get(id)?.toLowerCase() === opts.team.me.toLowerCase();
  const visible = opts.summaries.filter(
    (s) =>
      (!opts.activeKind || s.kind === opts.activeKind) &&
      (!opts.noImage || !s.featureImage) &&
      (!opts.mine || isMine(s.id)) &&
      (!q || s.title.toLowerCase().includes(q) || s.slug.includes(q)),
  );

  const countsByKind = new Map<PostStateKind, number>();
  for (const s of opts.summaries) countsByKind.set(s.kind, (countsByKind.get(s.kind) ?? 0) + 1);
  const noImageCount = opts.summaries.filter((s) => !s.featureImage).length;

  // Status: exclusive (one at a time). "No image": combines with status and search.
  const keep = { noImage: opts.noImage, mine: opts.mine, q: opts.q?.trim() || undefined };
  const chips = [
    chip(t('dashboard.chipAll'), dashHref(keep), !opts.activeKind, opts.summaries.length),
    // Only statuses with some post (or the active one): 8 chips at 0 were noise.
    ...ALL_KINDS.filter((k) => (countsByKind.get(k) ?? 0) > 0 || opts.activeKind === k).map((k) =>
      chip(KIND_LABELS[k], dashHref({ ...keep, kind: k }), opts.activeKind === k, countsByKind.get(k) ?? 0),
    ),
  ].join('\n');
  const noImageChip =
    noImageCount > 0 || opts.noImage
      ? chip(opts.noImage ? `${t('dashboard.chipNoImage')} ✕` : t('dashboard.chipNoImage'), dashHref({ kind: opts.activeKind, q: keep.q, mine: opts.mine, noImage: !opts.noImage }), !!opts.noImage, noImageCount)
      : '';
  const mineCount = opts.summaries.filter((s) => isMine(s.id)).length;
  const mineChip =
    opts.team && (mineCount > 0 || opts.mine)
      ? chip(opts.mine ? `${t('dashboard.chipMine')} ✕` : t('dashboard.chipMine'), dashHref({ kind: opts.activeKind, q: keep.q, noImage: opts.noImage, mine: !opts.mine }), !!opts.mine, mineCount)
      : '';
  const filtered = !!opts.activeKind || !!opts.noImage || !!opts.mine || !!q;

  const rows = visible.map((s) => row(s, opts.team)).join('\n');
  const hiddenKind = opts.activeKind ? html`<input type="hidden" name="kind" value="${opts.activeKind}" />` : '';
  const hiddenNoImage = (opts.noImage ? html`<input type="hidden" name="noImage" value="1" />` : '') + (opts.mine ? html`<input type="hidden" name="mine" value="1" />` : '');

  const quotaBlock = opts.quotas.length > 0 ? opts.quotas.map(quotaLine).join(' · ') : '';

  const goneRows = opts.gone.map(goneRow).join('\n');
  const goneBlock =
    opts.gone.length > 0
      ? html`<details class="mt-8 text-muted">
          <summary class="py-2">${t('dashboard.gone.summary', { count: opts.gone.length })}</summary>
          <table class="data-table">
            <thead><tr><th>${t('dashboard.gone.colTitle')}</th><th>${t('dashboard.gone.colStatus')}</th><th>${t('dashboard.gone.colDetected')}</th></tr></thead>
            <tbody>${raw(goneRows)}</tbody>
          </table>
        </details>`
      : '';

  const syncLine = opts.syncedAt ? t('dashboard.meta.lastSync', { time: timeTag(opts.syncedAt) }) : escapeHtml(t('dashboard.meta.neverSynced'));

  const body = html`
    ${raw(
      pageHeader({
        title: t('dashboard.title'),
        badge: html`<span class="badge badge-neutral tabular-nums">${opts.summaries.length}</span>`,
        meta: html`${raw(syncLine)} · ${t('dashboard.meta.spend', { day: formatUsd(opts.cost.last24hUsd), total: formatUsd(opts.cost.totalUsd) })}${raw(quotaBlock ? ` · ${t('dashboard.meta.images', { quotas: quotaBlock })}` : '')} · <a href="/settings">${t('dashboard.meta.details')}</a>`,
        actions: html`<form method="post" action="/sync" data-busy="${t('dashboard.sync.busy')}">
            <button type="submit" class="btn btn-ghost" title="${t('dashboard.sync.title', { url: opts.ghostUrl, filter: opts.draftFilter })}">${t('dashboard.sync.button')}</button>
          </form>
          <a href="/posts/new" class="btn" data-shortcut="c" data-palette="${t('dashboard.newPost')}">${t('dashboard.newPost')}</a>`,
      }),
    )}
    ${raw(opts.nag2fa ?? '')}
    ${raw(autoPlanFlash(opts.autoPlan))}
    ${raw(opts.budget?.exceeded ? flash(t('server.budgetExceeded', { spent: formatUsd(opts.budget.spent), limit: formatUsd(opts.budget.limit) }), 'warn') : '')}
    ${raw(!opts.activeKind && !opts.noImage && !opts.mine && !q ? queueSection(opts.summaries, !!opts.queueDone) : '')}
    <h2 class="section-heading">${t('dashboard.allDrafts')}</h2>
    <div class="mb-4 flex flex-wrap items-center gap-4">
      <form method="get" action="/" class="w-full sm:w-auto">
        ${raw(hiddenKind)}
        ${raw(hiddenNoImage)}
        <input type="search" name="q" aria-label="${t('dashboard.search')}" class="w-full sm:w-64" placeholder="${t('dashboard.search')}" value="${opts.q ?? ''}" />
      </form>
      <nav class="flex flex-wrap items-center gap-2" aria-label="${t('dashboard.filterByStatus')}">${raw(chips)}</nav>
      <div class="flex flex-wrap items-center gap-2">${raw(mineChip)}${raw(noImageChip)}${filtered ? raw(html`<a class="chip-clear ml-1" href="/">${t('common.actions.clearFilters')}</a>`) : ''}</div>
    </div>
    <div class="grid gap-5 xl:grid-cols-[1fr_22rem]" data-peek-layout>
    <form method="post" action="/batch/plan" id="batch-form" data-batch-form class="min-w-0">
      <div class="overflow-x-auto">
        <table class="data-table">
          <thead>
            <tr>
              <th class="w-8"><input type="checkbox" class="select-all" title="${t('dashboard.selectAll')}" aria-label="${t('dashboard.selectAll')}" /></th>
              <th>${t('dashboard.cols.title')}</th><th>${t('dashboard.cols.status')}</th><th class="max-sm:hidden">${t('dashboard.cols.flags')}</th><th class="text-right">${t('dashboard.cols.words')}</th>
            </tr>
          </thead>
          <tbody>${raw(
            rows ||
              (opts.summaries.length === 0
                ? emptyRow(5, { title: t('dashboard.empty.none'), body: t('dashboard.empty.noneBody', { url: opts.ghostUrl }), action: { href: '/posts/new', label: t('dashboard.newPost') } })
                : emptyRow(5, { title: t('dashboard.empty.filtered'), action: { href: '/', label: t('common.actions.clearFilters') } }))
          )}</tbody>
        </table>
      </div>
      <p class="mt-3 text-sm text-muted">${t('dashboard.footer', { visible: visible.length, count: opts.summaries.length })}</p>
      <div class="card sticky bottom-0 mt-3 flex flex-wrap items-center gap-2.5 px-3.5 py-3 shadow-[0_-6px_20px_rgb(0_0_0/0.2)]" data-batch-bar hidden>
        <strong data-batch-count aria-live="polite"></strong>
        <select name="mode" title="${t('dashboard.batch.modeLabel')}" aria-label="${t('dashboard.batch.modeLabel')}">
          <option value="auto">${t('dashboard.batch.modeAuto')}</option>
          <option value="draft">${t('dashboard.batch.modeDraft')}</option>
          <option value="improve">${t('dashboard.batch.modeImprove')}</option>
        </select>
        <input type="text" name="instructions" aria-label="${t('dashboard.batch.instructionsLabel')}" class="min-w-32 flex-1" placeholder="${t('dashboard.batch.instructionsPlaceholder')}" />
        <div class="flex gap-2.5">
          <button type="submit" class="btn" data-busy="${t('dashboard.batch.planBusy')}">${t('dashboard.batch.plan')}</button>
          <button type="button" class="btn btn-ghost" data-open-dialog="batch-apply-dialog">${t('dashboard.batch.apply')}</button>
        </div>
      </div>
    </form>
    <aside class="card sticky top-4 hidden max-h-[calc(100vh-2rem)] self-start overflow-y-auto p-4 xl:block" data-peek aria-live="polite" aria-label="${t('dashboard.peek.label')}">
      <p class="text-sm text-muted" data-peek-empty>${raw(t('dashboard.peek.empty'))}</p>
    </aside>
    </div>

    ${raw(
      confirmDialog({
        id: 'batch-apply-dialog',
        title: t('dashboard.batch.dialogTitle'),
        body: t('dashboard.batch.dialogBody'),
        confirmLabel: t('dashboard.batch.dialogConfirm'),
        form: 'batch-form',
        formaction: '/batch/apply',
      }),
    )}
    ${raw(goneBlock)}
    <script src="/dashboard.js" defer></script>
  `;

  return layout({ title: t('dashboard.title'), bodyHtml: body, section: 'dashboard' });
}

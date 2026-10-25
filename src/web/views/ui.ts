import { currentLocale, t } from '../../i18n/index.js';
import { html, raw } from '../html.js';

/**
 * Pieces shared by all pages, so they look and behave the same:
 * header (back link + title + status + actions), notices, empty
 * states, dates and confirmation dialogs. References: Primer PageHeader,
 * Polaris Page/Banner/EmptyState, GOV.UK Back link.
 */

export interface BackLink {
  href: string;
  /** Name of the parent page ("Drafts", the post title...), never a bare "Back". */
  label: string;
}

export interface PageHeaderOpts {
  back?: BackLink;
  title: string;
  /** Status next to the title (already-escaped HTML, e.g. badge()). */
  badge?: string;
  /** Metadata line under the title (already-escaped HTML). */
  meta?: string;
  /** Actions on the right (already-escaped HTML): at most one primary (.btn). */
  actions?: string;
}

export function backLink(back: BackLink): string {
  return html`<a href="${back.href}" class="back-link"><span aria-hidden="true">&larr;</span> ${back.label}</a>`;
}

export function pageHeader(o: PageHeaderOpts): string {
  return html`<header class="page-header">
    ${o.back ? raw(backLink(o.back)) : ''}
    <div class="page-header-row">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 class="page-title">${o.title}</h1>
          ${o.badge ? raw(o.badge) : ''}
        </div>
        ${o.meta ? raw(html`<div class="page-meta">${raw(o.meta)}</div>`) : ''}
      </div>
      ${o.actions ? raw(html`<div class="page-actions">${raw(o.actions)}</div>`) : ''}
    </div>
  </header>`;
}

export type FlashTone = 'ok' | 'info' | 'warn' | 'err';

/** Notice after an action ("Saved", "Deleted 3 jobs"). Errors use the err tone and role=alert. */
export function flash(message: string, tone: FlashTone = 'ok'): string {
  const role = tone === 'err' ? 'alert' : 'status';
  return html`<div class="flash flash-${tone}" role="${role}">${message}</div>`;
}

/**
 * Empty list. Distinguishes "nothing yet" (explains and offers to create) from
 * "nothing with these filters" (offers to clear them).
 */
export function emptyState(o: { title: string; body?: string; action?: { href: string; label: string } }): string {
  return html`<div class="empty-state">
    <p class="font-medium text-fg">${o.title}</p>
    ${o.body ? raw(html`<p class="text-sm">${o.body}</p>`) : ''}
    ${o.action ? raw(html`<a class="btn btn-ghost btn-sm mt-2" href="${o.action.href}">${o.action.label}</a>`) : ''}
  </div>`;
}

export function emptyRow(colspan: number, o: Parameters<typeof emptyState>[0]): string {
  return html`<tr><td colspan="${colspan}">${raw(emptyState(o))}</td></tr>`;
}

export function absoluteDate(iso: string): string {
  return new Date(iso).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

/** "hace 5 min" / "5 min ago": Intl.RelativeTimeFormat already ships every language. */
export function relativeTime(iso: string, now = Date.now()): string {
  const locale = currentLocale();
  const diff = Math.round((now - Date.parse(iso)) / 1000);
  if (diff < 45) return t('common.time.justNow');
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (diff < 86_400) return rtf.format(-Math.round(diff / 3600), 'hour');
  if (diff < 7 * 86_400) return rtf.format(-Math.round(diff / 86_400), 'day');
  return new Date(iso).toLocaleDateString(locale, { dateStyle: 'medium' });
}

/** Time of a log line. */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(currentLocale());
}

/** Date on every page: relative in view and exact in the title (Primer RelativeTime). */
export function timeTag(iso: string): string {
  return html`<time datetime="${iso}" title="${absoluteDate(iso)}">${relativeTime(iso)}</time>`;
}


/** Filter chip: link with accessible current state and, if given, a counter. */
export function chip(label: string, href: string, active: boolean, count?: number): string {
  return html`<a class="chip${active ? ' chip-active' : ''}" href="${href}" ${active ? raw('aria-current="true"') : ''}>${label}${
    count !== undefined ? raw(html` <span class="chip-count">${count}</span>`) : ''
  }</a>`;
}

export interface ConfirmDialogOpts {
  id: string;
  /** Question that names the object: "Delete all finished jobs?". */
  title: string;
  body?: string;
  /** Repeats the verb of the button that opens it ("Delete history"), never "OK". */
  confirmLabel: string;
  danger?: boolean;
  /**
   * Either its own form (action), or submit an existing form on the
   * page (form + formaction), e.g. the dashboard batch actions.
   */
  action?: string;
  form?: string;
  formaction?: string;
  /** Extra hidden fields (already-escaped HTML). */
  fields?: string;
  busy?: string;
}

/** Modal confirmation <dialog>. Opened with a data-open-dialog="id" button (see ui.js). */
export function confirmDialog(o: ConfirmDialogOpts): string {
  const submit = html`<button type="submit" class="btn${o.danger ? ' btn-danger' : ''}" ${
    o.form ? raw(html`form="${o.form}" formaction="${o.formaction ?? ''}" name="confirmed" value="on"`) : ''
  }>${o.confirmLabel}</button>`;
  const inner = html`<h2 id="${o.id}-title" class="mb-2 text-lg font-semibold">${o.title}</h2>
    ${o.body ? raw(html`<p class="text-sm text-muted">${o.body}</p>`) : ''}
    ${raw(o.fields && !o.form ? html`<div class="mt-4">${raw(o.fields)}</div>` : '')}
    <div class="mt-4 flex justify-end gap-2">
      <button type="button" class="btn btn-ghost" data-close-dialog autofocus>${t('common.actions.cancel')}</button>
      ${raw(submit)}
    </div>`;
  return html`<dialog id="${o.id}" class="confirm-dialog" aria-labelledby="${o.id}-title">${raw(
    o.form
      ? html`<div>${raw(inner)}</div>`
      : html`<form method="post" action="${o.action ?? ''}" ${o.busy ? raw(html`data-busy="${o.busy}"`) : ''}>${raw(inner)}</form>`,
  )}</dialog>`;
}

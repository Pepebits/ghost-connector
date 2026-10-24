import type { SnippetPlan } from '../../orchestrator/snippet.js';
import { currentLocale, t } from '../../i18n/index.js';
import { html, raw } from '../html.js';
import { layout } from './layout.js';
import { confirmDialog, flash, pageHeader, timeTag } from './ui.js';

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const pct = (n: number) => `${(n * 100).toLocaleString(currentLocale(), { maximumFractionDigits: 1 })} %`;

function serp(url: string, title: string, description: string): string {
  let where = url;
  try {
    const u = new URL(url);
    where = `${u.host}${u.pathname.replace(/\/+$/, '').replace(/\//g, ' › ')}`;
  } catch {
    // keep the raw URL
  }
  return html`<div class="min-w-0 rounded-md border border-line bg-bg p-3">
    <p class="m-0 truncate text-xs text-muted">${where}</p>
    <p class="m-0 mt-0.5 text-base leading-snug text-accent [overflow-wrap:anywhere]">${cut(title, 60)}</p>
    <p class="m-0 mt-1 text-xs leading-relaxed text-muted">${description ? cut(description, 155) : t('post.share.noDescription')}</p>
  </div>`;
}

/** "Before → after" CTR for the query, or why there's nothing yet. */
export function followUpLine(plan: SnippetPlan): string {
  const before = t('snippet.follow.before', { ctr: pct(plan.ctr), position: plan.position.toFixed(1) });
  const f = plan.followUp;
  if (!f) return html`${before} · <span class="text-muted">${t('snippet.follow.pending')}</span>`;
  if (!f.impressions) return html`${before} · <span class="text-muted">${t('snippet.follow.noData', { from: f.from, to: f.to })}</span>`;
  const better = f.ctr > plan.ctr;
  return html`${before} → <strong class="${better ? 'text-ok' : 'text-warn'}">${t('snippet.follow.after', { ctr: pct(f.ctr), position: f.position.toFixed(1) })}</strong> <span class="text-xs text-muted">${t('snippet.follow.window', { from: f.from, to: f.to, impressions: f.impressions })}</span>`;
}

export function snippetPage(plan: SnippetPlan, opts: { result?: string } = {}): string {
  const current = plan.applied ?? plan.current;
  const shownTitle = current.meta_title || plan.title;
  const options = plan.options
    .map((o, i) => {
      const id = `snip-${i}`;
      return html`<li class="card flex min-w-0 flex-col gap-3 p-4">
        <p class="m-0 text-sm text-muted">${o.angle}</p>
        ${raw(serp(plan.url, o.meta_title, o.meta_description))}
        <form id="${id}" method="post" action="/ideas/snippet/${plan.postId}/apply" class="grid gap-2">
          <label class="text-sm font-medium">${t('post.edit.metaTitle')}
            <input type="text" name="meta_title" maxlength="70" value="${o.meta_title}" class="mt-1 block w-full" required>
          </label>
          <label class="text-sm font-medium">${t('post.edit.metaDescription')}
            <textarea name="meta_description" maxlength="200" rows="4" class="mt-1 block w-full" data-autogrow required>${o.meta_description}</textarea>
          </label>
        </form>
        <div class="mt-auto"><button type="button" class="btn btn-sm" data-open-dialog="${id}-confirm">${t('snippet.apply')}</button></div>
        ${raw(confirmDialog({ id: `${id}-confirm`, title: t('snippet.confirmTitle'), body: t('snippet.confirmBody', { title: plan.title }), confirmLabel: t('snippet.apply'), form: id, formaction: `/ideas/snippet/${plan.postId}/apply` }))}
      </li>`;
    })
    .join('');

  const results: Record<string, [string, 'ok' | 'err' | 'warn']> = {
    applied: [t('snippet.result.applied'), 'ok'],
    restored: [t('snippet.result.restored'), 'ok'],
    conflict: [t('snippet.result.conflict'), 'warn'],
    failed: [t('snippet.result.failed'), 'err'],
    unavailable: [t('snippet.result.unavailable'), 'warn'],
  };
  const r = opts.result ? results[opts.result] : undefined;

  const appliedBlock = plan.applied
    ? html`<div class="card mb-6 flex flex-wrap items-center justify-between gap-3 p-4">
        <div class="min-w-0 flex-1">
          <p class="m-0 text-sm">${raw(t('snippet.appliedAt', { time: timeTag(plan.applied.at) }))}${plan.applied.by ? ` ${t('auth.by', { name: plan.applied.by })}` : ''}</p>
          <p class="m-0 mt-1 text-sm">${raw(followUpLine(plan))}</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-open-dialog="snip-restore">${t('snippet.restore')}</button>
        ${raw(confirmDialog({ id: 'snip-restore', title: t('snippet.restoreTitle'), body: t('snippet.restoreBody'), confirmLabel: t('snippet.restore'), action: `/ideas/snippet/${plan.postId}/restore` }))}
      </div>`
    : '';

  const body = html`
    ${raw(pageHeader({ back: { href: '/ideas#ctr-title', label: t('ideas.title') }, title: plan.title, meta: t('snippet.meta', { query: plan.query, position: plan.position.toFixed(1), ctr: pct(plan.ctr) }) }))}
    ${raw(r ? flash(r[0], r[1]) : '')}
    ${raw(appliedBlock)}
    <section class="mb-6" aria-labelledby="snip-now">
      <h2 id="snip-now" class="section-heading">${plan.applied ? t('snippet.nowApplied') : t('snippet.now')}</h2>
      <div class="max-w-xl">${raw(serp(plan.url, shownTitle, current.meta_description))}</div>
    </section>
    <section class="mb-6" aria-labelledby="snip-options">
      <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="snip-options" class="section-heading !mb-1">${t('snippet.options')}</h2>
          <p class="!m-0 text-sm text-muted">${raw(t('snippet.optionsIntro', { time: timeTag(plan.at) }))}</p>
        </div>
        <form method="post" action="/ideas/snippet" data-busy="${t('snippet.busy')}">
          <input type="hidden" name="page" value="${plan.url}">
          <input type="hidden" name="query" value="${plan.query}">
          <input type="hidden" name="position" value="${String(plan.position)}">
          <input type="hidden" name="ctr" value="${String(plan.ctr)}">
          <button type="submit" class="btn btn-ghost btn-sm">${t('snippet.again')}</button>
        </form>
      </div>
      <ul class="m-0 grid list-none gap-4 p-0 lg:grid-cols-3">${raw(options)}</ul>
      <p class="mt-3 text-xs text-muted">${t('snippet.footnote')}</p>
    </section>`;
  return layout({ title: t('snippet.title'), bodyHtml: body, section: 'ideas' });
}

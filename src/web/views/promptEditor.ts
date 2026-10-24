import type { PromptName } from '../../agents/prompts.js';
import type { PromptRevisionRow, ReviewCategoryStats } from '../../db/repo.js';
import { describeCategory, MIN_CASES, promptSuggestions, REJECT_RATIO } from '../../review/learn.js';
import { escapeHtml, html, raw } from '../html.js';
import { t } from '../../i18n/index.js';
import { layout } from './layout.js';
import { confirmDialog, flash, pageHeader, timeTag } from './ui.js';

function revisionRow(name: PromptName, r: PromptRevisionRow): string {
  return html`
    <li class="flex flex-wrap items-center justify-between gap-2">
      <span>${raw(timeTag(r.saved_at))}${r.note ? ` — ${r.note}` : ''}</span>
      <button type="button" class="btn btn-ghost btn-sm" data-open-dialog="revert-${r.id}">${t('prompts.restore')}</button>
      ${raw(
        confirmDialog({
          id: `revert-${r.id}`,
          title: t('prompts.restoreTitle'),
          body: t('prompts.restoreBody'),
          confirmLabel: t('prompts.restoreConfirm'),
          action: `/settings/prompts/${name}/revert`,
          fields: html`<input type="hidden" name="revisionId" value="${r.id}" />`,
        }),
      )}
    </li>`;
}

export interface PromptEditorOpts {
  name: PromptName;
  content: string;
  revisions: PromptRevisionRow[];
  appended: boolean;
  /** Notice after saving, reverting to factory or restoring. */
  notice?: 'saved' | 'reset' | 'reverted';
  /** true if there's an edited version; false if the factory one is used. */
  customized: boolean;
  /** Where the edited version is stored (to explain it on the page). */
  overridePath: string;
  /** Only for writer.system: what is accepted/rejected in block review. */
  reviewStats: ReviewCategoryStats[];
}

function learningSection(name: PromptName, stats: ReviewCategoryStats[]): string {
  if (name !== 'writer.system') return '';
  if (stats.length === 0) {
    return html`<section class="mb-8"><h2 class="section-heading">${t('prompts.learning.title')}</h2>
      <p class="text-muted">${t('prompts.learning.empty')}</p></section>`;
  }
  const suggestions = promptSuggestions(stats);
  const suggestionCards = suggestions
    .map(
      (s) => html`<div class="issue issue-info">
        <div><strong>${t('prompts.learning.rejects', { pct: Math.round((s.rejected / s.total) * 100), description: s.description })}</strong> ${t('prompts.learning.ofTotal', { rejected: s.rejected, total: s.total })}</div>
        <div class="mt-1">${t('prompts.learning.rule')} <em>${s.rule}</em></div>
        <div class="issue-action"><a href="/settings/prompts/${name}?append=${encodeURIComponent(s.rule)}">${t('prompts.learning.append')}</a></div>
      </div>`,
    )
    .join('');
  const rows = stats
    .map((s) => html`<tr><td>${describeCategory(s.category)}</td><td class="text-right tabular-nums">${s.total}</td><td class="text-right tabular-nums">${Math.round((s.rejected / s.total) * 100)}%</td></tr>`)
    .join('');
  return html`<section class="mb-8">
    <h2 class="section-heading">${t('prompts.learning.title')}</h2>
    ${raw(suggestionCards || html`<p class="text-muted">${t('prompts.learning.none', { min: MIN_CASES, ratio: Math.round(REJECT_RATIO * 100) })}</p>`)}
    <details class="mt-3"><summary class="text-sm text-muted">${t('prompts.learning.details')}</summary>
      <table class="data-table mt-2"><thead><tr><th>${t('prompts.learning.kind')}</th><th class="text-right">${t('prompts.learning.cases')}</th><th class="text-right">${t('prompts.learning.rejection')}</th></tr></thead><tbody>${raw(rows)}</tbody></table>
    </details>
  </section>`;
}

export function promptEditorPage(opts: PromptEditorOpts): string {
  const { name, content, revisions, appended, reviewStats, customized } = opts;

  const appendedNote = appended
    ? flash(t('prompts.appended'), 'info')
    : '';
  const notice = opts.notice ? flash(t(`prompts.notices.${opts.notice}`)) : '';

  const revisionsBlock =
    revisions.length > 0
      ? html`<ul class="[&_li]:border-b [&_li]:border-line [&_li]:py-2 [&_li]:text-sm [&_li]:text-muted">${raw(revisions.map((r) => revisionRow(name, r)).join(''))}</ul>`
      : html`<p class="text-muted">${t('prompts.noRevisions')}</p>`;

  const body = html`
    ${raw(
      pageHeader({
        back: { href: '/settings', label: t('settings.title') },
        title: t('prompts.edit', { name }),
        badge: html`<span class="badge ${customized ? 'badge-info' : 'badge-neutral'}">${customized ? t('prompts.customized') : t('prompts.factory')}</span>`,
        meta: customized
          ? t('prompts.metaCustomized', { path: escapeHtml(opts.overridePath) })
          : escapeHtml(t('prompts.metaFactory')),
      }),
    )}
    ${raw(notice)}
    <div class="issue issue-warning">
      <div class="issue-message">${t('prompts.warning')}</div>
    </div>
    ${raw(appendedNote)}

    <form method="post" action="/settings/prompts/${name}" data-guard>
      <textarea name="content" aria-label="${t('prompts.contentLabel', { name })}" class="mb-3 block min-h-[60vh] w-full whitespace-pre font-mono text-[0.85rem]">${content}</textarea>
      <div class="flex flex-wrap items-center gap-2">
        <button type="submit" class="btn">${t('prompts.save')}</button>
        ${customized ? raw(html`<button type="button" class="btn btn-ghost" data-open-dialog="reset-prompt">${t('prompts.reset')}</button>`) : ''}
        <span class="text-sm text-muted">${t('prompts.historyNote')}</span>
      </div>
    </form>
    ${customized
      ? raw(
          confirmDialog({
            id: 'reset-prompt',
            title: t('prompts.resetTitle'),
            body: t('prompts.resetBody'),
            confirmLabel: t('prompts.resetConfirm'),
            action: `/settings/prompts/${name}/reset`,
          }),
        )
      : ''}

    ${raw(learningSection(name, reviewStats))}

    <section class="mb-8">
      <h2 class="section-heading">${t('prompts.history')}</h2>
      ${raw(revisionsBlock)}
    </section>
  `;

  return layout({ title: t('prompts.editTitle', { name }), bodyHtml: body, section: 'settings' });
}

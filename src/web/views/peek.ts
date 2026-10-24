import type { PostSummary } from '../../state/postState.js';
import type { RunArtifact } from '../../types.js';
import { extractPendingQuestions } from '../../util/pending.js';
import { html, raw } from '../html.js';
import { badge } from './badge.js';
import { qualityPanelFor } from './quality.js';
import { t } from '../../i18n/index.js';

/** Dashboard side panel: just enough to decide without opening the post. Local data only (index + latest plan). */
export function peekPanel(summary: PostSummary, plan: RunArtifact | null): string {
  const current = plan && plan.status === 'planned' && plan.writer ? plan : null;
  const id = encodeURIComponent(summary.id);

  const changes = current?.writer?.changes_made.length
    ? html`<h3>${t('dashboard.peek.changes')}</h3>
        <ul class="list-disc pl-5 text-sm [&_li]:my-1">${raw(current.writer.changes_made.slice(0, 5).map((c) => html`<li>${c}</li>`).join(''))}</ul>
        ${current.writer.changes_made.length > 5 ? raw(html`<p class="text-xs text-muted">${t('dashboard.peek.moreChanges', { count: current.writer.changes_made.length - 5 })}</p>`) : ''}`
    : '';
  const pending = current ? extractPendingQuestions(current.writer!.markdown) : [];
  const pendingBlock = pending.length
    ? html`<div class="issue issue-warning mt-3 text-sm"><strong>${t('dashboard.peek.pending', { count: pending.length })}:</strong>
        <ul class="list-disc pl-5">${raw(pending.map((q) => html`<li>${q}</li>`).join(''))}</ul></div>`
    : '';
  const issues = summary.issues.length
    ? html`<div class="mt-3">${raw(summary.issues.map((i) => html`<div class="issue issue-${i.severity} text-sm">${i.message}</div>`).join(''))}</div>`
    : '';
  const actions = current
    ? html`<a class="btn" href="/posts/${id}#revisar">${t('dashboard.peek.reviewChanges')}</a>
        <form method="post" action="/posts/${id}/apply/precheck" class="inline" data-busy="${t('dashboard.peek.checking')}"><button type="submit" class="btn btn-ghost">${t('dashboard.peek.reviewApply')}</button></form>`
    : html`<a class="btn" href="/posts/${id}#planificar">${t('dashboard.peek.plan')}</a>`;

  return html`
    <div class="flex items-start justify-between gap-2">
      <h2 class="section-heading !mb-0 text-lg">${summary.title}</h2>
      <button type="button" class="btn btn-ghost btn-sm" data-peek-close>${t('common.actions.close')}</button>
    </div>
    <p class="text-sm text-muted">${raw(badge(summary.kind))} · ${t('dashboard.peek.words', { count: summary.wordCount })}${current ? ` · ${t('dashboard.peek.planWords', { count: current.writer!.markdown.split(/\s+/).filter(Boolean).length })}` : ''}</p>
    <div class="my-3 flex flex-wrap gap-2">${raw(actions)}<a class="btn btn-ghost" href="/posts/${id}">${t('dashboard.peek.open')}</a></div>
    ${raw(issues)}
    ${raw(pendingBlock)}
    ${raw(current ? `<div class="mt-3">${qualityPanelFor(current)}</div>` : '')}
    ${raw(changes)}`;
}

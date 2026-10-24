import type { PreviewResolveResult } from '../../orchestrator/resolveFlow.js';
import { t } from '../../i18n/index.js';
import { html, raw } from '../html.js';
import { layout } from './layout.js';
import { pageHeader } from './ui.js';

export function resolvePreviewPage(opts: { postId: string; preview: PreviewResolveResult }): string {
  const { postId, preview } = opts;

  const changesList =
    preview.changesMade.length > 0
      ? html`<ul class="list-disc pl-6 [&_li]:my-1">${raw(preview.changesMade.map((c) => html`<li>${c}</li>`).join(''))}</ul>`
      : html`<p class="text-muted">${t('resolve.noChanges')}</p>`;

  const unresolvedNote =
    preview.unresolved.length > 0
      ? html`<div class="issue issue-info"><div class="issue-message">${t('resolve.unresolved', { count: preview.unresolved.length })}</div></div>`
      : '';

  const body = html`
    ${raw(pageHeader({ back: { href: `/posts/${postId}`, label: preview.title }, title: t('resolve.title'), meta: t('resolve.meta') }))}

    <section class="mb-8">
      <h2 class="section-heading">${t('resolve.changes')}</h2>
      ${raw(changesList)}
      ${raw(unresolvedNote)}
    </section>

    <section class="mb-8">
      <h2 class="section-heading">${t('resolve.markdown')}</h2>
      <pre class="card max-h-[70vh] overflow-y-auto whitespace-pre-wrap break-words p-4 text-[0.85rem]">${preview.markdown}</pre>
    </section>

    <form method="post" action="/posts/${postId}/resolve/commit" data-busy="${t('resolve.busy')}" class="flex flex-wrap items-center gap-3">
      <button type="submit" class="btn">${t('resolve.submit')}</button>
      <a href="/posts/${postId}" class="btn btn-ghost">${t('common.actions.cancel')}</a>
    </form>
  `;

  return layout({ title: t('resolve.title'), bodyHtml: body, section: 'dashboard' });
}

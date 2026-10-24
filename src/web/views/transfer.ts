import { t } from '../../i18n/index.js';
import type { ImportPart, ImportPreview } from '../../settings/workspace.js';
import { html, raw } from '../html.js';
import { layout } from './layout.js';
import { absoluteDate, flash, pageHeader } from './ui.js';

function part(id: ImportPart, has: boolean, body: string): string {
  return html`<label class="card flex items-start gap-3 p-4 ${has ? '' : 'opacity-60'}">
    <input type="checkbox" name="parts" value="${id}" class="mt-1" ${has ? raw('checked') : raw('disabled')}>
    <span class="min-w-0"><span class="block font-medium">${t(`settings.transfer.preview.parts.${id}.title`)}</span>
    <span class="block text-sm text-muted">${raw(has ? body : t('settings.transfer.preview.nothing'))}</span></span>
  </label>`;
}

export function importPreviewPage(p: ImportPreview): string {
  const P = 'settings.transfer.preview.parts';
  const settingsList = p.settings.length
    ? html`<ul class="mt-1 mb-0 pl-4">${raw(p.settings.map((s) => html`<li><code>${s.key}</code>: ${s.from || '—'} → ${s.to || '—'}</li>`).join(''))}</ul>`
    : '';
  const any = p.plans.newRuns + p.plans.newImages + p.prompts.length + p.settings.length + p.team.notes + p.team.assignments + p.ideas.history + p.ideas.snippets + p.learning > 0;
  const parts = [
    part('plans', p.plans.newRuns + p.plans.newImages > 0, html`${t(`${P}.plans.body`, p.plans)}`),
    part('prompts', p.prompts.length > 0, html`${t(`${P}.prompts.body`, { list: p.prompts.join(', ') })}`),
    part('settings', p.settings.length > 0, html`${t(`${P}.settings.body`, { count: p.settings.length })}${raw(settingsList)}`),
    part('team', p.team.notes + p.team.assignments > 0, html`${t(`${P}.team.body`, p.team)}${p.team.skippedAssignments ? ` ${t(`${P}.team.skipped`, { count: p.team.skippedAssignments })}` : ''}`),
    part('ideas', p.ideas.history + p.ideas.snippets > 0, html`${t(`${P}.ideas.body`, p.ideas)}`),
    part('learning', p.learning > 0, html`${t(`${P}.learning.body`, { count: p.learning })}`),
  ].join('');
  const by = p.manifest.exportedBy ? t('settings.transfer.preview.by', { name: p.manifest.exportedBy }) : '';
  const body = html`
    ${raw(pageHeader({ back: { href: '/settings#s-transfer', label: t('settings.title') }, title: t('settings.transfer.preview.title'), meta: t('settings.transfer.preview.meta', { site: p.manifest.site, time: absoluteDate(p.manifest.exportedAt), by }) }))}
    ${raw(any ? '' : flash(t('settings.transfer.preview.allHere'), 'info'))}
    ${raw(p.otherSite ? flash(t('settings.transfer.preview.otherSite', { site: p.manifest.site }), 'warn') : '')}
    <form method="post" action="/settings/import/${p.id}" class="grid max-w-3xl gap-3" data-busy="${t('settings.transfer.preview.applying')}">
      ${raw(parts)}
      <div class="mt-2 flex flex-wrap gap-2">
        ${any ? raw(html`<button type="submit" class="btn">${t('settings.transfer.preview.apply')}</button>`) : ''}
        <a class="btn btn-ghost" href="/settings#s-transfer">${t('settings.transfer.preview.cancel')}</a>
      </div>
    </form>`;
  return layout({ title: t('settings.transfer.preview.title'), bodyHtml: body, section: 'settings' });
}

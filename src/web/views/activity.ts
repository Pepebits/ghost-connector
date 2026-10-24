import { t } from '../../i18n/index.js';
import type { ActivityRow } from '../../team/store.js';
import { html, raw } from '../html.js';
import { layout } from './layout.js';
import { emptyState, pageHeader, timeTag } from './ui.js';

function describe(r: ActivityRow): string {
  const action = r.action;
  const vars = { target: r.target ?? '', detail: r.detail === '2fa' || r.detail === 'recovery' ? '' : (r.detail ?? '') };
  if (r.action === 'userInvited' || r.action === 'userJoined' || r.action === 'userRole') vars.detail = r.detail ? t(`auth.roles.${r.detail}`) : '';
  const key = `activity.actions.${action}`;
  const text = t(key, vars);
  return text === key ? action : text;
}

const who = (r: ActivityRow) => (r.actor ? html`<span class="font-medium">${r.actor}</span>` : html`<span class="text-muted">${t('activity.system')}</span>`);
const tone = (r: ActivityRow) => (r.action === 'loginFailed' ? 'text-warn' : r.action === 'userDeleted' || r.action === 'twoFactorOff' || r.action === 'userTwoFactorReset' ? 'text-err' : '');

/** Compact list for the Settings section. */
export function activitySection(rows: ActivityRow[]): string {
  const items = rows
    .map((r) => html`<li class="flex flex-wrap items-baseline gap-x-2 border-b border-line py-1.5 text-sm last:border-b-0">${raw(who(r))} <span class="${tone(r)}">${describe(r)}</span> <span class="text-xs text-muted">${raw(timeTag(r.at))}</span></li>`)
    .join('');
  return html`<section class="card settings-section min-w-0" id="s-activity" aria-labelledby="s-activity-h">
    <h2 id="s-activity-h" class="section-heading !mb-1">${t('activity.title')}</h2>
    <p class="!mt-0 text-sm text-muted">${t('activity.intro')}</p>
    ${raw(rows.length ? html`<ul class="m-0 list-none p-0">${raw(items)}</ul>` : html`<p class="text-sm text-muted">${t('activity.empty')}</p>`)}
    <p class="!mb-0 mt-3"><a href="/settings/activity">${t('activity.all')}</a></p>
  </section>`;
}

export function activityPage(o: { rows: ActivityRow[]; actors: string[]; actor?: string; nextBefore?: number }): string {
  const options = [html`<option value="">${t('activity.everyone')}</option>`, ...o.actors.map((a) => html`<option value="${a}" ${a === o.actor ? raw('selected') : ''}>${a}</option>`)].join('');
  const rows = o.rows
    .map((r) => html`<tr><td class="whitespace-nowrap text-muted">${raw(timeTag(r.at))}</td><td>${raw(who(r))}</td><td class="${tone(r)}">${describe(r)}</td></tr>`)
    .join('');
  const more = o.nextBefore ? html`<p class="mt-4"><a class="btn btn-ghost btn-sm" href="/settings/activity?${new URLSearchParams({ ...(o.actor ? { actor: o.actor } : {}), before: String(o.nextBefore) }).toString()}">${t('activity.more')}</a></p>` : '';
  const body = html`
    ${raw(pageHeader({ back: { href: '/settings#s-activity', label: t('settings.title') }, title: t('activity.title'), meta: t('activity.intro') }))}
    <form method="get" action="/settings/activity" class="mb-4">
      <label for="act-actor" class="block text-sm font-medium">${t('activity.filter')}</label>
      <div class="mt-1 flex flex-wrap items-stretch gap-2"><select id="act-actor" name="actor">${raw(options)}</select><button type="submit" class="btn btn-ghost">${t('activity.apply')}</button></div>
    </form>
    ${raw(
      o.rows.length
        ? html`<div class="overflow-x-auto"><table class="data-table"><thead><tr><th scope="col">${t('activity.when')}</th><th scope="col">${t('activity.who')}</th><th scope="col">${t('activity.what')}</th></tr></thead><tbody>${raw(rows)}</tbody></table></div>`
        : emptyState({ title: t('activity.empty') }),
    )}
    ${raw(more)}`;
  return layout({ title: t('activity.title'), bodyHtml: body, section: 'settings' });
}

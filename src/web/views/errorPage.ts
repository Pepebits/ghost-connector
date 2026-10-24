import { t } from '../../i18n/index.js';
import { html, raw } from '../html.js';
import { layout } from './layout.js';
import { flash, pageHeader, type BackLink } from './ui.js';

const TITLED = new Set([400, 404, 409, 422, 502]);
const title = (status: number, fallback: string) => t(`errors.title.${TITLED.has(status) ? status : fallback}`);

/** Error page with the UI navigation and a link back to where you were. */
export function errorPage(o: { status: number; message: string; back: BackLink }): string {
  const body = html`${raw(pageHeader({ back: o.back, title: title(o.status, 'default') }))}
    ${raw(flash(o.message || t('errors.unexpected'), o.status >= 500 ? 'err' : 'warn'))}
    <p class="text-sm text-muted">${t('errors.nothingWritten')} <a href="${o.back.href}">${t('errors.goBack')}</a> ${t('errors.tryAgain')}</p>`;
  return layout({ title: title(o.status, 'short'), bodyHtml: body });
}

/** Go back to the page the form came from, only if it's on this server. */
export function sameOriginBack(referer: string | undefined, origins: Set<string>): BackLink {
  try {
    const u = new URL(referer ?? '');
    if (origins.has(u.origin)) {
      const path = u.pathname + u.search;
      return { href: path + u.hash, label: path.startsWith('/posts/') ? t('errors.back.post') : path.startsWith('/settings') ? t('common.nav.settings') : path.startsWith('/jobs') ? t('common.nav.jobs') : t('common.nav.dashboard') };
    }
  } catch {
    /* no valid referer */
  }
  return { href: '/', label: t('common.nav.dashboard') };
}

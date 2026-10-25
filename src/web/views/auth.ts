import { authorNames, authorPicker } from './authors.js';
import type { StaffMember } from '../../ghost/staff.js';
import type { AuthUser, Invite, Role, SessionInfo, UserListItem } from '../../auth/store.js';
import type { ActivityRow } from '../../team/store.js';
import { describe } from './activity.js';
import { t } from '../../i18n/index.js';
import { html, raw } from '../html.js';
import { layout } from './layout.js';
import { absoluteDate, confirmDialog, flash, pageHeader, timeTag } from './ui.js';

function card(title: string, intro: string, inner: string, error?: string): string {
  return html`<div class="pt-6 sm:pt-12">
    <h1 class="mb-1 text-2xl font-semibold">${title}</h1>
    <p class="mb-5 text-sm text-muted">${intro}</p>
    ${raw(error ? flash(error, 'err') : '')}
    <div class="card p-5">${raw(inner)}</div>
  </div>`;
}

const field = (o: { id: string; name: string; label: string; type?: string; autocomplete: string; hint?: string; extra?: string; value?: string }) =>
  html`<div>
    <label for="${o.id}" class="block font-medium">${o.label}</label>
    ${o.hint ? raw(html`<p id="${o.id}-hint" class="mt-0.5 text-sm text-muted">${o.hint}</p>`) : ''}
    <input id="${o.id}" name="${o.name}" type="${o.type ?? 'password'}" autocomplete="${o.autocomplete}" required class="mt-2 block w-full" ${o.value !== undefined ? raw(html`value="${o.value}"`) : ''} ${o.hint ? raw(`aria-describedby="${o.id}-hint"`) : ''} ${raw(o.extra ?? '')}>
  </div>`;

const usernameField = (value?: string, extra = 'autofocus') =>
  field({ id: 'username', name: 'username', label: t('auth.username'), type: 'text', autocomplete: 'username', value, extra: `${extra} maxlength="64" autocapitalize="none" spellcheck="false"` });

const newPasswordFields = (min: number, autofocus = false) =>
  field({ id: 'pw-new', name: 'password', label: t('auth.newPassword'), autocomplete: 'new-password', hint: t('auth.passwordHint', { min }), extra: `minlength="${min}"${autofocus ? ' autofocus' : ''}` }) +
  field({ id: 'pw-repeat', name: 'repeat', label: t('auth.repeatPassword'), autocomplete: 'new-password', extra: `minlength="${min}"` });

export const roleBadge = (role: Role) => html`<span class="badge ${role === 'owner' ? 'badge-ok' : role === 'admin' ? 'badge-info' : 'badge-neutral'}">${t(`auth.roles.${role}`)}</span>`;

const GEAR = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`;

/** Who may manage whom: the owner, everyone but themself; an admin, only editors; an editor, nobody. */
export const canManage = (me: AuthUser, target: { id: number; role: Role }) =>
  (me.role === 'owner' || me.role === 'admin') && target.id !== me.id && target.role !== 'owner' && (me.role === 'owner' || target.role === 'editor');

export function loginPage(o: { next?: string; username?: string; error?: string; notice?: string }): string {
  const inner = html`<form method="post" action="/login" class="grid gap-4" data-busy="${t('auth.login.busy')}">
    <input type="hidden" name="next" value="${o.next ?? '/'}">
    ${raw(usernameField(o.username, o.username ? '' : 'autofocus'))}
    ${raw(field({ id: 'pw', name: 'password', label: t('auth.password'), autocomplete: 'current-password', extra: o.username ? 'autofocus' : '' }))}
    <div><button type="submit" class="btn">${t('auth.login.submit')}</button></div>
  </form>
  <p class="!mb-0 mt-4 text-xs text-muted">${t('auth.login.forgot')}</p>`;
  return layout({ title: t('auth.login.title'), bare: true, bodyHtml: card(t('auth.login.title'), t('auth.login.intro'), (o.notice ? flash(o.notice) : '') + inner, o.error) });
}

export function twoFactorPage(o: { error?: string }): string {
  const inner = html`<form method="post" action="/login/2fa" class="grid gap-4">
    ${raw(field({ id: 'code', name: 'code', label: t('auth.code'), type: 'text', autocomplete: 'one-time-code', hint: t('auth.twoFactor.hint'), extra: 'inputmode="text" autofocus maxlength="11" spellcheck="false"' }))}
    <div class="flex flex-wrap items-center gap-3"><button type="submit" class="btn">${t('auth.twoFactor.submit')}</button><a href="/login" class="text-sm">${t('auth.twoFactor.back')}</a></div>
  </form>`;
  return layout({ title: t('auth.twoFactor.title'), bare: true, bodyHtml: card(t('auth.twoFactor.title'), t('auth.twoFactor.intro'), inner, o.error) });
}

/** First start: whoever gets here first creates the admin. */
export function setupPage(o: { min: number; username?: string; error?: string }): string {
  const inner = html`<form method="post" action="/setup-password" class="grid gap-4">
    ${raw(usernameField(o.username ?? 'admin'))}
    ${raw(newPasswordFields(o.min))}
    <div><button type="submit" class="btn">${t('auth.setup.submit')}</button></div>
  </form>`;
  return layout({ title: t('auth.setup.title'), bare: true, bodyHtml: card(t('auth.setup.title'), t('auth.setup.intro'), inner, o.error) });
}

/** An invite (choose a username and password) or a password reset. */
export function invitePage(o: { token: string; invite: Invite; min: number; username?: string; error?: string }): string {
  const reset = o.invite.userId !== null;
  const inner = html`<form method="post" action="/invite/${o.token}" class="grid gap-4">
    ${raw(reset ? html`<p class="m-0 text-sm">${t('auth.username')}: <strong>${o.invite.username ?? ''}</strong></p>` : usernameField(o.username))}
    ${raw(newPasswordFields(o.min, reset))}
    <div><button type="submit" class="btn">${t(reset ? 'auth.invite.resetSubmit' : 'auth.invite.submit')}</button></div>
  </form>`;
  const title = reset ? t('auth.invite.resetTitle') : t('auth.invite.title');
  const intro = reset ? t('auth.invite.resetIntro') : t('auth.invite.intro', { role: t(`auth.roles.${o.invite.role}`), by: o.invite.createdBy ?? '—' });
  return layout({ title, bare: true, bodyHtml: card(title, intro, inner, o.error) });
}

export function inviteGonePage(): string {
  return layout({ title: t('auth.invite.goneTitle'), bare: true, bodyHtml: card(t('auth.invite.goneTitle'), t('auth.invite.gone'), html`<a class="btn" href="/login">${t('auth.login.submit')}</a>`) });
}

/** Shown once to the admin who created the link. */
export function inviteLinkPage(o: { url: string; invite: { role: Role; username?: string }; days: number }): string {
  const body = html`
    ${raw(pageHeader({ back: { href: '/settings#s-users', label: t('settings.title') }, title: o.invite.username ? t('auth.users.resetLinkTitle', { name: o.invite.username }) : t('auth.users.inviteLinkTitle', { role: t(`auth.roles.${o.invite.role}`) }) }))}
    ${raw(flash(t('auth.users.linkOnce', { days: o.days }), 'warn'))}
    <div class="card max-w-2xl p-4">
      <label for="invite-url" class="block text-sm font-medium">${t('auth.users.link')}</label>
      <input id="invite-url" type="text" readonly value="${o.url}" class="mt-2 block w-full font-mono text-sm" data-select-on-focus>
      <p class="!mb-0 mt-2 text-xs text-muted">${t('auth.users.linkHelp')}</p>
    </div>
    <p class="mt-4"><a class="btn" href="/settings#s-users">${t('auth.recovery.done')}</a></p>`;
  return layout({ title: t('auth.users.link'), bodyHtml: body, section: 'settings' });
}

// ---------- My account ----------

const ACCOUNT_NOTICES: Record<string, 'ok' | 'warn' | 'err'> = {
  authorsSaved: 'ok',
  passwordChanged: 'ok',
  revoked: 'ok',
  sessionRevoked: 'ok',
  disabled: 'warn',
  recoveryUsed: 'warn',
  badPassword: 'err',
  weakPassword: 'err',
  badCode: 'err',
};

/** "Chrome · macOS" from a User-Agent; good enough to recognise your own devices. */
export function deviceLabel(ua: string): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl|wget|node|python/i.test(ua) ? t('auth.account.script') : null;
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : null;
  return [browser, os].filter(Boolean).join(' · ') || t('auth.account.unknownDevice');
}

export interface AccountView {
  user: AuthUser;
  createdAt: string | null;
  previousLogin: string | null;
  totp: boolean;
  recoveryLeft: number;
  sessions: SessionInfo[];
  currentSession: string;
  activity: ActivityRow[];
  min: number;
  notice?: string;
  /** Ghost staff and this user's default authors (empty staff: the card is hidden). */
  staff?: StaffMember[];
  authors?: string[];
}

function authorsCard(o: AccountView): string {
  if (!o.staff?.length) return '';
  return html`<section class="card p-5" aria-labelledby="acc-authors-h">
    <h2 id="acc-authors-h" class="section-heading !mb-1">${t('authors.legend')}</h2>
    <form method="post" action="/account/authors" class="grid gap-3">
      ${raw(authorPicker({ id: 'acc-authors', staff: o.staff, selected: o.authors ?? [], legend: t('authors.mine'), hint: t('authors.defaultHint') }))}
      <div><button type="submit" class="btn btn-sm">${t('authors.save')}</button></div>
    </form>
  </section>`;
}

const MAX_SESSIONS_SHOWN = 8;

function twoFactorCard(o: AccountView): string {
  const status = o.totp
    ? html`<div class="flex items-start gap-3">
        <span class="badge badge-ok mt-0.5">${t('auth.security.on')}</span>
        <p class="m-0 text-sm">${t('auth.account.totpOn')} <span class="${o.recoveryLeft <= 3 ? 'font-medium text-warn' : 'text-muted'}">${t('auth.security.recoveryLeft', { count: o.recoveryLeft })}</span></p>
      </div>
      <form method="post" class="mt-5 grid gap-3 border-t border-line pt-4">
        <div>
          <label for="sec-code" class="block text-sm font-medium">${t('auth.code')}</label>
          <p id="sec-code-hint" class="mt-0.5 text-sm text-muted">${t('auth.security.codeToManage')}</p>
          <input id="sec-code" name="code" type="text" autocomplete="one-time-code" required maxlength="11" spellcheck="false" aria-describedby="sec-code-hint" class="mt-2 block w-full max-w-xs">
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="submit" formaction="/account/2fa/recovery" class="btn btn-ghost">${t('auth.security.newRecovery')}</button>
          <button type="submit" formaction="/account/2fa/disable" class="btn btn-ghost text-err">${t('auth.security.disable')}</button>
        </div>
      </form>`
    : html`<div class="flex items-start gap-3">
        <span class="badge badge-warn mt-0.5">${t('auth.security.off')}</span>
        <p class="m-0 text-sm">${t('auth.security.offBody')}</p>
      </div>
      <p class="!mb-0 mt-4"><a class="btn" href="/account/2fa">${t('auth.security.enable')}</a></p>`;
  return html`<section class="card settings-section" id="s-2fa" aria-labelledby="s-2fa-h">
    <h2 id="s-2fa-h" class="section-heading !mb-3">${t('auth.security.twoFactor')}</h2>
    ${raw(status)}
  </section>`;
}

function passwordCard(o: AccountView): string {
  return html`<section class="card settings-section" id="s-password" aria-labelledby="s-password-h">
    <h2 id="s-password-h" class="section-heading !mb-1">${t('auth.security.changePassword')}</h2>
    <p class="!mt-0 text-sm text-muted">${t('auth.account.passwordIntro')}</p>
    <form method="post" action="/account/password" class="grid gap-3">
      <input type="text" name="username" value="${o.user.username}" autocomplete="username" hidden>
      ${raw(field({ id: 'sec-cur', name: 'current', label: t('auth.currentPassword'), autocomplete: 'current-password' }))}
      ${raw(field({ id: 'sec-new', name: 'password', label: t('auth.newPassword'), autocomplete: 'new-password', hint: t('auth.passwordHint', { min: o.min }), extra: `minlength="${o.min}"` }))}
      ${raw(field({ id: 'sec-rep', name: 'repeat', label: t('auth.repeatPassword'), autocomplete: 'new-password', extra: `minlength="${o.min}"` }))}
      <div><button type="submit" class="btn">${t('auth.security.changePassword')}</button></div>
    </form>
  </section>`;
}

function sessionsCard(o: AccountView): string {
  const shown = o.sessions.slice(0, MAX_SESSIONS_SHOWN);
  const others = o.sessions.filter((s) => s.id !== o.currentSession).length;
  const items = shown
    .map((s) => {
      const current = s.id === o.currentSession;
      return html`<li class="flex items-center justify-between gap-3 border-b border-line py-3 last:border-b-0">
        <div class="min-w-0">
          <p class="m-0 flex flex-wrap items-center gap-2 text-sm font-medium">${deviceLabel(s.userAgent)}${current ? raw(html`<span class="badge badge-info">${t('auth.account.thisDevice')}</span>`) : ''}</p>
          <p class="m-0 text-xs text-muted">${raw(t('auth.account.sessionTimes', { seen: timeTag(s.lastSeen), since: timeTag(s.createdAt) }))}</p>
        </div>
        ${current ? '' : raw(html`<form method="post" action="/account/sessions/${s.id}/revoke" class="m-0 shrink-0"><button type="submit" class="btn btn-ghost btn-sm" aria-label="${t('auth.account.closeSessionOf', { device: deviceLabel(s.userAgent) })}">${t('auth.account.closeSession')}</button></form>`)}
      </li>`;
    })
    .join('');
  const more = o.sessions.length > shown.length ? html`<p class="!mb-0 mt-2 text-xs text-muted">${t('auth.account.moreSessions', { count: o.sessions.length - shown.length })}</p>` : '';
  return html`<section class="card settings-section" id="s-sessions" aria-labelledby="s-sessions-h">
    <div class="mb-1 flex flex-wrap items-center justify-between gap-2">
      <h2 id="s-sessions-h" class="section-heading !mb-0">${t('auth.security.sessions')} <span class="badge badge-neutral tabular-nums">${o.sessions.length}</span></h2>
      ${others ? raw(html`<form method="post" action="/account/sessions/revoke" class="m-0"><button type="submit" class="btn btn-ghost btn-sm">${t('auth.security.revokeOthers')}</button></form>`) : ''}
    </div>
    <p class="!mt-0 text-sm text-muted">${t('auth.account.sessionsIntro')}</p>
    <ul class="m-0 list-none p-0">${raw(items)}</ul>
    ${raw(more)}
  </section>`;
}

function activityCard(o: AccountView): string {
  // Consecutive identical entries (eight logins in a row) become one line with a count.
  const groups: Array<{ row: ActivityRow; count: number }> = [];
  for (const r of o.activity) {
    const last = groups.at(-1);
    if (last && last.row.action === r.action && last.row.target === r.target && last.row.detail === r.detail) last.count++;
    else groups.push({ row: r, count: 1 });
  }
  const items = groups
    .map(({ row: r, count }) => html`<li class="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-line py-2 text-sm last:border-b-0">
        <span class="${r.action === 'loginFailed' ? 'text-warn' : ''}">${describe(r)}${count > 1 ? raw(html` <span class="text-xs text-muted">· ${t('auth.account.times', { count })}</span>`) : ''}</span>
        <span class="text-xs text-muted">${raw(timeTag(r.at))}</span>
      </li>`)
    .join('');
  return html`<section class="card settings-section" id="s-activity" aria-labelledby="s-activity-h">
    <h2 id="s-activity-h" class="section-heading !mb-1">${t('auth.account.activity')}</h2>
    <p class="!mt-0 text-sm text-muted">${t('auth.account.activityIntro')}</p>
    ${raw(o.activity.length ? html`<ul class="m-0 list-none p-0">${raw(items)}</ul>` : html`<p class="!mb-0 text-sm text-muted">${t('activity.empty')}</p>`)}
  </section>`;
}

export function accountPage(o: AccountView): string {
  const initial = [...o.user.username][0]?.toUpperCase() ?? '?';
  // Already-safe HTML pieces: the date is escaped here, timeTag builds its own markup.
  const facts = [
    o.createdAt ? html`${t('auth.account.memberSince', { date: absoluteDate(o.createdAt) })}` : '',
    o.previousLogin ? t('auth.account.previousLogin', { time: timeTag(o.previousLogin) }) : '',
  ].filter(Boolean);
  const body = html`
    <div class="mb-6 flex flex-wrap items-center gap-4">
      <span class="avatar size-14 text-2xl" aria-hidden="true">${initial}</span>
      <div class="min-w-0">
        <h1 class="m-0 flex flex-wrap items-center gap-2 text-2xl font-semibold"><span class="sr-only">${t('auth.account.title')}: </span>${o.user.username} ${raw(roleBadge(o.user.role))}</h1>
        <p class="m-0 mt-1 text-sm text-muted">${raw(facts.join(' · '))}</p>
      </div>
    </div>
    ${raw(o.notice && ACCOUNT_NOTICES[o.notice] ? flash(t(`auth.notices.${o.notice}`), ACCOUNT_NOTICES[o.notice]) : '')}
    <div class="grid gap-6 lg:grid-cols-2">
      <div class="grid min-w-0 content-start gap-6">${raw(twoFactorCard(o))}${raw(passwordCard(o))}${raw(authorsCard(o))}</div>
      <div class="grid min-w-0 content-start gap-6">${raw(sessionsCard(o))}${raw(activityCard(o))}</div>
    </div>`;
  return layout({ title: t('auth.account.title'), bodyHtml: body });
}

export function totpSetupPage(o: { secret: string; qrSvg: string; error?: string }): string {
  const grouped = o.secret.replace(/(.{4})/g, '$1 ').trim();
  const body = html`
    ${raw(pageHeader({ back: { href: '/account', label: t('auth.account.title') }, title: t('auth.enroll.title'), meta: t('auth.enroll.intro') }))}
    ${raw(o.error ? flash(o.error, 'err') : '')}
    <div class="grid max-w-3xl gap-6 md:grid-cols-[auto_1fr]">
      <div class="card w-fit bg-white p-3 [&_svg]:h-52 [&_svg]:w-52">${raw(o.qrSvg)}</div>
      <div class="grid content-start gap-4">
        <ol class="m-0 grid gap-2 pl-5 text-sm">
          <li>${t('auth.enroll.step1')}</li>
          <li>${t('auth.enroll.step2')}<br><code class="mt-1 inline-block select-all break-all text-xs">${grouped}</code></li>
          <li>${t('auth.enroll.step3')}</li>
        </ol>
        <form method="post" action="/account/2fa" class="grid max-w-xs gap-3">
          <input type="hidden" name="secret" value="${o.secret}">
          ${raw(field({ id: 'enroll-code', name: 'code', label: t('auth.code'), type: 'text', autocomplete: 'one-time-code', extra: 'inputmode="numeric" pattern="[0-9 ]{6,7}" maxlength="7" autofocus' }))}
          <div><button type="submit" class="btn">${t('auth.enroll.submit')}</button></div>
        </form>
      </div>
    </div>`;
  return layout({ title: t('auth.enroll.title'), bodyHtml: body });
}

export function recoveryCodesPage(codes: string[]): string {
  const body = html`
    ${raw(pageHeader({ title: t('auth.recovery.title'), meta: t('auth.recovery.intro') }))}
    ${raw(flash(t('auth.recovery.once'), 'warn'))}
    <div class="max-w-md" data-recovery-codes>
      <ul class="card m-0 grid list-none grid-cols-2 gap-x-6 gap-y-2 p-4 font-mono text-sm tabular-nums">${raw(codes.map((c) => html`<li>${c}</li>`).join(''))}</ul>
      <!-- Shown by ui.js: copy or download all the codes at once (selecting them by hand is fiddly). -->
      <div class="mt-3 flex flex-wrap items-center gap-2" data-recovery-actions hidden>
        <button type="button" class="btn btn-ghost" data-copy-codes>${t('auth.recovery.copy')}</button>
        <button type="button" class="btn btn-ghost" data-download-codes data-filename="ghost-connector-recovery-codes.txt">${t('auth.recovery.download')}</button>
        <span class="text-sm text-muted" role="status" aria-live="polite" data-copy-status></span>
      </div>
    </div>
    <p class="mt-6"><a class="btn" href="/account">${t('auth.recovery.done')}</a></p>`;
  return layout({ title: t('auth.recovery.title'), bodyHtml: body });
}

/** Dashboard banner while the user's 2FA is off. */
export function twoFactorNag(): string {
  return html`<div class="flash flash-warn flex flex-wrap items-center justify-between gap-2" role="status">
    <span>${t('auth.nag.text')}</span>
    <span class="flex flex-wrap gap-2">
      <a class="btn btn-sm" href="/account/2fa">${t('auth.nag.enable')}</a>
      <form method="post" action="/account/2fa/snooze" class="m-0"><button type="submit" class="btn btn-ghost btn-sm">${t('auth.nag.later')}</button></form>
    </span>
  </div>`;
}

// ---------- Settings → Users (admin) ----------

const USER_NOTICES: Record<string, 'ok' | 'warn' | 'err'> = {
  transferred: 'ok',
  owner: 'err',
  badPassword: 'err',
  roleChanged: 'ok',
  deleted: 'ok',
  twoFactorReset: 'ok',
  inviteRevoked: 'ok',
  lastAdmin: 'err',
  self: 'err',
  authorsSaved: 'ok',
};

export function usersSection(o: { me: AuthUser; users: UserListItem[]; invites: Invite[]; notice?: string; staff?: StaffMember[]; authorsOf?: (id: number) => string[] }): string {
  const staff = o.staff ?? [];
  const rows = o.users
    .map((u) => {
      const self = u.id === o.me.id;
      const manage = canManage(o.me, u);
      const owner = o.me.role === 'owner';
      const other: Exclude<Role, 'owner'> = u.role === 'admin' ? 'editor' : 'admin';
      const item = 'user-menu-item w-full text-left';
      const buttons = [
        owner && manage ? html`<button type="button" class="${item}" data-open-dialog="u-role-${u.id}">${t(`auth.users.makeRole.${other}`)}</button>` : '',
        manage && staff.length ? html`<button type="button" class="${item}" data-open-dialog="u-authors-${u.id}">${t('authors.edit')}</button>` : '',
        manage ? html`<form method="post" action="/settings/users/${u.id}/reset-password" class="m-0"><button type="submit" class="${item}">${t('auth.users.resetPassword')}</button></form>` : '',
        manage && u.totp ? html`<button type="button" class="${item}" data-open-dialog="u-2fa-${u.id}">${t('auth.users.reset2fa')}</button>` : '',
        owner && !self ? html`<button type="button" class="${item}" data-open-dialog="u-own-${u.id}">${t('auth.users.transfer')}</button>` : '',
        manage ? html`<div class="my-1 border-t border-line"></div><button type="button" class="${item} text-err" data-open-dialog="u-del-${u.id}">${t('auth.users.delete')}</button>` : '',
      ].join('');
      const dialogs = [
        manage && staff.length
          ? confirmDialog({
              id: `u-authors-${u.id}`,
              title: t('authors.editTitle', { name: u.username }),
              body: t('authors.defaultHint'),
              confirmLabel: t('authors.save'),
              action: `/settings/users/${u.id}/authors`,
              fields: authorPicker({ id: `u-authors-pick-${u.id}`, staff, selected: o.authorsOf?.(u.id) ?? [] }),
            })
          : '',
        owner && manage
          ? confirmDialog({
              id: `u-role-${u.id}`,
              title: t(`auth.users.roleConfirm.${other}`, { name: u.username }),
              body: t(`auth.users.roleBody.${other}`, { name: u.username }),
              confirmLabel: t('auth.users.roleApply'),
              action: `/settings/users/${u.id}/role`,
              fields: html`<input type="hidden" name="role" value="${other}">`,
            })
          : '',
        manage && u.totp ? confirmDialog({ id: `u-2fa-${u.id}`, title: t('auth.users.reset2faConfirm', { name: u.username }), body: t('auth.users.reset2faBody'), confirmLabel: t('auth.users.reset2fa'), action: `/settings/users/${u.id}/reset-2fa` }) : '',
        manage ? confirmDialog({ id: `u-del-${u.id}`, title: t('auth.users.deleteConfirm', { name: u.username }), body: t('auth.users.deleteBody'), confirmLabel: t('auth.users.delete'), danger: true, action: `/settings/users/${u.id}/delete` }) : '',
        owner && !self
          ? confirmDialog({
              id: `u-own-${u.id}`,
              title: t('auth.users.transferConfirm', { name: u.username }),
              body: t('auth.users.transferBody', { name: u.username }),
              confirmLabel: t('auth.users.transfer'),
              danger: true,
              action: `/settings/users/${u.id}/transfer`,
              fields: html`<label for="own-pw-${u.id}" class="sr-only">${t('auth.currentPassword')}</label><input id="own-pw-${u.id}" name="password" type="password" autocomplete="current-password" required placeholder="${t('auth.currentPassword')}" class="block w-full">`,
            })
          : '',
      ].join('');
      const actions = self
        ? html`<span class="text-xs text-muted">${t('auth.users.you')}</span>`
        : buttons
          ? // One gear per row opens its actions; the confirm dialogs live outside the menu (a closed <details> hides its content).
            html`<details class="user-menu inline-block text-left" data-menu>
              <summary class="icon-btn" title="${t('auth.users.actionsFor', { name: u.username })}"><span class="sr-only">${t('auth.users.actionsFor', { name: u.username })}</span>${raw(GEAR)}</summary>
              <div class="user-menu-panel w-60">${raw(buttons)}</div>
            </details>${raw(dialogs)}`
          : '';
      return html`<tr>
        <td class="font-medium">${u.username}${raw(staff.length ? html`<span class="block text-xs font-normal text-muted">${t('authors.label', { names: (o.authorsOf?.(u.id) ?? []).length ? authorNames(o.authorsOf!(u.id), staff) : t('authors.none') })}</span>` : '')}<span class="block text-xs font-normal text-muted sm:hidden">2FA: ${u.totp ? t('auth.security.on') : t('auth.security.off')}</span></td>
        <td>${raw(roleBadge(u.role))}</td>
        <td class="max-sm:hidden">${raw(u.totp ? html`<span class="badge badge-ok">${t('auth.security.on')}</span>` : html`<span class="badge badge-warn">${t('auth.security.off')}</span>`)}</td>
        <td class="whitespace-nowrap text-muted max-sm:hidden">${raw(u.lastSeen ? timeTag(u.lastSeen) : '—')}</td>
        <td class="text-right">${raw(actions)}</td>
      </tr>`;
    })
    .join('');

  const invites = o.invites.length
    ? html`<h3 class="mb-2 mt-6 text-sm font-semibold">${t('auth.users.pending')}</h3>
      <ul class="m-0 list-none p-0">${raw(
        o.invites
          .map(
            (i) => html`<li class="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 text-sm last:border-b-0">
              <span>${i.username ? t('auth.users.pendingReset', { name: i.username }) : raw(t('auth.users.pendingInvite', { role: roleBadge(i.role) }))} <span class="text-xs text-muted">· ${raw(t('auth.users.expires', { time: timeTag(i.expiresAt) }))}${i.createdBy ? ` · ${t('auth.by', { name: i.createdBy })}` : ''}</span></span>
              <form method="post" action="/settings/invites/revoke" class="m-0"><input type="hidden" name="id" value="${i.id}"><button type="submit" class="btn btn-ghost btn-sm">${t('auth.users.revoke')}</button></form>
            </li>`,
          )
          .join(''),
      )}</ul>`
    : '';

  return html`<section class="card settings-section min-w-0" id="s-users" aria-labelledby="s-users-h">
    <h2 id="s-users-h" class="section-heading !mb-1">${t('auth.users.title')}</h2>
    <p class="!mt-0 text-sm text-muted">${t('auth.users.intro')}</p>
    ${raw(o.notice && USER_NOTICES[o.notice] ? flash(t(`auth.users.notices.${o.notice}`), USER_NOTICES[o.notice]) : '')}
    <div>
      <table class="data-table">
        <thead><tr><th scope="col">${t('auth.username')}</th><th scope="col">${t('auth.users.role')}</th><th scope="col" class="max-sm:hidden">2FA</th><th scope="col" class="max-sm:hidden">${t('auth.users.lastSeen')}</th><th scope="col"><span class="sr-only">${t('auth.users.actions')}</span></th></tr></thead>
        <tbody>${raw(rows)}</tbody>
      </table>
    </div>
    ${raw(invites)}
    <h3 class="mb-2 mt-6 text-sm font-semibold">${t('auth.users.invite')}</h3>
    <form method="post" action="/settings/users/invite">
      <label for="invite-role" class="block text-sm font-medium">${t('auth.users.role')}</label>
      <div class="mt-1 flex flex-wrap items-stretch gap-2">
        <select id="invite-role" name="role">
          <option value="editor" selected>${t('auth.roles.editor')}</option>
          ${o.me.role === 'owner' ? raw(html`<option value="admin">${t('auth.roles.admin')}</option>`) : ''}
        </select>
        <button type="submit" class="btn">${t('auth.users.createLink')}</button>
      </div>
    </form>
    <p class="!mb-0 mt-3 text-xs text-muted">${t('auth.users.rolesHelp')}${o.me.role === 'owner' ? '' : ` ${t('auth.users.onlyOwnerAdmins')}`}</p>
  </section>`;
}

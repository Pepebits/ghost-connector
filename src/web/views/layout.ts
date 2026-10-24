import { readFileSync } from 'node:fs';
import { availableLocales, clientMessages, currentLocale, localeName, t } from '../../i18n/index.js';
import { cspNonce, currentUser, isAdminRole } from '../../auth/context.js';
import { html, raw } from '../html.js';

/**
 * PEPEBITS wordmark, copied as-is from the brand guide
 * (src/web/brand/pepebits-wordmark.svg). Inlined so the letters follow
 * the theme, including a manually chosen one: the guide only allows ink or bone for the
 * letters (.brand-ink class) and the red dot never changes. Never recolored.
 */
const WORDMARK = readFileSync(new URL('../brand/pepebits-wordmark.svg', import.meta.url), 'utf8')
  .replace(/<svg ([^>]*)width="302" height="75" role="img" aria-label="Pepebits">/, '<svg $1width="100" height="25" aria-hidden="true" focusable="false">')
  .replace('fill="#1c1b1b"', 'class="brand-ink"');

/**
 * The header icon, inlined so it can be animated (see .brand-logo in
 * styles.css). Same drawing as public/icon.svg, but with the eyes as
 * their own rectangles (so they blink) instead of holes in the path.
 */
const LOGO = `<svg class="brand-logo" viewBox="0 0 120 120" width="32" height="32" aria-hidden="true" focusable="false" shape-rendering="crispEdges">
  <rect width="120" height="120" fill="#1c1b1b"/>
  <g class="brand-logo-ghost">
    <path fill="#fcf9f8" d="M37 45 L57 45 L57 50 L62 50 L62 55 L67 55 L67 90 L57 90 L57 85 L52 85 L52 90 L42 90 L42 85 L37 85 L37 90 L27 90 L27 55 L32 55 L32 50 L37 50Z"/>
    <g class="brand-logo-eyes" fill="#1c1b1b"><rect x="32" y="60" width="10" height="10"/><rect x="52" y="60" width="10" height="10"/></g>
  </g>
  <rect class="brand-logo-bit" x="74" y="70" width="20" height="20" fill="#ff3e3e"/>
</svg>`;

const VERSION = (JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string }).version;

const footer = () => `<footer class="site-footer">
  <div class="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-6 sm:px-6">
    <p class="!my-0 text-sm text-muted">Ghost Connector <span class="tabular-nums">v${VERSION}</span></p>
    <a class="inline-flex items-center gap-2 text-sm text-muted hover:no-underline" href="https://pepebits.com" target="_blank" rel="noopener noreferrer">
      <span>${t('common.footer.productOf')}</span>${WORDMARK.trim()}<span class="sr-only">PEPEBITS (${t('common.footer.newTab')})</span>
    </a>
  </div>
</footer>`;

// Theme: 'auto' (follows the system, also if it changes with the page open),
// 'light' or 'dark'. Inlined in <head> (not a separate .js) to apply
// the theme BEFORE the first paint: otherwise the page flickers on load.
const THEME_SCRIPT = `(function(){
var mq=matchMedia('(prefers-color-scheme: dark)');
function pref(){try{var t=localStorage.getItem('gc-theme');return t==='light'||t==='dark'?t:'auto';}catch(e){return 'auto';}}
function apply(){var p=pref();document.documentElement.classList.toggle('dark',p==='dark'||(p==='auto'&&mq.matches));}
function sync(){var p=pref();document.querySelectorAll('[data-theme-choice]').forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-theme-choice')===p));});}
window.gcSetTheme=function(p){try{if(p==='auto')localStorage.removeItem('gc-theme');else localStorage.setItem('gc-theme',p);}catch(e){}apply();sync();};
window.gcToggleTheme=function(){gcSetTheme(document.documentElement.classList.contains('dark')?'light':'dark');};
mq.addEventListener('change',apply);
apply();
document.addEventListener('DOMContentLoaded',sync);
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-theme-choice]');if(b)gcSetTheme(b.getAttribute('data-theme-choice'));});
})();`;

export type NavSection = 'dashboard' | 'ideas' | 'jobs' | 'settings';

const NAV: Array<{ id: NavSection; href: string }> = [
  { id: 'dashboard', href: '/' },
  { id: 'ideas', href: '/ideas' },
  { id: 'jobs', href: '/jobs' },
  { id: 'settings', href: '/settings' },
];

/** Strings for public/*.js (window.gcT). Placed in a JSON <script>: "<" is escaped so it doesn't close the tag. */
function clientI18n(): string {
  const json = JSON.stringify({ locale: currentLocale(), messages: clientMessages() }).replace(/</g, '\\u003c');
  return `window.GC_I18N=${json};`;
}

/** Language switch from the command palette: palette.js picks up any [data-palette] and clicks it. */
function languageForm(): string {
  const buttons = availableLocales()
    .map((l) => html`<button type="submit" hidden name="lang" value="${l}" data-palette="${t('settings.language.palette', { name: localeName(l) })}">${localeName(l)}</button>`)
    .join('');
  return html`<form id="gc-lang-form" method="post" action="/settings/language" hidden>${raw(buttons)}</form>`;
}

/** Round avatar with the initial; opens a menu with the account and logout. */
function userMenu(user: { username: string; role: string }): string {
  const initial = [...user.username][0]?.toUpperCase() ?? '?';
  return html`<details class="user-menu" data-user-menu>
    <summary class="user-avatar" title="${user.username}" aria-label="${t('auth.menu.label', { name: user.username })}">${initial}</summary>
    <div class="user-menu-panel">
      <div class="border-b border-line px-3 py-2"><div class="truncate font-medium">${user.username}</div><div class="text-xs text-muted">${t(`auth.roles.${user.role}`)}</div></div>
      <a href="/account" class="user-menu-item" data-palette="${t('auth.account.title')}">${t('auth.account.title')}</a>
      <form method="post" action="/logout" class="m-0"><button type="submit" class="user-menu-item w-full text-left" data-palette="${t('auth.logout')}">${t('auth.logout')}</button></form>
    </div>
  </details>`;
}

/** `bare`: login pages, without navigation, search or logout. */
export function layout(opts: { title: string; bodyHtml: string; section?: NavSection; bare?: boolean }): string {
  const user = currentUser();
  // Editors do all the editorial work; settings (keys, prompts, users) are the admins'.
  const isAdmin = !user || isAdminRole(user.role);
  const navLinks = NAV.filter((n) => n.id !== 'settings' || isAdmin).map((n) =>
    n.id === opts.section
      ? html`<a href="${n.href}" aria-current="page" class="rounded-md bg-panel-2 px-2.5 py-1 font-medium text-fg hover:no-underline">${t(`common.nav.${n.id}`)}</a>`
      : html`<a href="${n.href}" class="rounded-md px-2.5 py-1 text-muted hover:bg-panel-2 hover:text-fg hover:no-underline">${t(`common.nav.${n.id}`)}</a>`,
  ).join('');

  return html`<!doctype html>
<html lang="${currentLocale()}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="${t('common.metaDescription')}" />
<meta name="robots" content="noindex, nofollow" />
<title>${opts.title} · Ghost Connector</title>
<script nonce="${cspNonce()}">${raw(THEME_SCRIPT)}</script>
<script nonce="${cspNonce()}">${raw(clientI18n())}</script>
<link rel="stylesheet" href="/app.css" />
<link rel="icon" href="/icon.svg" type="image/svg+xml" />
<script src="/ui.js" defer></script>
<script src="/palette.js" defer></script>
<script src="/ghost.js" defer></script>
</head>
<body class="flex min-h-screen flex-col" data-role="${user?.role ?? ''}">
<a href="#contenido" class="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 btn">${t('common.skipToContent')}</a>
<header class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel px-4 py-2.5 sm:px-6">
  <a href="/" class="brand-link mr-2 inline-flex items-center gap-2 font-bold text-fg hover:no-underline">${raw(LOGO)}Ghost Connector</a>
  ${opts.bare ? '' : raw(html`<nav aria-label="${t('common.nav.label')}" class="flex items-center gap-1">${raw(navLinks)}</nav>`)}
  <div class="ml-auto flex items-center gap-2">
    ${opts.bare ? '' : raw(html`<button type="button" data-open-palette class="btn btn-ghost btn-sm" title="${t('common.search.title')}">
      ${t('common.search.button')} <kbd>⌘K</kbd>
    </button>`)}
    <div id="gc-theme" class="theme-switch" role="group" aria-label="${t('common.theme.label')}">
      <button type="button" class="theme-btn" data-theme-choice="auto" aria-pressed="false" title="${t('common.theme.label')}: ${t('common.theme.auto')}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg><span class="sr-only">${t('common.theme.auto')}</span></button>
      <button type="button" class="theme-btn" data-theme-choice="light" aria-pressed="false" title="${t('common.theme.label')}: ${t('common.theme.light')}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><span class="sr-only">${t('common.theme.light')}</span></button>
      <button type="button" class="theme-btn" data-theme-choice="dark" aria-pressed="false" title="${t('common.theme.label')}: ${t('common.theme.dark')}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg><span class="sr-only">${t('common.theme.dark')}</span></button>
    </div>
    ${opts.bare ? '' : raw(user ? userMenu(user) : html`<form method="post" action="/logout" class="m-0"><button type="submit" class="btn btn-ghost btn-sm">${t('auth.logout')}</button></form>`)}
  </div>
</header>
<main id="contenido" class="mx-auto w-full ${opts.bare ? 'max-w-md' : 'max-w-[1100px]'} flex-1 p-4 sm:p-6">${raw(opts.bodyHtml)}</main>
${raw(footer())}
${raw(isAdmin && !opts.bare ? languageForm() : '')}
</body>
</html>
`;
}

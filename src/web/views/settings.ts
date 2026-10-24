import type { BudgetStatus } from '../../agents/budget.js';
import type { CostSummary, AgentCost, DailyCost, ProviderQuota } from '../../db/repo.js';
import { costChart } from './costChart.js';
import { PROMPT_NAMES } from '../../agents/prompts.js';
import { formatTokens, formatUsd } from './format.js';
import { escapeHtml, html, raw } from '../html.js';
import { availableLocales, currentLocale, localeName, t, type Vars } from '../../i18n/index.js';
import { layout } from './layout.js';
import { timeTag } from './jobInfo.js';
import { flash, pageHeader } from './ui.js';
import { parseDraftFilter } from '../../ghost/draftFilter.js';
import { ENV_FIELDS, fieldHelp, fieldLabel, OWNER_ONLY_KEYS, type EnvField, type EnvGroup } from '../../settings/envFile.js';

/** Translated text that carries its own HTML (from the JSON); variables are escaped. */
function tHtml(key: string, vars: Vars = {}): string {
  const safe: Vars = {};
  for (const [k, v] of Object.entries(vars)) safe[k] = typeof v === 'number' ? v : escapeHtml(v);
  return t(key, safe);
}

/** Key/value row; `value` is already safe HTML (comes from html`` or status()). */
function row(label: string, value: string): string {
  return html`<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-2 last:border-b-0">
    <dt class="text-sm text-muted">${label}</dt><dd class="m-0 min-w-0 break-all text-right">${raw(value)}</dd>
  </div>`;
}

function card(id: string, title: string, content: string, extra = '', lead = ''): string {
  return html`<section class="card settings-section" id="${id}" aria-labelledby="${id}-title">
    <h2 id="${id}-title" class="section-heading">${title}</h2>
    ${raw(lead)}<dl class="m-0">${raw(content)}</dl>${raw(extra)}
  </section>`;
}

function quotaRow(q: ProviderQuota): string {
  const limit = q.provider === 'unsplash' ? 50 : q.provider === 'pixabay' ? 100 : 200; // Pixabay 100/min, Pexels 200/h, Openverse 200/day
  const value = q.lastRemaining === null ? '?' : String(q.lastRemaining);
  const low = q.lastRemaining !== null && q.lastRemaining < limit * 0.2;
  return row(
    t('settings.cost.quota', { provider: q.provider }),
    html`<span class="tabular-nums ${low ? 'text-warn' : ''}">~${value}/${limit}</span> <span class="text-xs text-muted">· ${raw(timeTag(q.lastAt))}</span>`,
  );
}

export interface SettingsOpts {
  /** Settings → Security (login, 2FA, sessions), already rendered. */
  /** Only the owner sees or changes keys, and exports/imports. */
  isOwner?: boolean;
  /** Settings → Users (admins only see this page). */
  usersHtml?: string;
  /** After an import: what was applied. */
  imported?: string[];
  /** Settings → Activity (latest entries). */
  activityHtml?: string;
  /** Current values of the editable variables that are NOT secret. */
  values: Record<string, string>;
  /** For each secret: whether it has a saved value (the value never reaches here). */
  secretsSet: Record<string, boolean>;
  /** Non-secret hint of the Ghost Admin API Key: its id. */
  ghostKeyId: string;
  envPath: string;
  /** DATA_DIR as configured. */
  dataDir: string;
  /** Prompts with an edited version (the rest use the factory one). */
  customizedPrompts: string[];
  suggestedAppName: string;
  openverseRegistered?: boolean;
  activeJobs: number;
  quotas: ProviderQuota[];
  indexedArtifacts: number;
  cost: CostSummary;
  budget?: BudgetStatus | null;
  dailyCost?: DailyCost[];
  costByAgent?: AgentCost[];
  /** Notice after redirect: artifacts reindexed. */
  reindexed?: number;
  /** Notice after saving: changed keys. */
  saved?: string[];
  /** Section that was just saved (or failed): its notice goes inside it. */
  group?: string;
  /** Validation errors on save (per key), with what was submitted (no secrets). */
  errors?: Array<{ key: string; message: string }>;
}

// Title and intro of each group: settings.groups.<id>.title / .intro.
const GROUPS: Array<{ id: EnvGroup; test?: string; intro?: boolean; wide?: boolean }> = [
  { id: 'ghost', test: 'ghost' },
  { id: 'ai', test: 'ai', intro: true },
  { id: 'images', wide: true },
  { id: 'unsplash', test: 'unsplash', intro: true },
  { id: 'pixabay', test: 'pixabay', intro: true },
  { id: 'pexels', test: 'pexels', intro: true },
  { id: 'openverse', test: 'openverse', intro: true },
  { id: 'wikimedia', test: 'wikimedia', intro: true },
  { id: 'gsc', test: 'gsc', intro: true },
  { id: 'bing', test: 'bing', intro: true },
  { id: 'behaviour' },
];

function fieldControl(f: EnvField, opts: SettingsOpts, error?: string): string {
  const id = `f-${f.key}`;
  const label = fieldLabel(f);
  const help = fieldHelp(f);
  const describedBy = [help ? `${id}-help` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ');
  const aria = raw(`${describedBy ? `aria-describedby="${describedBy}"` : ''} ${error ? 'aria-invalid="true"' : ''}`);
  const value = opts.values[f.key] ?? '';
  let control: string;
  let extraAfterHelp = '';
  if (f.key === 'GITHUB_TOKEN') {
    extraAfterHelp = html`<a class="key-link !mt-1" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">${t('settings.keyLink.github')}<span class="sr-only"> (${t('common.footer.newTab')})</span></a>`;
  }
  if (!f.secret && !opts.isOwner && OWNER_ONLY_KEYS.has(f.key)) {
    control = html`<input id="${id}" type="text" disabled value="${value}" class="w-full" ${aria} />
      <p class="!mb-0 mt-1.5 text-xs text-muted">${t('settings.secret.ownerOnlyEndpoint')}</p>`;
  } else if (f.secret && !opts.isOwner) {
    const isSet = opts.secretsSet[f.key];
    control = html`<input id="${id}" type="password" disabled placeholder="${isSet ? t('settings.secret.set') : t('settings.secret.unset')}" class="w-full" ${aria} />
      <p class="!mb-0 mt-1.5 text-xs text-muted">${t('settings.secret.ownerOnly')}</p>`;
  } else if (f.secret) {
    const isSet = opts.secretsSet[f.key];
    const hint =
      f.key === 'GHOST_ADMIN_API_KEY' && isSet
        ? t('settings.secret.setWithId', { id: opts.ghostKeyId })
        : isSet
            ? t('settings.secret.set')
            : t('settings.secret.unset');
    control = html`<input id="${id}" name="${f.key}" type="password" autocomplete="off" spellcheck="false" placeholder="${hint}" class="w-full" ${aria} />
      <div class="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>${isSet ? t('settings.secret.keep') : t('settings.secret.paste')}</span>
        ${f.clearable && isSet ? raw(html`<label class="inline-flex items-center gap-1"><input type="checkbox" name="clear_${f.key}" /> ${t('settings.secret.clear')}</label>`) : ''}
      </div>`;
  } else if (f.type === 'model') {
    // A dropdown of the provider's models (settings.js fills it from
    // /api/settings/ai-models); "Other…" reveals a box to type any name.
    const perAgent = f.key !== 'AI_MODEL';
    const first = perAgent
      ? html`<option value="" ${value ? '' : raw('selected')}>${t('settings.model.sameAsMain', { model: opts.values.AI_MODEL || '—' })}</option>`
      : '';
    const current = value ? html`<option value="${value}" selected>${value}</option>` : '';
    control = html`<select id="${id}" name="${f.key}" class="w-full" data-model-select="${perAgent ? 'agent' : 'main'}" ${aria}>
        ${raw(first)}${raw(current)}
        <option value="__other">${t('settings.model.other')}</option>
      </select>
      <input name="${f.key}__custom" class="mt-2 w-full" spellcheck="false" autocomplete="off" placeholder="${t('settings.model.typeName')}" aria-label="${t('settings.model.typeNameFor', { field: label })}" data-model-custom hidden />
`;
    if (!perAgent) extraAfterHelp = '<p class="!mb-0 mt-1 text-xs text-muted empty:hidden" data-model-status aria-live="polite"></p>';
  } else if (f.type === 'select') {
    control = html`<select id="${id}" name="${f.key}" class="w-full" ${aria}>${raw((f.options ?? []).map((o) => html`<option value="${o}" ${o === value ? raw('selected') : ''}>${f.key === 'UI_LANGUAGE' ? localeName(o) : o}</option>`).join(''))}</select>`;
  } else if (f.type === 'boolean') {
    return html`<div class="flex items-center gap-2">
      <input id="${id}" name="${f.key}" type="checkbox" value="true" ${value === 'true' ? raw('checked') : ''} ${aria} />
      <label for="${id}" class="text-sm">${label}</label>
      ${error ? raw(html`<p id="${id}-err" class="!my-0 text-xs text-err">${error}</p>`) : ''}
    </div>`;
  } else if (f.type === 'order') {
    const labels: Record<string, string> = { unsplash: 'Unsplash', pixabay: 'Pixabay', pexels: 'Pexels', openverse: 'Openverse', wikimedia: 'Wikimedia Commons' };
    const current = value.split(',').filter(Boolean);
    const all = [...current, ...(f.options ?? []).filter((o) => !current.includes(o))];
    const items = all
      .map(
        (o, i) => html`<li class="flex items-center justify-between gap-2 border-b border-line py-1.5 last:border-b-0" data-order-item="${o}" data-order-label="${labels[o] ?? o}">
          <span><span class="mr-2 inline-block w-5 text-right tabular-nums text-muted" data-order-pos>${i + 1}.</span>${labels[o] ?? o}</span>
          <span class="flex gap-1">
            <button type="button" class="btn btn-ghost btn-sm" data-order-move="-1" aria-label="${t('settings.order.up', { name: labels[o] ?? o })}">↑</button>
            <button type="button" class="btn btn-ghost btn-sm" data-order-move="1" aria-label="${t('settings.order.down', { name: labels[o] ?? o })}">↓</button>
          </span>
        </li>`,
      )
      .join('');
    // The real value goes in the hidden input; settings.js rewrites it on move.
    return html`<div data-order-field="${f.key}">
      <span id="${id}" class="mb-1.5 block text-sm font-medium">${label}</span>
      <ol class="m-0 list-none p-0" aria-labelledby="${id}" ${aria}>${raw(items)}</ol>
      <input type="hidden" name="${f.key}" value="${all.join(',')}" data-order-value />
      <p class="sr-only" aria-live="polite" data-order-status></p>
      ${help ? raw(html`<p id="${id}-help" class="!mb-0 mt-1.5 text-xs text-muted">${help}</p>`) : ''}
      ${error ? raw(html`<p id="${id}-err" class="!mb-0 mt-1 text-xs text-err">${error}</p>`) : ''}
    </div>`;
  } else if (f.type === 'draftFilter') {
    const parsed = parseDraftFilter(value);
    const opt = (m: string, label: string) => html`<option value="${m}" ${parsed.mode === m ? raw('selected') : ''}>${label}</option>`;
    // The real NQL goes in the named input; the picker and the tag only fill it (settings.js).
    return html`<div data-draft-filter>
      <label for="${id}-mode" class="mb-1.5 block text-sm font-medium">${label}</label>
      <select id="${id}-mode" class="w-full" data-df-mode>
        ${raw(opt('all', t('settings.draftFilter.all')))}
        ${raw(opt('tag', t('settings.draftFilter.tag')))}
        ${raw(opt('not-tag', t('settings.draftFilter.notTag')))}
        ${raw(opt('custom', t('settings.draftFilter.custom')))}
      </select>
      <div class="mt-3" data-df-tag-wrap ${parsed.mode === 'tag' || parsed.mode === 'not-tag' ? '' : raw('hidden')}>
        <label for="${id}-tag" class="mb-1.5 block text-sm font-medium">${t('settings.draftFilter.tagLabel')}</label>
        <input id="${id}-tag" list="${id}-tags" class="w-full" spellcheck="false" autocomplete="off" value="${parsed.tag}" placeholder="${t('settings.draftFilter.tagPlaceholder')}" data-df-tag aria-describedby="${id}-tag-help" />
        <datalist id="${id}-tags" data-df-tags></datalist>
        <p id="${id}-tag-help" class="!mb-0 mt-1.5 text-xs text-muted" data-df-tags-status>${raw(t('settings.draftFilter.tagHelp'))}</p>
      </div>
      <label for="${id}" class="mb-1.5 mt-3 block text-sm font-medium">${t('settings.draftFilter.nqlLabel')}</label>
      <input id="${id}" name="${f.key}" value="${value}" class="w-full font-mono !text-sm" spellcheck="false" data-df-nql ${aria} />
      <p id="${id}-help" class="!mb-0 mt-1.5 text-xs text-muted">${raw(t('settings.draftFilter.nqlHelp'))}</p>
      ${error ? raw(html`<p id="${id}-err" class="!mb-0 mt-1.5 text-xs text-err">${error}</p>`) : ''}
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" class="btn btn-ghost btn-sm" data-test-connection="drafts">${t('settings.draftFilter.test')}</button>
      </div>
      <p class="!mb-0 mt-2 min-h-5 text-sm" data-test-result="drafts" role="status" aria-live="polite"></p>
    </div>`;
  } else if (f.type === 'textarea') {
    control = html`<textarea id="${id}" name="${f.key}" rows="2" class="w-full" ${aria}>${value}</textarea>`;
  } else {
    const type = f.type === 'number' ? 'number' : f.type === 'url' ? 'url' : 'text';
    control = html`<input id="${id}" name="${f.key}" type="${type}" value="${value}" class="w-full" spellcheck="false" ${type === 'number' ? raw('min="1"') : ''} ${aria} />`;
  }
  return html`<div>
    <label for="${id}" class="mb-1.5 block text-sm font-medium">${label}</label>
    ${raw(control)}
    ${help ? raw(html`<p id="${id}-help" class="!mb-0 mt-1.5 text-xs text-muted">${help}</p>`) : ''}
    ${raw(extraAfterHelp)}
    ${error ? raw(html`<p id="${id}-err" class="!mb-0 mt-1 text-xs text-err">${error}</p>`) : ''}
  </div>`;
}

/** Status of each section for its header badge (from saved values, without calling anything). */
function groupStatus(group: EnvGroup, opts: SettingsOpts): { label: string; tone: 'ok' | 'info' | 'neutral' | 'warn' } | null {
  const v = opts.values;
  const set = opts.secretsSet;
  switch (group) {
    case 'ghost':
      return set.GHOST_ADMIN_API_KEY && v.GHOST_API_URL ? { label: t('settings.status.configured'), tone: 'ok' } : { label: t('settings.status.notConfigured'), tone: 'warn' };
    case 'ai':
      return set.AI_API_KEY ? { label: `${v.AI_PROVIDER} · ${v.AI_MODEL}`, tone: 'ok' } : { label: t('settings.status.noKey'), tone: 'warn' };
    case 'unsplash':
      return set.UNSPLASH_ACCESS_KEY ? { label: t('settings.status.enabled'), tone: 'ok' } : { label: t('settings.status.noKey'), tone: 'neutral' };
    case 'pixabay':
      return set.PIXABAY_API_KEY ? { label: t('settings.status.enabled'), tone: 'ok' } : { label: t('settings.status.noKey'), tone: 'neutral' };
    case 'pexels':
      return set.PEXELS_API_KEY ? { label: t('settings.status.enabled'), tone: 'ok' } : { label: t('settings.status.noKey'), tone: 'neutral' };
    case 'openverse':
      if (v.OPENVERSE_ENABLED !== 'true') return { label: t('settings.status.disabled'), tone: 'neutral' };
      return v.OPENVERSE_CLIENT_ID && set.OPENVERSE_CLIENT_SECRET
        ? { label: t('settings.status.enabledWithCreds'), tone: 'ok' }
        : { label: t('settings.status.enabledNoCreds'), tone: 'info' };
    case 'gsc':
      return v.GSC_SITE_URL && set.GSC_SERVICE_ACCOUNT ? { label: t('settings.status.configured'), tone: 'ok' } : { label: t('settings.status.notConfigured'), tone: 'neutral' };
    case 'bing':
      return v.BING_SITE_URL && set.BING_API_KEY ? { label: t('settings.status.configured'), tone: 'ok' } : { label: t('settings.status.notConfigured'), tone: 'neutral' };
    case 'wikimedia':
      return v.WIKIMEDIA_ENABLED !== 'true' ? { label: t('settings.status.disabled'), tone: 'neutral' } : { label: t('settings.status.enabled'), tone: 'ok' };
    default:
      return null;
  }
}

/**
 * One form per section, saved on its own (__group): what you save is what
 * you see, and a long section no longer drags the rest. Sections stack in
 * one column (GitHub/Polaris settings pattern), each with its actions at
 * the bottom: Save, and Test connection where it applies.
 */
/** Where to create each key (opens in a new tab). The AI one follows the chosen provider (settings.js). */
const AI_KEY_URLS: Record<string, string> = {
  deepseek: 'https://platform.deepseek.com/api_keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
};
function keyLink(group: EnvGroup, opts: SettingsOpts): string {
  const ghost = (opts.values.GHOST_API_URL ?? '').replace(/\/+$/, '');
  const links: Partial<Record<EnvGroup, string>> = {
    ghost: ghost ? `${ghost}/ghost/#/settings/integrations` : '',
    ai: AI_KEY_URLS[opts.values.AI_PROVIDER ?? ''] ?? '',
    unsplash: 'https://unsplash.com/oauth/applications',
    pixabay: 'https://pixabay.com/api/docs/',
    gsc: 'https://developers.google.com/webmaster-tools/v1/how-tos/authorizing',
    bing: 'https://www.bing.com/webmasters/apiaccess',
    pexels: 'https://www.pexels.com/api/new/',
  };
  const href = links[group];
  if (group === 'ai') {
    // Always rendered for AI: hidden for openai-compatible (no single place to get a key).
    return html`<a class="key-link" href="${href || '#'}" target="_blank" rel="noopener noreferrer" data-ai-key-link='${JSON.stringify(AI_KEY_URLS)}' ${href ? '' : raw('hidden')}>${t('settings.keyLink.ai')}<span class="sr-only"> (${t('common.footer.newTab')})</span></a>`;
  }
  if (group === 'ghost') {
    // Always rendered: settings.js points it at the URL as you type it.
    return html`<a class="key-link" href="${href || '#'}" target="_blank" rel="noopener noreferrer" data-ghost-key-link ${href ? '' : raw('hidden')}>${t('settings.keyLink.ghost')}<span class="sr-only"> (${t('common.footer.newTab')})</span></a>`;
  }
  if (!href) return '';
  return html`<a class="key-link" href="${href}" target="_blank" rel="noopener noreferrer">${t(`settings.keyLink.${group}`)}<span class="sr-only"> (${t('common.footer.newTab')})</span></a>`;
}

function envSections(opts: SettingsOpts): string {
  const errorFor = new Map((opts.errors ?? []).map((e) => [e.key, e.message]));
  const locked = opts.activeJobs > 0;
  return GROUPS.map((g) => {
    const title = t(`settings.groups.${g.id}.title`);
    const intro = g.intro ? t(`settings.groups.${g.id}.intro`) : '';
    // UI_LANGUAGE has its own card (languageCard).
    const groupFields = ENV_FIELDS.filter((f) => f.group === g.id && f.key !== 'UI_LANGUAGE');
    // Per-agent models are optional and advanced: folded, with an explanation.
    const isAgentModel = (f: EnvField) => f.type === 'model' && f.key !== 'AI_MODEL';
    const agentFields = groupFields.filter(isAgentModel);
    const agentSet = agentFields.some((f) => opts.values[f.key]);
    const fields =
      groupFields.filter((f) => !isAgentModel(f)).map((f) => fieldControl(f, opts, errorFor.get(f.key))).join('') +
      (agentFields.length
        ? html`<details class="rounded-md border border-line px-4 py-3" ${agentSet || agentFields.some((f) => errorFor.has(f.key)) ? raw('open') : ''}>
            <summary class="cursor-pointer font-medium">${t('settings.model.perAgentTitle')}</summary>
            <p class="!mt-2 text-sm text-muted">${t('settings.model.perAgentIntro')}</p>
            <div class="mt-4 grid gap-5">${raw(agentFields.map((f) => fieldControl(f, opts, errorFor.get(f.key))).join(''))}</div>
          </details>`
        : '');
    const test = g.test
      ? html`<button type="button" class="btn btn-ghost" data-test-connection="${g.test}">${t('settings.form.test')}</button>`
      : '';
    const extra =
      g.id === 'openverse' && opts.isOwner
        ? html`<button type="button" class="btn btn-ghost" data-open-dialog="openverse-register">${opts.values.OPENVERSE_CLIENT_ID ? t('settings.form.registerAnother') : t('settings.form.registerApp')}</button>`
        : '';
    const status = groupStatus(g.id, opts);
    const isTarget = opts.group === g.id;
    const groupErrors = (opts.errors ?? []).filter((e) => groupFields.some((f) => f.key === e.key));
    const notice = isTarget && groupErrors.length
      ? flash(t('settings.notices.errors', { list: groupErrors.map((e) => `${e.key} (${e.message})`).join(', ') }), 'err')
      : isTarget && opts.saved
        ? opts.saved.length
          ? flash(t('settings.notices.savedSection'))
          : flash(t('settings.notices.nothing'), 'info')
        : '';
    return html`<form method="post" action="/settings/env" id="g-${g.id}" class="card settings-section" autocomplete="off" data-env-form data-guard data-busy="${t('settings.form.saving')}" aria-labelledby="g-${g.id}-title">
      <input type="hidden" name="__group" value="${g.id}" />
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="g-${g.id}-title" class="section-heading !mb-0">${title}</h2>
        ${status ? raw(html`<span class="badge badge-${status.tone}">${status.label}</span>`) : ''}
      </div>
      ${intro ? raw(html`<p class="!mb-0 mt-1 text-sm text-muted">${intro}</p>`) : ''}
      ${raw(keyLink(g.id, opts))}
      ${raw(notice ? html`<div class="mt-4">${raw(notice)}</div>` : '')}
      <div class="mt-5 grid gap-5">${raw(fields)}</div>
      <div class="settings-section-foot">
        <div class="flex flex-wrap items-center gap-2">
          <button type="submit" class="btn" ${locked ? raw('disabled aria-describedby="env-locked"') : ''}>${t('settings.form.saveSection')}</button>
          ${raw(test)}${raw(extra)}
        </div>
        ${g.test ? raw(html`<p class="!mb-0 mt-2 text-sm empty:hidden" data-test-result="${g.test}" role="status" aria-live="polite"></p>`) : ''}
      </div>
    </form>`;
  }).join('');
}

/**
 * Interface language: its own form (POST /settings/language), usable
 * even while jobs are running. Names are written in their own language.
 */
function languageCard(): string {
  const current = currentLocale();
  const options = availableLocales()
    .map((l) => html`<option value="${l}" lang="${l}" ${l === current ? raw('selected') : ''}>${localeName(l)}</option>`)
    .join('');
  return html`<section class="card settings-section" id="s-language" aria-labelledby="s-language-h">
    <h2 id="s-language-h" class="section-heading !mb-0">${t('settings.language.title')}</h2>
    <p class="!mt-0 !mb-0 text-xs text-muted">${t('settings.language.intro')}</p>
    <form method="post" action="/settings/language" class="mt-4 flex flex-wrap items-end gap-3">
      <div>
        <label for="f-UI_LANGUAGE" class="mb-1.5 block text-sm font-medium">${t('settings.language.label')}</label>
        <select id="f-UI_LANGUAGE" name="lang">${raw(options)}</select>
      </div>
      <button type="submit" class="btn">${t('settings.language.apply')}</button>
    </form>
  </section>`;
}

/** Outside the main form (forms can't be nested). */
function openverseRegisterDialog(opts: SettingsOpts): string {
  const replacing = !!opts.values.OPENVERSE_CLIENT_ID;
  return html`<dialog id="openverse-register" class="confirm-dialog" aria-labelledby="ov-reg-title">
    <form method="post" action="/settings/openverse/register" data-busy="${t('settings.openverse.registering')}">
      <h2 id="ov-reg-title" class="mb-2 text-lg font-semibold">${t('settings.openverse.title')}</h2>
      <p class="text-sm text-muted">${raw(t('settings.openverse.intro'))}</p>
      <label class="mb-1 mt-3 block text-sm font-medium" for="ov-name">${t('settings.openverse.name')}</label>
      <input id="ov-name" name="name" maxlength="150" required value="${opts.suggestedAppName}" class="w-full" />
      <p class="!mb-0 mt-1 text-xs text-muted">${t('settings.openverse.nameHelp')}</p>
      <label class="mb-1 mt-3 block text-sm font-medium" for="ov-desc">${t('settings.openverse.description')}</label>
      <textarea id="ov-desc" name="description" rows="3" required class="w-full">${t('settings.openverse.defaultDescription')}</textarea>
      <label class="mb-1 mt-3 block text-sm font-medium" for="ov-email">${t('settings.openverse.email')}</label>
      <input id="ov-email" name="email" type="email" required autocomplete="email" class="w-full" />
      ${replacing ? raw(html`<label class="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" name="replace" required /> ${t('settings.openverse.replace')}</label>`) : ''}
      <div class="mt-4 flex justify-end gap-2">
        <button type="button" class="btn btn-ghost" data-close-dialog autofocus>${t('settings.openverse.cancel')}</button>
        <button type="submit" class="btn">${t('settings.openverse.submit')}</button>
      </div>
    </form>
  </dialog>`;
}

/** Spend per agent, as bars: shows which one is worth moving to a cheaper model. */
function agentBreakdown(rows: AgentCost[]): string {
  const total = rows.reduce((sum, r) => sum + r.usd, 0);
  if (total === 0) return '';
  const items = rows
    .map((r) => {
      const pct = (r.usd / total) * 100;
      return html`<li class="py-1.5">
        <div class="flex items-baseline justify-between gap-3 text-sm"><span>${t(`settings.cost.agents.${r.agent}`)}</span><span class="tabular-nums text-muted">${formatUsd(r.usd)} · ${Math.round(pct)}%</span></div>
        <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2" aria-hidden="true"><div class="h-full rounded-full ${r.agent === 'unknown' ? 'bg-line-strong' : 'bg-accent'}" style="width:${pct.toFixed(1)}%"></div></div>
      </li>`;
    })
    .join('');
  return html`<div class="mt-4 border-t border-line pt-3">
    <h3 class="m-0 text-sm font-medium">${t('settings.cost.agents.title')}</h3>
    <ul class="m-0 mt-1 list-none p-0">${raw(items)}</ul>
  </div>`;
}

export function settingsPage(opts: SettingsOpts): string {
  const avg = opts.cost.runCount > 0 ? opts.cost.totalUsd / opts.cost.runCount : 0;
  const cost = card(
    's-cost',
    t('settings.cost.title'),
    [
      row(t('settings.cost.total'), html`<strong class="tabular-nums">${formatUsd(opts.cost.totalUsd)}</strong> <span class="text-xs text-muted">${t('settings.cost.runs', { count: opts.cost.runCount })}</span>`),
      row(t('settings.cost.last24h'), html`<span class="tabular-nums">${formatUsd(opts.cost.last24hUsd)}</span>`),
      row(
        t('settings.cost.budget'),
        opts.budget
          ? html`<span class="tabular-nums ${opts.budget.exceeded ? 'font-semibold text-err' : ''}">${t('settings.cost.budgetValue', { spent: formatUsd(opts.budget.spent), limit: formatUsd(opts.budget.limit) })}</span>`
          : html`<span class="text-muted">${t('settings.cost.budgetNone')}</span>`,
      ),
      row(t('settings.cost.avg'), html`<span class="tabular-nums">${formatUsd(avg)}</span>`),
      row(t('settings.cost.tokens'), html`<span class="tabular-nums">${t('settings.cost.tokensValue', { in: formatTokens(opts.cost.totalTokensIn), out: formatTokens(opts.cost.totalTokensOut) })}</span>`),
      ...opts.quotas.map(quotaRow),
    ].join(''),
    agentBreakdown(opts.costByAgent ?? []),
    opts.dailyCost ? costChart(opts.dailyCost, opts.budget?.limit ?? null) : '',
  );

  const promptItems = PROMPT_NAMES.map(
    (n) => html`<li class="border-b border-line py-2 last:border-b-0"><span class="flex flex-wrap items-center gap-2"><a href="/settings/prompts/${n}" class="font-medium">${n}.md</a>${opts.customizedPrompts.includes(n) ? raw(html`<span class="badge badge-info">${t('settings.prompts.customized')}</span>`) : ''}</span>
      <div class="text-xs text-muted">${t(`settings.prompts.info.${n}`)}</div></li>`,
  ).join('');
  const prompts = html`<section class="card settings-section" id="s-prompts" aria-labelledby="s-prompts-h">
    <h2 id="s-prompts-h" class="section-heading !mb-1">${t('settings.prompts.title')}</h2>
    <p class="!mt-0 text-xs text-muted">${t('settings.prompts.intro')}</p>
    <ul class="m-0 list-none p-0">${raw(promptItems)}</ul>
  </section>`;

  const index = html`<section class="card settings-section" id="s-index" aria-labelledby="s-index-h">
    <h2 id="s-index-h" class="section-heading !mb-1">${t('settings.index.title')}</h2>
    <p class="text-sm">${t('settings.index.count', { count: opts.indexedArtifacts })} ${raw(tHtml('settings.index.data', { dir: opts.dataDir }))}</p>
    <p class="text-xs text-muted">${t('settings.index.help')}</p>
    <form method="post" action="/settings/reindex" data-busy="${t('settings.index.reindexing')}"><button type="submit" class="btn btn-ghost btn-sm">${t('settings.index.reindex')}</button></form>
  </section>`;

  const transfer = html`<section class="card settings-section" id="s-transfer" aria-labelledby="s-transfer-h">
    <h2 id="s-transfer-h" class="section-heading !mb-1">${t('settings.transfer.title')}</h2>
    <p class="!mt-0 text-sm">${t('settings.transfer.intro')} <strong>${t('settings.transfer.never')}</strong></p>
    <form method="post" action="/settings/export" class="mb-5"><button type="submit" class="btn btn-ghost">${t('settings.transfer.export')}</button></form>
    <form method="post" action="/settings/import" data-import-form data-import-busy="${t('settings.transfer.importing')}">
      <label for="import-file" class="block text-sm font-medium">${t('settings.transfer.file')}</label>
      <div class="mt-1 flex flex-wrap items-center gap-2">
        <input id="import-file" name="file" type="file" accept=".tar.gz,.tgz,application/gzip" required class="w-full min-w-0 text-sm text-muted sm:w-auto file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-solid file:border-line file:bg-transparent file:px-4 file:py-2 file:text-sm file:font-medium file:text-fg hover:file:bg-panel-2">
        <button type="submit" class="btn btn-ghost shrink-0">${t('settings.transfer.import')}</button>
      </div>
      <p class="!mb-0 mt-1 text-sm text-err" data-import-error role="alert"></p>
    </form>
    <p class="!mb-0 mt-4 text-xs text-muted">${raw(tHtml('settings.transfer.fullBackup', { dir: opts.dataDir }))}</p>
  </section>`;

  const notices = [
    opts.reindexed !== undefined ? flash(t('settings.notices.reindexed', { count: opts.reindexed })) : '',
    opts.saved !== undefined && !opts.group
      ? (opts.saved.length ? flash(t('settings.notices.saved', { keys: opts.saved.join(', ') })) : flash(t('settings.notices.nothing'), 'info'))
      : '',
    opts.openverseRegistered
      ? flash(t('settings.notices.openverse'))
      : '',
    opts.imported?.length ? flash(t('settings.transfer.done', { list: opts.imported.map((p) => t(`settings.transfer.preview.parts.${p}.title`)).join(', ') })) : '',
    opts.errors?.length && !opts.group
      ? flash(t('settings.notices.errors', { list: opts.errors.map((e) => `${e.key} (${e.message})`).join(', ') }), 'err')
      : '',
  ].join('');

  const navItems = [
    ['s-language', t('settings.language.title')],
    ...GROUPS.map((g) => [`g-${g.id}`, t(`settings.groups.${g.id}.title`)]),
    ...(opts.usersHtml ? [['s-users', t('auth.users.title')]] : []),
    ...(opts.activityHtml ? [['s-activity', t('activity.title')]] : []),
    ['s-cost', t('settings.cost.title')],
    ['s-prompts', t('settings.prompts.title')],
    ['s-index', t('settings.index.title')],
    ...(opts.isOwner ? [['s-transfer', t('settings.transfer.title')]] : []),
  ]
    .map(([id, label]) => html`<li><a href="#${id}">${label}</a></li>`)
    .join('');

  const body = html`
    ${raw(pageHeader({ title: t('settings.title') }))}
    ${raw(notices)}
    <div class="settings-layout">
      <nav class="settings-nav" aria-label="${t('settings.nav.label')}">
        <ul>${raw(navItems)}</ul>
      </nav>
      <div class="grid min-w-0 gap-6">
        ${raw(opts.activeJobs > 0 ? html`<div id="env-locked">${raw(flash(t('settings.form.locked', { count: opts.activeJobs }), 'warn'))}</div>` : '')}
        ${raw(languageCard())}
        ${raw(envSections(opts))}
        <p class="!m-0 text-xs text-muted">${raw(tHtml('settings.form.validated', { path: opts.envPath }))}</p>
        ${raw(opts.usersHtml ?? '')}${raw(opts.activityHtml ?? '')}${raw(cost)}${raw(prompts)}${raw(index)}${raw(opts.isOwner ? transfer : '')}
        <p class="!m-0 text-xs text-muted">${raw(t('settings.intro'))}</p>
      </div>
    </div>
    ${raw(opts.isOwner ? openverseRegisterDialog(opts) : '')}
    <script src="/settings.js" defer></script>
  `;

  return layout({ title: t('settings.title'), bodyHtml: body, section: 'settings' });
}

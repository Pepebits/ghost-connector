import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { getConfig } from '../config.js';

/**
 * UI translations. Each language is a folder in locales/ with one JSON
 * per app area (common.json, dashboard.json...); the filename
 * is the key prefix: t('dashboard.title') looks up "title" in
 * locales/<lang>/dashboard.json. Keys can be nested with dots.
 *
 * - Variables: "Hola {name}" + t(key, { name }).
 * - Plurals: an object with the Intl.PluralRules categories
 *   ({ "one": "1 job", "other": "{count} jobs" }) and t(key, { count }).
 * - If a key is missing in the active language, English is used; if it's not
 *   there either, the key is returned (the gap shows instead of breaking the page).
 *
 * To add a language: copy locales/en/ to locales/<code>/ and translate
 * the values. It shows up automatically in the Settings selector.
 */

export const DEFAULT_LOCALE = 'en';
const LOCALES_DIR = new URL('./locales/', import.meta.url);

type Messages = { [key: string]: string | Messages };
const cache = new Map<string, Messages>();

/** Name of each language in its own tongue, for the selector. */
export function localeName(locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale;
    return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
  } catch {
    return locale;
  }
}

export function availableLocales(): string[] {
  return readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => (a === DEFAULT_LOCALE ? -1 : b === DEFAULT_LOCALE ? 1 : a.localeCompare(b)));
}

function load(locale: string): Messages {
  const hit = cache.get(locale);
  if (hit) return hit;
  const dir = new URL(`./${locale}/`, LOCALES_DIR);
  const messages: Messages = {};
  if (existsSync(dir)) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      messages[file.replace(/\.json$/, '')] = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as Messages;
    }
  }
  cache.set(locale, messages);
  return messages;
}

/** Active language: UI_LANGUAGE if that folder exists; otherwise English. */
export function currentLocale(): string {
  const wanted = getConfig().UI_LANGUAGE;
  return availableLocales().includes(wanted) ? wanted : DEFAULT_LOCALE;
}

function lookup(messages: Messages, key: string): string | Messages | undefined {
  let node: string | Messages | undefined = messages;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return node;
}

export type Vars = Record<string, string | number>;

function format(template: string, vars: Vars | undefined, locale: string): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = vars[name];
    if (v === undefined) return m;
    return typeof v === 'number' ? v.toLocaleString(locale) : v;
  });
}

function resolve(node: string | Messages | undefined, vars: Vars | undefined, locale: string): string | undefined {
  if (typeof node === 'string') return format(node, vars, locale);
  if (node && typeof vars?.count === 'number') {
    const category = new Intl.PluralRules(locale).select(vars.count);
    const form = node[category] ?? node.other;
    if (typeof form === 'string') return format(form, vars, locale);
  }
  return undefined;
}

/** Translated text. Returns plain text: views escape it like any other value. */
export function t(key: string, vars?: Vars, locale = currentLocale()): string {
  return (
    resolve(lookup(load(locale), key), vars, locale) ??
    (locale !== DEFAULT_LOCALE ? resolve(lookup(load(DEFAULT_LOCALE), key), vars, DEFAULT_LOCALE) : undefined) ??
    key
  );
}

function deepMerge(base: Messages, own: Messages): Messages {
  const out: Messages = { ...base };
  for (const [k, v] of Object.entries(own)) {
    const b = out[k];
    out[k] = typeof v === 'object' && typeof b === 'object' ? deepMerge(b, v) : v;
  }
  return out;
}

/** All of the language's messages (with English underneath), for the browser (public/*.js uses window.gcT). */
export function clientMessages(locale = currentLocale()): Messages {
  return locale === DEFAULT_LOCALE ? load(DEFAULT_LOCALE) : deepMerge(load(DEFAULT_LOCALE), load(locale));
}

/** For tests and for reloading after editing the JSON. */
export function clearI18nCache(): void {
  cache.clear();
}

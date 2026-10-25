import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { envFilePath, reloadConfig, validateEnv } from '../config.js';
import { availableLocales, t } from '../i18n/index.js';

/**
 * Variables editable from /settings. Those not listed here
 * (DATA_DIR, LOG_LEVEL, IMAGE_GENERATION_*...) stay in .env only:
 * changing them live is unsafe or has no effect without a restart.
 */
export type EnvGroup = 'ghost' | 'ai' | 'images' | 'unsplash' | 'pixabay' | 'pexels' | 'openverse' | 'wikimedia' | 'gsc' | 'bing' | 'behaviour';

export interface EnvField {
  key: string;
  group: EnvGroup;
  /** Secret: never sent to the browser; an empty field keeps the saved value. */
  secret?: boolean;
  /** Optional secret: can be cleared (Unsplash/Pexels). */
  clearable?: boolean;
  type?: 'text' | 'url' | 'number' | 'select' | 'boolean' | 'textarea' | 'order' | 'draftFilter' | 'model';
  options?: string[];
}

/** Field label in the active language (settings.fields.<KEY>.label). */
export function fieldLabel(f: EnvField): string {
  return t(`settings.fields.${f.key}.label`);
}

/** Field help in the active language, if any. */
export function fieldHelp(f: EnvField): string | undefined {
  const key = `settings.fields.${f.key}.help`;
  const text = t(key);
  return text === key ? undefined : text;
}

export const ENV_FIELDS: EnvField[] = [
  { key: 'GHOST_API_URL', group: 'ghost', type: 'url' },
  { key: 'GHOST_ADMIN_API_KEY', group: 'ghost', secret: true },
  { key: 'GHOST_API_VERSION', group: 'ghost' },
  { key: 'AI_PROVIDER', group: 'ai', type: 'select', options: ['deepseek', 'anthropic', 'openai-compatible'] },
  { key: 'AI_BASE_URL', group: 'ai', type: 'url' },
  { key: 'AI_API_KEY', group: 'ai', secret: true },
  { key: 'AI_MODEL', group: 'ai', type: 'model' },
  { key: 'AI_MAX_TOKENS', group: 'ai', type: 'number' },
  { key: 'AI_MODEL_WRITER', group: 'ai', type: 'model' },
  { key: 'AI_MODEL_SEO', group: 'ai', type: 'model' },
  { key: 'AI_MODEL_IMAGE', group: 'ai', type: 'model' },
  { key: 'AI_MODEL_RESOLVE', group: 'ai', type: 'model' },
  { key: 'AI_PRICES', group: 'ai' },
  { key: 'AI_DAILY_BUDGET_USD', group: 'ai', type: 'number' },
  { key: 'AI_USER_DAILY_BUDGET_USD', group: 'ai', type: 'number' },
  { key: 'IMAGE_SOURCES_ORDER', group: 'images', type: 'order', options: ['unsplash', 'pixabay', 'pexels', 'openverse', 'wikimedia'] },
  { key: 'UNSPLASH_ACCESS_KEY', group: 'unsplash', secret: true, clearable: true },
  { key: 'UNSPLASH_APP_NAME', group: 'unsplash' },
  { key: 'PIXABAY_API_KEY', group: 'pixabay', secret: true, clearable: true },
  { key: 'PEXELS_API_KEY', group: 'pexels', secret: true, clearable: true },
  { key: 'OPENVERSE_ENABLED', group: 'openverse', type: 'boolean' },
  // The client_id is public (identifies the app, like a username); the secret is the client_secret.
  { key: 'OPENVERSE_CLIENT_ID', group: 'openverse' },
  { key: 'OPENVERSE_CLIENT_SECRET', group: 'openverse', secret: true, clearable: true },
  { key: 'OPENVERSE_LICENSES', group: 'openverse' },
  { key: 'WIKIMEDIA_ENABLED', group: 'wikimedia', type: 'boolean' },
  { key: 'WIKIMEDIA_LICENSES', group: 'wikimedia' },
  { key: 'GSC_SITE_URL', group: 'gsc' },
  { key: 'GSC_SERVICE_ACCOUNT', group: 'gsc', secret: true, clearable: true },
  { key: 'BING_SITE_URL', group: 'bing' },
  { key: 'BING_API_KEY', group: 'bing', secret: true, clearable: true },
  { key: 'UI_LANGUAGE', group: 'behaviour', type: 'select', options: availableLocales() },
  { key: 'CONTENT_STRATEGY', group: 'behaviour', type: 'select', options: ['html', 'lexical'] },
  { key: 'DRAFT_FILTER', group: 'behaviour', type: 'draftFilter' },
  { key: 'MAX_POSTS_PER_RUN', group: 'behaviour', type: 'number' },
  { key: 'CONCURRENCY', group: 'behaviour', type: 'number' },
  { key: 'TARGET_WORD_COUNT', group: 'behaviour', type: 'number' },
  { key: 'ALLOW_SLUG_CHANGE', group: 'behaviour', type: 'boolean' },
  { key: 'INTERNAL_LINKS', group: 'behaviour', type: 'boolean' },
  { key: 'AUTO_PLAN_TIME', group: 'behaviour' },
  { key: 'AUTO_PLAN_MAX', group: 'behaviour', type: 'number' },
  { key: 'GITHUB_TOKEN', group: 'behaviour', secret: true, clearable: true },
  { key: 'SITE_CONTEXT', group: 'behaviour', type: 'textarea' },
];

const FIELD_BY_KEY = new Map(ENV_FIELDS.map((f) => [f.key, f]));

export { envFilePath };

/** What the form receives: one value per key; for secrets, "" = keep. */
export type EnvSubmission = Record<string, string | undefined>;

/**
 * Owner only: the keys, where they are sent (changing an endpoint would be
 * enough to make the panel hand a key to another server) and what bounds the
 * spend on the owner's AI account (daily cap and prices).
 */
export const OWNER_ONLY_KEYS = new Set(['GHOST_API_URL', 'AI_PROVIDER', 'AI_BASE_URL', 'AI_DAILY_BUDGET_USD', 'AI_USER_DAILY_BUDGET_USD', 'AI_PRICES']);
export const isOwnerOnlyField = (f: { key: string; secret?: boolean }) => !!f.secret || OWNER_ONLY_KEYS.has(f.key);

export class EnvValidationError extends Error {
  constructor(public readonly issues: Array<{ key: string; message: string }>) {
    super(issues.map((i) => `${i.key}: ${i.message}`).join('; '));
  }
}

/**
 * Converts the submission into the changes to apply. Known keys only; an
 * empty secret changes nothing, and `clear_<KEY>` clears an optional secret.
 */
export function resolveUpdates(submission: EnvSubmission): Record<string, string> {
  const updates: Record<string, string> = {};
  // Settings saves one section at a time (__group=<id>): only that group's fields count.
  const group = submission.__group;
  for (const field of ENV_FIELDS) {
    if (group && field.group !== group) continue;
    let value = submission[field.key];
    // An unchecked checkbox is not sent in the form: "absent" only
    // means "false" if the whole form (__full=1) or that field's section
    // (__group) was submitted. Other partial saves (e.g. Openverse
    // registration) do not touch booleans.
    if (field.type === 'boolean') {
      if (submission.__full !== '1' && !group) continue;
      value = submission[field.key] === 'true' ? 'true' : 'false';
    }
    if (field.clearable && submission[`clear_${field.key}`] === 'on') {
      updates[field.key] = '';
      continue;
    }
    // Model pickers: "Other…" sends the typed name in <KEY>__custom.
    if (field.type === 'model' && value === '__other') value = submission[`${field.key}__custom`] ?? '';
    if (value === undefined) continue;
    value = value.trim();
    if (field.secret && value === '') continue;
    // A newline would allow smuggling another variable into the .env.
    if (/[\r\n\0]/.test(value)) throw new EnvValidationError([{ key: field.key, message: t('settings.errors.newline') }]);
    updates[field.key] = value;
  }
  return updates;
}

/** Environment resulting from applying `updates` over the current one (without modifying it). */
export function mergedEnv(updates: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env, ...updates };
  // Empty optional fields: better absent than "" (zod defaults only apply to undefined).
  for (const [k, v] of Object.entries(updates)) if (v === '' && !FIELD_BY_KEY.get(k)?.clearable) delete env[k];
  return env;
}

/**
 * A value as dotenv reads it back unchanged. dotenv has no escapes (apart from
 * \n in double quotes), so the quote style is picked to fit the value:
 * single quotes are fully literal, then double quotes, then backticks.
 */
export function quote(value: string, key = '?'): string {
  if (/[\r\n\0]/.test(value)) throw new EnvValidationError([{ key, message: t('settings.errors.newline') }]);
  if (value === '' || /^[A-Za-z0-9_.:/@+,=-]+$/.test(value)) return value;
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"') && !value.includes('\\')) return `"${value}"`;
  if (!value.includes('`')) return `\`${value}\``;
  throw new EnvValidationError([{ key, message: t('settings.errors.quotes') }]);
}

/**
 * Rewrites the .env preserving comments, order and untouched
 * variables. Replaces each key's line (and that of its old DEEPSEEK_*
 * alias if present, which is removed) and appends the missing ones at the end.
 */
export function rewriteEnv(content: string, updates: Record<string, string>): string {
  const pending = new Map(Object.entries(updates));
  const legacy = new Set(['DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MAX_TOKENS']);
  const touchesAi = Object.keys(updates).some((k) => k.startsWith('AI_'));
  const out: string[] = [];
  const lines = content.split('\n');
  const assignment = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
  // `# KEY=…` as in .env.example: a key set from the panel is uncommented in
  // place (next to its explanation) instead of appended at the end, unless the
  // file also has an active KEY= line, which wins.
  const commented = /^\s*#\s*([A-Z][A-Z0-9_]*)=/;
  const active = new Set(lines.map((l) => assignment.exec(l)?.[1]).filter(Boolean));
  const written = new Set<string>();
  for (const line of lines) {
    const m = assignment.exec(line);
    const key = m?.[1] ?? ((c) => (c && !active.has(c) ? c : undefined))(commented.exec(line)?.[1]);
    if (key && pending.has(key)) {
      out.push(`${key}=${quote(pending.get(key)!, key)}`);
      pending.delete(key);
      written.add(key);
    } else if (m && key && written.has(key)) {
      // A second active KEY= (pasted twice) would override the value just saved: dropped.
      continue;
    } else if (key && touchesAi && legacy.has(key)) {
      continue;
    } else {
      out.push(line);
    }
  }
  while (out.length > 0 && out.at(-1) === '') out.pop();
  for (const [k, v] of pending) out.push(`${k}=${quote(v, k)}`);
  return `${out.join('\n')}\n`;
}

/**
 * Validates, writes the .env (atomic, 0600) and hot-reloads the config.
 * If validation fails nothing is written. Returns the changed keys.
 */
export function saveEnv(submission: EnvSubmission, path = envFilePath()): string[] {
  const updates = resolveUpdates(submission);
  const check = validateEnv(mergedEnv(updates));
  if (!check.ok) throw new EnvValidationError(check.issues);

  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const changed = Object.keys(updates).filter((k) => (process.env[k] ?? '') !== updates[k]);
  if (changed.length === 0) return [];

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, rewriteEnv(current, updates), { mode: 0o600 });
  renameSync(tmp, path);
  chmodSync(path, 0o600);

  for (const [k, v] of Object.entries(updates)) {
    if (v === '' && !FIELD_BY_KEY.get(k)?.clearable) delete process.env[k];
    else process.env[k] = v;
  }
  reloadConfig();
  return changed;
}

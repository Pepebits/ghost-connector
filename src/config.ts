import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Where config and data live:
 * - GHOST_CONNECTOR_HOME, if set: <home>/config.env and <home>/data.
 * - "Repo mode": there is a .env in the current directory (repo clone):
 *   ./.env and ./.data.
 * - Otherwise (installed as a package): ~/.config/ghost-connector (or
 *   $XDG_CONFIG_HOME/ghost-connector) with config.env and data/.
 */
export function resolveAppHome(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): { mode: 'repo' | 'home'; envFile: string; dataDir: string; home: string } {
  if (env.GHOST_CONNECTOR_HOME) {
    const home = resolve(env.GHOST_CONNECTOR_HOME);
    return { mode: 'home', home, envFile: join(home, 'config.env'), dataDir: join(home, 'data') };
  }
  if (existsSync(join(cwd, '.env'))) return { mode: 'repo', home: cwd, envFile: join(cwd, '.env'), dataDir: '.data' };
  const home = join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'ghost-connector');
  return { mode: 'home', home, envFile: join(home, 'config.env'), dataDir: join(home, 'data') };
}

export const APP_HOME = resolveAppHome();
// quiet: dotenv 17+ prints "injected env" on every load, which would clutter every command and log.
loadDotenv({ path: APP_HOME.envFile, quiet: true });

/** The config file it reads (and that the Settings page edits). */
export function envFilePath(): string {
  return APP_HOME.envFile;
}

export const IMAGE_SOURCES = ['unsplash', 'pixabay', 'pexels', 'openverse', 'wikimedia'] as const;

export const AI_PROVIDERS = ['deepseek', 'anthropic', 'openai-compatible'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
/** Default URL and model for each provider ('' = must be provided). */
export const AI_DEFAULTS: Record<AiProvider, { baseUrl: string; model: string }> = {
  deepseek: { baseUrl: 'https://api.deepseek.com/beta', model: 'deepseek-flash' },
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5' },
  'openai-compatible': { baseUrl: '', model: '' },
};

/** "" in the .env counts as "no value" (zod defaults only apply to undefined). */
const optionalText = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().optional());

/** "model=input/output,..." -> map; null if the format is invalid. */
export function parsePrices(value: string): Map<string, { input: number; output: number }> | null {
  const out = new Map<string, { input: number; output: number }>();
  for (const part of value.split(',').map((p) => p.trim()).filter(Boolean)) {
    const m = /^([^=\s]+)\s*=\s*([0-9.]+)\s*\/\s*([0-9.]+)$/.exec(part);
    if (!m) return null;
    out.set(m[1]!, { input: Number(m[2]), output: Number(m[3]) });
  }
  return out;
}
export type ImageSource = (typeof IMAGE_SOURCES)[number];

const ConfigSchema = z.object({
  GHOST_API_URL: z.string().url().transform((v) => v.replace(/\/+$/, '')),
  GHOST_ADMIN_API_KEY: z.string().regex(/^[a-f0-9]{24}:[a-f0-9]{64}$/i, 'expected format id:secret'),
  GHOST_API_VERSION: z.string().default('v6.0'),

  // AI provider (src/agents/providers): 'deepseek' (default),
  // 'anthropic' (Claude) or 'openai-compatible' (OpenAI, OpenRouter, Groq,
  // Ollama...; requires AI_BASE_URL and AI_MODEL). Model and URL have a default
  // depending on the provider.
  AI_PROVIDER: z.enum(AI_PROVIDERS).default('deepseek'),
  AI_API_KEY: z.string().min(1),
  AI_MODEL: optionalText,
  // On DeepSeek, .../beta enables "strict" tool calling (guaranteed schema)
  AI_BASE_URL: optionalText.pipe(z.string().url().optional()),
  AI_MAX_TOKENS: z.coerce.number().int().positive().default(8000),
  // A different model per agent (optional; otherwise AI_MODEL). E.g. a
  // good one for writing and a cheap one for SEO.
  AI_MODEL_WRITER: optionalText,
  AI_MODEL_SEO: optionalText,
  AI_MODEL_IMAGE: optionalText,
  AI_MODEL_RESOLVE: optionalText,
  // Prices in USD per million tokens, "model=input/output" separated
  // by commas. Those not listed (nor in the table in src/agents/pricing.ts)
  // show up as "unknown cost" instead of a made-up number.
  // Daily cap in USD on AI spending (last 24 h); 0 = no cap.
  AI_DAILY_BUDGET_USD: z.coerce.number().min(0).default(0),
  // Per-user cap over the last 24 h (0 = none); automatic work (nightly plan, CLI) only counts toward AI_DAILY_BUDGET_USD.
  AI_USER_DAILY_BUDGET_USD: z.coerce.number().min(0).default(0),
  AI_PRICES: z.string().default('').refine((v) => parsePrices(v) !== null, 'format: model=input/output, comma-separated (e.g. gpt-4o-mini=0.15/0.6)'),

  UNSPLASH_ACCESS_KEY: z.string().optional().default(''),
  UNSPLASH_APP_NAME: z.string().default('ghost-connector'),

  // Fallback when Unsplash exhausts its quota (50 req/hour in Demo mode).
  // Pexels limit: 200 req/hour on its free tier.
  PEXELS_API_KEY: z.string().optional().default(''),
  // Pixabay: free key on sign-up, 100 requests/minute.
  PIXABAY_API_KEY: z.string().optional().default(''),

  // Order in which stock sources are tried (missing ones are skipped).
  IMAGE_SOURCES_ORDER: z
    .string()
    .default('unsplash,pixabay,pexels,openverse,wikimedia')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
    .refine((list) => list.length > 0 && list.every((s) => IMAGE_SOURCES.includes(s as ImageSource)) && new Set(list).size === list.length, 'list without duplicates of: unsplash, pixabay, pexels, openverse, wikimedia'),

  // Third stock source, keyless (200 requests/day without credentials).
  // Only licenses that allow commercial use and modification.
  OPENVERSE_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  // Optional OAuth2 credentials (client_credentials): more quota than anonymous access.
  OPENVERSE_CLIENT_ID: z.string().optional().default(''),
  OPENVERSE_CLIENT_SECRET: z.string().optional().default(''),
  OPENVERSE_LICENSES: z
    .string()
    .default('cc0,pdm,by')
    .refine((v) => v.split(',').every((l) => ['cc0', 'pdm', 'by', 'by-sa'].includes(l.trim())), 'only cc0, pdm, by or by-sa (the ones that allow commercial use and modification)'),

  // Wikimedia Commons (Wikipedia's images): keyless. Same license choice as Openverse.
  WIKIMEDIA_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  WIKIMEDIA_LICENSES: z
    .string()
    .default('cc0,pdm,by')
    .refine((v) => v.split(',').every((l) => ['cc0', 'pdm', 'by', 'by-sa'].includes(l.trim())), 'only cc0, pdm, by or by-sa (the ones that allow commercial use and modification)'),

  // The writer may link 1-3 related posts already published on the blog.
  INTERNAL_LINKS: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),

  // Nightly plan: "HH:MM" (local time) to plan new drafts once a day; empty = off.
  AUTO_PLAN_TIME: z
    .string()
    .optional()
    .default('')
    .refine((v) => v === '' || /^([01]?\d|2[0-3]):[0-5]\d$/.test(v.trim()), 'HH:MM, e.g. 07:00'),
  // At most this many drafts per night (its own brake, besides AI_DAILY_BUDGET_USD).
  AUTO_PLAN_MAX: z.coerce.number().int().min(1).max(50).default(3),

  // Google Search Console (topic ideas page): property ("sc-domain:example.com" or
  // "https://example.com/") and a service account key (JSON, or path to the file).
  GSC_SITE_URL: z.string().optional().default(''),
  GSC_SERVICE_ACCOUNT: z.string().optional().default(''),
  BING_SITE_URL: z.string().optional().default(''),
  BING_API_KEY: z.string().optional().default(''),

  // Optional: raises the GitHub API limit (60/hour without a token) when reading
  // sources from github.com. A token with no permissions is enough (public read only).
  GITHUB_TOKEN: z.string().optional().default(''),

  IMAGE_GENERATION_PROVIDER: z.enum(['none']).or(z.string()).default('none'),
  IMAGE_GENERATION_API_KEY: z.string().optional().default(''),
  IMAGE_GENERATION_ENDPOINT: z.string().optional().default(''),

  CONTENT_STRATEGY: z.enum(['html', 'lexical']).default('html'),
  DRAFT_FILTER: z.string().default('status:draft'),
  MAX_POSTS_PER_RUN: z.coerce.number().int().positive().default(5),
  CONCURRENCY: z.coerce.number().int().positive().default(2),
  ALLOW_SLUG_CHANGE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  TARGET_WORD_COUNT: z.coerce.number().int().positive().default(1200),
  SITE_CONTEXT: z.string().default(''),
  // UI language (folder in src/i18n/locales). Does not change the language of the posts.
  UI_LANGUAGE: z.string().default('en'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // Runs, SQLite index, edited prompts and locks.
  DATA_DIR: z.string().default(APP_HOME.dataDir),

  TEST_POST_ID: z.string().optional().default(''),
});

const ConfigWithDefaults = ConfigSchema.superRefine((cfg, ctx) => {
  if (cfg.AI_PROVIDER === 'openai-compatible') {
    if (!cfg.AI_BASE_URL) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['AI_BASE_URL'], message: 'required with AI_PROVIDER=openai-compatible' });
    if (!cfg.AI_MODEL) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['AI_MODEL'], message: 'required with AI_PROVIDER=openai-compatible' });
  }
}).transform((cfg) => ({
  ...cfg,
  AI_BASE_URL: cfg.AI_BASE_URL ?? AI_DEFAULTS[cfg.AI_PROVIDER].baseUrl,
  AI_MODEL: cfg.AI_MODEL ?? AI_DEFAULTS[cfg.AI_PROVIDER].model,
}));

export type Config = z.infer<typeof ConfigWithDefaults>;

/** Old names (DeepSeek only) -> new ones. Accepted so existing .env files don't break. */
const LEGACY_ENV: Record<string, string> = {
  DEEPSEEK_API_KEY: 'AI_API_KEY',
  DEEPSEEK_MODEL: 'AI_MODEL',
  DEEPSEEK_BASE_URL: 'AI_BASE_URL',
  DEEPSEEK_MAX_TOKENS: 'AI_MAX_TOKENS',
};

/** Copies each old variable to its new name if the latter is not set. Returns the ones used. */
export function applyLegacyEnv(env: NodeJS.ProcessEnv): string[] {
  const used: string[] = [];
  for (const [oldName, newName] of Object.entries(LEGACY_ENV)) {
    if (env[oldName] !== undefined && env[newName] === undefined) {
      env[newName] = env[oldName];
      used.push(oldName);
    }
  }
  return used;
}

let cached: Config | null = null;
const reloadListeners: Array<() => void> = [];

/** For modules with cached clients (Ghost, AI): called when the config is reloaded. */
export function onConfigReload(fn: () => void): void {
  reloadListeners.push(fn);
}

/** Forgets the cached config (and the clients depending on it); the next getConfig() re-reads process.env. */
export function reloadConfig(): void {
  cached = null;
  for (const fn of reloadListeners) fn();
}

/** Validates a candidate environment without touching the active config. Returns errors per variable. */
export function validateEnv(env: NodeJS.ProcessEnv): { ok: true; config: Config } | { ok: false; issues: Array<{ key: string; message: string }> } {
  const parsed = ConfigWithDefaults.safeParse(env);
  if (parsed.success) return { ok: true, config: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((i) => ({ key: i.path.join('.'), message: i.message })) };
}

export function getConfig(): Config {
  if (cached) return cached;
  const legacy = applyLegacyEnv(process.env);
  if (legacy.length > 0) {
    // console and not the logger: the logger depends on this same config.
    console.warn(`[config] Legacy variables in use: ${legacy.join(', ')}. Rename them to AI_* (see .env.example).`);
  }
  const parsed = ConfigWithDefaults.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid configuration. Check ${APP_HOME.envFile} (copy .env.example if it does not exist; GHOST_CONNECTOR_HOME changes the folder):\n${issues}`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** Safe identifier for logs: never exposes the Admin API Key secret. */
export function ghostKeyId(adminKey: string): string {
  return adminKey.split(':')[0] ?? 'unknown';
}

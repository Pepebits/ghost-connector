import OpenAI from 'openai';
import { searchAnalytics } from '../research/searchConsole.js';
import { bingQueryStats } from '../research/bingWebmaster.js';
import { WIKIMEDIA_USER_AGENT } from '../images/wikimedia.provider.js';
import { AI_DEFAULTS, getConfig, type AiProvider } from '../config.js';
import { ghostAuthHeaders } from '../ghost/auth.js';
import { draftsOnly } from '../ghost/draftFilter.js';
import { isDeepSeek } from '../agents/providers/index.js';
import { openverseRateLimit, requestOpenverseToken } from '../images/openverseAuth.js';
import { t } from '../i18n/index.js';
import { mergedEnv, resolveUpdates, type EnvSubmission } from './envFile.js';

export type TestableService = 'ghost' | 'ai' | 'unsplash' | 'pixabay' | 'pexels' | 'openverse' | 'wikimedia' | 'gsc' | 'bing' | 'drafts';

export interface ConnectionResult {
  ok: boolean;
  message: string;
  ms: number;
}

const TIMEOUT_MS = 10_000;

export function isTestableService(value: string): value is TestableService {
  return value === 'ghost' || value === 'ai' || value === 'unsplash' || value === 'pixabay' || value === 'pexels' || value === 'openverse' || value === 'wikimedia' || value === 'gsc' || value === 'bing' || value === 'drafts';
}

/** An API error message may echo the key sent: it is masked before returning it. */
function redact(message: string, secrets: Array<string | undefined>): string {
  let out = message;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join('••••');
  return out.slice(0, 300);
}

async function httpCheck(url: string, init: RequestInit): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { status: res.status, body: await res.text() };
}

function statusMessage(status: number, body: string): string {
  if (status === 401 || status === 403) return t('connection.rejected', { status: String(status) });
  if (status === 404) return t('connection.notFound');
  return t('connection.http', { status: String(status), body: body.slice(0, 160) });
}

/**
 * Tests the connection with the form values (even if not
 * saved); an empty secret uses the saved one. Read-only: writes
 * nothing to any service. The AI test makes a minimal call (1 token).
 */
/**
 * Environment to test with: the form values over the saved config, without
 * reusing a saved key against a different host than the one it belongs to.
 */
function testEnv(submission: EnvSubmission): { env: NodeJS.ProcessEnv; updates: Record<string, string> } {
  const updates = resolveUpdates(submission);
  const env = mergedEnv(updates);
  // A saved key is only reused against the SAME host it belongs to:
  // if the URL is changed and no new key is entered, the old one is
  // not sent to a different server.
  const norm = (u: string | undefined) => (u ?? '').replace(/\/+$/, '');
  if (norm(updates.GHOST_API_URL ?? process.env.GHOST_API_URL) !== norm(process.env.GHOST_API_URL) && !('GHOST_ADMIN_API_KEY' in updates)) delete env.GHOST_ADMIN_API_KEY;
  // No valid config yet (first start, `setup`): there is no saved key to protect.
  let savedAiBase = '';
  try {
    savedAiBase = norm(getConfig().AI_BASE_URL);
  } catch {
    savedAiBase = '';
  }
  const testAiBase = norm(env.AI_BASE_URL || (AI_DEFAULTS[(env.AI_PROVIDER ?? 'deepseek') as AiProvider]?.baseUrl ?? ''));
  if (testAiBase !== savedAiBase && !('AI_API_KEY' in updates)) delete env.AI_API_KEY;
  return { env, updates };
}

/**
 * Model ids the configured AI provider offers (GET /models), for the model
 * pickers in Settings. Uses the form values like the connection test. On any
 * failure returns an error and the UI falls back to typing the name.
 */
export async function listAiModels(submission: EnvSubmission): Promise<{ ok: boolean; models: string[]; message?: string }> {
  const { env } = testEnv(submission);
  const provider = (env.AI_PROVIDER ?? 'deepseek') as AiProvider;
  const baseURL = (env.AI_BASE_URL || (AI_DEFAULTS[provider] ?? AI_DEFAULTS.deepseek).baseUrl).replace(/\/+$/, '');
  if (!env.AI_API_KEY) return { ok: false, models: [], message: t('connection.ai.noKey') };
  if (!baseURL) return { ok: false, models: [], message: t('connection.ai.noBaseUrl') };
  const secrets = [env.AI_API_KEY];
  try {
    const url = provider === 'anthropic' ? `${baseURL}/v1/models?limit=100` : `${baseURL}/models`;
    const headers: Record<string, string> =
      provider === 'anthropic' ? { 'x-api-key': env.AI_API_KEY, 'anthropic-version': '2023-06-01' } : { authorization: `Bearer ${env.AI_API_KEY}` };
    let { status, body } = await httpCheck(url, { headers });
    // Some base URLs carry an extra segment the model list doesn't live under
    // (DeepSeek: /beta/models is 404, /models works): retry one level up.
    if (status === 404 && provider !== 'anthropic') {
      const parent = baseURL.replace(/\/[^/]+$/, '');
      if (parent !== baseURL && /^https?:\/\/[^/]+/.test(parent)) ({ status, body } = await httpCheck(`${parent}/models`, { headers }));
    }
    if (status !== 200) return { ok: false, models: [], message: redact(statusMessage(status, body), secrets) };
    const data = JSON.parse(body) as { data?: Array<{ id?: string }> };
    const models = [...new Set((data.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string' && id.length > 0))].sort();
    return { ok: true, models };
  } catch (err) {
    return { ok: false, models: [], message: redact(err instanceof Error ? err.message : String(err), secrets) };
  }
}

export async function testConnection(service: TestableService, submission: EnvSubmission): Promise<ConnectionResult> {
  const { env } = testEnv(submission);
  const started = Date.now();
  const secrets = [env.OPENVERSE_CLIENT_SECRET, env.GHOST_ADMIN_API_KEY, env.GHOST_ADMIN_API_KEY?.split(':')[1], env.AI_API_KEY, env.UNSPLASH_ACCESS_KEY, env.PEXELS_API_KEY, env.PIXABAY_API_KEY, env.GSC_SERVICE_ACCOUNT, env.BING_API_KEY, env.GITHUB_TOKEN];
  const done = (ok: boolean, message: string): ConnectionResult => ({ ok, message: redact(message, secrets), ms: Date.now() - started });

  try {
    if (service === 'ghost') {
      const base = (env.GHOST_API_URL ?? '').replace(/\/+$/, '');
      if (!base) return done(false, t('connection.ghost.noUrl'));
      if (!env.GHOST_ADMIN_API_KEY) return done(false, t('connection.ghost.noKey'));
      if (!/^[a-f0-9]{24}:[a-f0-9]{64}$/i.test(env.GHOST_ADMIN_API_KEY)) return done(false, t('connection.ghost.badKey'));
      const { status, body } = await httpCheck(`${base}/ghost/api/admin/site/`, {
        headers: ghostAuthHeaders(env.GHOST_ADMIN_API_KEY!, env.GHOST_API_VERSION ?? 'v6.0'),
      });
      if (status !== 200) return done(false, statusMessage(status, body));
      // /site responds even if the key is invalid; the key is checked with an authenticated endpoint.
      const auth = await httpCheck(`${base}/ghost/api/admin/posts/?limit=1&fields=id&filter=status:draft`, {
        headers: ghostAuthHeaders(env.GHOST_ADMIN_API_KEY!, env.GHOST_API_VERSION ?? 'v6.0'),
      });
      if (auth.status !== 200) return done(false, statusMessage(auth.status, auth.body));
      const title = (JSON.parse(body) as { site?: { title?: string } }).site?.title;
      return done(true, t('connection.ghost.ok', { title: title ?? base }));
    }

    if (service === 'drafts') {
      const base = (env.GHOST_API_URL ?? '').replace(/\/+$/, '');
      if (!base || !env.GHOST_ADMIN_API_KEY) return done(false, t('connection.drafts.noGhost'));
      const filter = draftsOnly(env.DRAFT_FILTER ?? 'status:draft');
      const url = new URL(`${base}/ghost/api/admin/posts/`);
      url.searchParams.set('filter', filter);
      url.searchParams.set('limit', '3');
      url.searchParams.set('fields', 'title');
      url.searchParams.set('order', 'updated_at DESC');
      const { status, body } = await httpCheck(url.toString(), { headers: ghostAuthHeaders(env.GHOST_ADMIN_API_KEY, env.GHOST_API_VERSION ?? 'v6.0') });
      if (status === 400 || status === 422) return done(false, t('connection.drafts.badFilter', { body: body.slice(0, 200) }));
      if (status !== 200) return done(false, statusMessage(status, body));
      const data = JSON.parse(body) as { posts: Array<{ title: string }>; meta?: { pagination?: { total?: number } } };
      const total = data.meta?.pagination?.total ?? data.posts.length;
      if (total === 0) return done(true, t('connection.drafts.none'));
      const sample = data.posts.map((p) => `"${p.title}"`).join(', ');
      return done(true, t('connection.drafts.ok', { count: total, sample, more: total > data.posts.length ? '…' : '' }));
    }

    if (service === 'ai') {
      const provider = (env.AI_PROVIDER ?? 'deepseek') as AiProvider;
      const defaults = AI_DEFAULTS[provider] ?? AI_DEFAULTS.deepseek;
      const baseURL = env.AI_BASE_URL || defaults.baseUrl;
      if (!env.AI_API_KEY) return done(false, t('connection.ai.noKey'));
      if (!baseURL) return done(false, t('connection.ai.noBaseUrl'));
      const model = env.AI_MODEL || defaults.model;
      if (!model) return done(false, t('connection.ai.noModel'));
      if (provider === 'anthropic') {
        const { status, body } = await httpCheck(`${baseURL.replace(/\/+$/, '')}/v1/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': env.AI_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
        });
        if (status !== 200) {
          let msg = statusMessage(status, body);
          try {
            msg = `${msg}: ${(JSON.parse(body) as { error?: { message?: string } }).error?.message ?? ''}`;
          } catch {
            /* non-JSON body */
          }
          return done(false, msg);
        }
        return done(true, t('connection.ai.ok', { model, provider: 'anthropic' }));
      }
      const client = new OpenAI({ apiKey: env.AI_API_KEY, baseURL, maxRetries: 0, timeout: TIMEOUT_MS });
      const res = await client.chat.completions.create({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
        ...(isDeepSeek(provider, baseURL) ? { thinking: { type: 'disabled' } } : {}),
      } as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
      return done(true, t('connection.ai.ok', { model: res.model || model, provider }));
    }

    if (service === 'unsplash') {
      if (!env.UNSPLASH_ACCESS_KEY) return done(false, t('connection.unsplash.noKey'));
      const { status, body } = await httpCheck('https://api.unsplash.com/search/photos?query=code&per_page=1', {
        headers: { Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}`, 'Accept-Version': 'v1' },
      });
      return status === 200 ? done(true, t('connection.unsplash.ok')) : done(false, statusMessage(status, body));
    }

    if (service === 'openverse' && env.OPENVERSE_CLIENT_ID && env.OPENVERSE_CLIENT_SECRET) {
      const { token } = await requestOpenverseToken(env.OPENVERSE_CLIENT_ID, env.OPENVERSE_CLIENT_SECRET);
      const rl = await openverseRateLimit(token);
      const used = rl.requestsToday !== null ? t('connection.openverse.usedToday', { count: rl.requestsToday }) : '';
      const verified = rl.verified === false ? t('connection.openverse.unverified') : '';
      return done(true, t('connection.openverse.ok', { model: rl.model, used, verified }));
    }

    if (service === 'openverse') {
      const licenses = env.OPENVERSE_LICENSES || 'cc0,pdm,by';
      const res = await fetch(`https://api.openverse.org/v1/images/?q=code&page_size=1&license=${encodeURIComponent(licenses)}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status !== 200) return done(false, statusMessage(res.status, await res.text()));
      const left = res.headers.get('x-ratelimit-available-anon_sustained');
      return done(true, left ? t('connection.openverse.anonLeft', { left }) : t('connection.openverse.anon'));
    }

    if (service === 'gsc') {
      if (!env.GSC_SITE_URL || !env.GSC_SERVICE_ACCOUNT) return done(false, t('connection.gsc.missing'));
      const rows = await searchAnalytics(7, env.GSC_SITE_URL, env.GSC_SERVICE_ACCOUNT);
      return done(true, t('connection.gsc.ok', { count: rows.length }));
    }

    if (service === 'bing') {
      if (!env.BING_SITE_URL || !env.BING_API_KEY) return done(false, t('connection.bing.missing'));
      const rows = await bingQueryStats(90, env.BING_SITE_URL, env.BING_API_KEY);
      return done(true, t('connection.bing.ok', { count: rows.length }));
    }

    if (service === 'wikimedia') {
      const { status, body } = await httpCheck('https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srnamespace=6&srlimit=1&srsearch=code', {
        headers: { 'User-Agent': WIKIMEDIA_USER_AGENT, 'Api-User-Agent': WIKIMEDIA_USER_AGENT },
      });
      return status === 200 ? done(true, t('connection.wikimedia.ok')) : done(false, statusMessage(status, body));
    }

    if (service === 'pixabay') {
      if (!env.PIXABAY_API_KEY) return done(false, t('connection.pixabay.noKey'));
      const { status, body } = await httpCheck(`https://pixabay.com/api/?key=${encodeURIComponent(env.PIXABAY_API_KEY)}&q=code&per_page=3`, {});
      return status === 200 ? done(true, t('connection.pixabay.ok')) : done(false, statusMessage(status, body));
    }

    if (!env.PEXELS_API_KEY) return done(false, t('connection.pexels.noKey'));
    const { status, body } = await httpCheck('https://api.pexels.com/v1/search?query=code&per_page=1', {
      headers: { Authorization: env.PEXELS_API_KEY },
    });
    return status === 200 ? done(true, t('connection.pexels.ok')) : done(false, statusMessage(status, body));
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403) return done(false, t('connection.rejected', { status: String(status) }));
    const msg = err instanceof Error ? (err.name === 'TimeoutError' ? t('connection.timeout', { s: TIMEOUT_MS / 1000 }) : err.message) : String(err);
    return done(false, msg);
  }
}

import { ghostRawRequest } from '../ghost/client.js';
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { readFile } from 'node:fs/promises';
import { isPromptCustomized, isPromptName, PROMPT_NAMES, listPromptRevisions, loadPrompt, overridesDir, resetPromptToFactory, revertPrompt, savePrompt } from '../agents/prompts.js';
import { APP_HOME, envFilePath, getConfig, ghostKeyId, IMAGE_SOURCES } from '../config.js';
import {
  countJobEventsByLevel,
  getJob,
  interruptOrphanedJobs,
  isJobType,
  listJobEvents,
  listJobs,
  TERMINAL_JOB_STATES,
  type JobEventRecord,
  type JobStateFilter,
  deleteFinishedJobs,
} from '../db/jobs.js';
import { clearArtifactIndex, countIndexedArtifacts, getCostSummary, getCostByAgent, getDailyCost, getProviderQuotas, getReviewStats, listPostsGone, upsertArtifactIndex } from '../db/repo.js';
import { createDraft, readRawPost } from '../ghost/posts.js';
import { onJobEvent } from '../jobs/events.js';
import { getLiveDraft } from '../jobs/liveDraft.js';
import { fixPlanQuality } from '../orchestrator/fixQuality.js';
import { restoreLastApply } from '../orchestrator/restore.js';
import { dismissIdea, generateIdeas, loadIdeaHistory, loadIdeas, markIdeaUsed, restoreIdea, searchCacheInfo, searchOpportunities, searchSourcesConfigured } from '../orchestrator/ideas.js';
import { ideasPage } from './views/ideas.js';
import { autoPlanNotice, dismissAutoPlanNotice, startScheduler } from '../jobs/scheduler.js';
import { applySnippet, loadSnippet, restoreSnippet, snippetsByUrl, suggestForPage } from '../orchestrator/snippet.js';
import { snippetPage } from './views/snippet.js';
import { assertBudget, BudgetExceededError, budgetStatus } from '../agents/budget.js';
import { cancelJob, enqueueApplyJob, enqueuePlanJob, enqueueSyncJob } from '../jobs/queue.js';
import { logger } from '../logger.js';
import { retryFeatureImage } from '../orchestrator/imageWriteback.js';
import { commitResolve, previewResolve, resolvePlan, type PreviewResolveResult } from '../orchestrator/resolveFlow.js';
import { editPlannedArtifact } from '../orchestrator/editPlan.js';
import { applyImageOnly, choosePlanImage, editPlanImageText, IMAGE_ONLY_RUN, loadImageOnly, localImagePath, searchPlanImages, keepCurrentImage, removeCurrentImage, skipPlanImage, type ImageWork } from '../orchestrator/imageChoice.js';
import { applyPlanReview, StaleReviewError } from '../orchestrator/reviewPlan.js';
import { precheckApply } from '../orchestrator/writeback.js';
import type { WriterMode } from '../agents/writer.agent.js';
import { findLatestArtifact, listAllArtifacts } from '../review/store.js';
import type { PostStateKind } from '../state/postState.js';
import { readPostSummaries, syncPostState } from '../state/postState.js';
import { extractPendingQuestions, uniquePendingQuestions } from '../util/pending.js';
import { getPostDetail } from './service.js';
import { KIND_LABELS } from './views/badge.js';
import { peekPanel } from './views/peek.js';
import { nextInQueue } from '../state/reviewQueue.js';
import { applyPrecheckPage } from './views/applyPrecheck.js';
import { errorPage, sameOriginBack } from './views/errorPage.js';
import { dashboardPage } from './views/dashboard.js';
import { detailPage } from './views/detail.js';
import { jobConsolePage } from './views/jobConsole.js';
import { jobsListPage } from './views/jobsList.js';
import { renderWriterPreview } from './views/preview.js';
import { qualityPanel } from './views/quality.js';
import { checkQuality } from '../review/quality.js';
import { promptEditorPage } from './views/promptEditor.js';
import { resolvePreviewPage } from './views/resolvePreview.js';
import { newPostPage } from './views/newPost.js';
import { settingsPage } from './views/settings.js';
import QRCode from 'qrcode';
import * as auth from '../auth/store.js';
import { newTotpSecret, otpauthUri } from '../auth/totp.js';
import { accountPage, inviteGonePage, inviteLinkPage, invitePage, loginPage, recoveryCodesPage, setupPage, totpSetupPage, twoFactorNag, twoFactorPage, usersSection } from './views/auth.js';
import { currentUser, isAdminRole, runWithUser } from '../auth/context.js';
import { canManage } from './views/auth.js';
import * as team from '../team/store.js';
import { activityActors, listActivity, logActivity } from '../team/store.js';
import { presenceBanner, type PostTeam } from './views/team.js';
import { activityPage, activitySection } from './views/activity.js';
import { applyImport, createExport, exportFileName, getStagedImport, IMPORT_PARTS, ImportError, stageImport, type ImportPart } from '../settings/workspace.js';
import { importPreviewPage } from './views/transfer.js';
import { ENV_FIELDS, EnvValidationError, isOwnerOnlyField, saveEnv, type EnvSubmission } from '../settings/envFile.js';
import { isTestableService, listAiModels, testConnection } from '../settings/connectionTest.js';
import { registerOpenverseApp } from '../images/openverseAuth.js';
import { availableLocales, t } from '../i18n/index.js';

function parseMode(value: string | undefined): WriterMode {
  return value === 'draft' || value === 'improve' ? value : 'auto';
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const SESSION_COOKIE = 'gc_session';
const PENDING_COOKIE = 'gc_2fa';
/** Reachable without a session: health check, login, and the static files the login page needs. */
const PUBLIC_PATHS = ['/healthz', '/login', '/login/2fa'];
const isStaticAsset = (url: string) => /^\/(?:vendor\/[^?]*|[\w.-]+\.(?:css|js|svg|png|ico|woff2?))(?:\?.*)?$/.test(url);
/** Only local paths after login: never another site ("//evil.com", "https://…"). */
const safeNext = (next: unknown) => {
  // Browsers drop tabs and newlines from URLs ("/\t/evil.com" → "//evil.com"): any control character is refused.
  if (typeof next !== 'string' || /[\u0000-\u001f\u007f\\]/.test(next) || !/^\/(?!\/)/.test(next)) return '/';
  return next;
};
/**
 * Admin only: settings (keys, prompts, export/import, language) and users. Editors
 * do everything else (plan, review, edit, apply, ideas, jobs) and their account.
 */
const isAdminPath = (path: string) => /^\/(?:api\/)?settings(?:\/|$)/.test(path);
/** Owner only: export/import (it carries everything but keys) and registering apps (writes keys). */
const isOwnerPath = (path: string) => /^\/settings\/(?:export|import|openverse\/register)(?:\/|$)/.test(path);

declare module 'fastify' {
  interface FastifyRequest {
    user?: auth.AuthUser;
    /** Per-response nonce for the inline <script> tags (Content-Security-Policy). */
    cspNonce?: string;
  }
}

// In-memory cache of the latest resolve preview per post (single user,
// one tab at a time in practice). Avoids calling the agent again on
// commit -- what gets saved to Ghost is EXACTLY what was previewed.
const resolvePreviewCache = new Map<string, { html: string; snapshotUpdatedAt: string; answered: number; unresolved: number }>();

export interface ServeOptions {
  port: number;
  host: string;
  /**
   * Public address when served behind a reverse proxy or tunnel (e.g.
   * https://ghost.example.com behind Cloudflare Access). Its Host/Origin are
   * accepted besides localhost, and the session cookie becomes Secure.
   */
  publicUrl?: string;
  /** .env edited by the /settings routes (tests pass a temporary one). */
  envFile?: string;
  /** Open the browser already logged in (local starts). */
  open?: boolean;
}

/**
 * Embedded local server: same process, same singleton limiters
 * (src/util/limiter.ts), same config. Server-rendered; the only frontend
 * build is the CSS (Tailwind, `npm run css:build`). No file under src/web/ may talk to Ghost/DeepSeek/
 * Unsplash/Pexels directly -- everything goes through src/state, src/orchestrator,
 * src/ghost, etc. via src/web/service.ts.
 */
/**
 * Builds the app WITHOUT listening on any port -- separate from
 * `startServer()` so the security guards can be tested with
 * `app.inject()` (fastify light-my-request) without opening a real socket.
 */
function passwordProblem(password: string | undefined, repeat: string | undefined): string | null {
  if (!password || password.length < auth.MIN_PASSWORD) return t('auth.passwordHint', { min: auth.MIN_PASSWORD });
  if (password !== repeat) return t('auth.mismatch');
  return null;
}

async function qrSvg(secret: string, username: string): Promise<string> {
  const host = (() => {
    try {
      return new URL(getConfig().GHOST_API_URL).hostname;
    } catch {
      return 'panel';
    }
  })();
  return QRCode.toString(otpauthUri(secret, `${username}@${host}`), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
}

// One-time login links (auto-open in the browser): single use, 2 minutes.
const oneTimeLogins = new Map<string, number>();
export function issueOneTimeLogin(): string {
  const code = randomBytes(24).toString('base64url');
  oneTimeLogins.set(code, Date.now() + 2 * 60_000);
  return code;
}
function consumeOneTimeLogin(code: string): boolean {
  const until = oneTimeLogins.get(code);
  oneTimeLogins.delete(code);
  return !!until && until > Date.now();
}

/** Title from the topic when none is given: cut at a word, not mid-word. The plan proposes the real one. */
export function provisionalTitle(topic: string, max = 80): string {
  const text = topic.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

export async function buildApp(opts: ServeOptions & { sessionToken?: string }) {
  if (opts.host !== '127.0.0.1' && opts.host !== 'localhost') {
    logger.warn(
      { host: opts.host },
      'Serving on a host other than 127.0.0.1/localhost: anyone on your local network could reach this server, which can write to your real blog.',
    );
  }

  const envFile = opts.envFile ?? envFilePath();
  const sessionToken = opts.sessionToken ?? randomBytes(24).toString('hex');
  const allowedHosts = new Set([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`]);
  const allowedOrigins = new Set([`http://127.0.0.1:${opts.port}`, `http://localhost:${opts.port}`]);
  const publicUrl = opts.publicUrl ? new URL(opts.publicUrl) : null;
  if (publicUrl && !/^https?:$/.test(publicUrl.protocol)) throw new Error(`PUBLIC_URL must be http(s): ${opts.publicUrl}`);
  if (publicUrl) {
    allowedHosts.add(publicUrl.host);
    allowedOrigins.add(publicUrl.origin);
  }

  const app = Fastify({
    loggerInstance: logger,
    // Behind a proxy or tunnel (PUBLIC_URL), the client's address comes in X-Forwarded-For,
    // trusted only from the local machine or a private network (cloudflared, nginx, Docker).
    trustProxy: publicUrl ? ['loopback', 'uniquelocal', 'linklocal'] : false,
  });

  await app.register(fastifyCookie);
  await app.register(fastifyFormbody);
  await app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: '/' });

  // CSRF/DNS-rebinding: any non-read method must come
  // with the expected Host/Origin. Without this, any page open in the
  // browser could send a POST to this server (it couldn't READ the
  // response due to CORS, but the write would already have happened).
  app.addHook('onRequest', async (req, reply) => {
    req.cspNonce = randomBytes(16).toString('base64');
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    const host = req.headers.host;
    if (!host || !allowedHosts.has(host)) {
      await reply.code(403).send(t('server.hostNotAllowed'));
      return;
    }
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      await reply.code(403).send(t('server.originNotAllowed'));
      return;
    }
    // Browsers that omit Origin still say where the request comes from.
    const site = req.headers['sec-fetch-site'];
    if (!origin && site && site !== 'same-origin' && site !== 'none') {
      await reply.code(403).send(t('server.originNotAllowed'));
      return;
    }
  });

  // Ids in URLs are Ghost ids, run ids, tokens or slugs: never anything that could
  // walk out of a folder once used in a file path ("..%2F..%2Fetc" decodes to "../../etc").
  app.addHook('preValidation', async (req, reply) => {
    const params = (req.params ?? {}) as Record<string, string>;
    for (const v of Object.values(params)) {
      if (typeof v === 'string' && !/^[\w.-]{1,200}$/.test(v)) return reply.code(400).type('text/plain').send(t('server.badId'));
      if (typeof v === 'string' && v.includes('..')) return reply.code(400).type('text/plain').send(t('server.badId'));
    }
  });

  // Login-type forms: at most 30 posts per client every 10 minutes, before
  // any password is hashed (scrypt is slow on purpose: see auth/store.ts).
  const AUTH_FORMS = /^\/(?:login(?:\/2fa)?|setup-password|invite\/[^/]+)$/;
  const attempts = new Map<string, { count: number; reset: number }>();
  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'POST' || !AUTH_FORMS.test(req.url.split('?')[0]!)) return;
    const now = Date.now();
    if (attempts.size > 10_000) for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k);
    const a = attempts.get(req.ip);
    if (!a || a.reset < now) attempts.set(req.ip, { count: 1, reset: now + 10 * 60_000 });
    else if (++a.count > 30) return reply.code(429).header('Retry-After', String(Math.ceil((a.reset - now) / 1000))).type('text/plain').send(t('auth.tooMany'));
  });

  // Too many password checks at once (see auth/store.ts): "busy, try again" instead of piling up.
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof auth.AuthBusyError) return reply.code(429).header('Retry-After', '5').type('text/plain').send(t('auth.busy'));
    return reply.send(err);
  });

  // Auth: users (admin | editor) with a password (+ optional TOTP) → a
  // server-side session in an httpOnly cookie. With no users yet, whoever
  // opens the panel creates the first admin (like Ghost). WEB_SESSION_TOKEN
  // (scripts, plan B) logs in as the first admin. Local starts open the
  // browser with a one-time link.
  const explicitToken = opts.sessionToken !== undefined;
  const secureCookie = publicUrl?.protocol === 'https:';
  const startSession = (req: FastifyRequest, reply: FastifyReply, user: auth.AuthUser) => {
    auth.revokeSession(req.cookies[SESSION_COOKIE]); // never two sessions in one browser
    const s = auth.createSession(user.id, String(req.headers['user-agent'] ?? ''));
    reply.setCookie(SESSION_COOKIE, s.token, { httpOnly: true, sameSite: 'lax', path: '/', secure: secureCookie, expires: s.expires });
    req.user = user;
    return s.token;
  };
  const tokenMatches = (given: unknown) => {
    if (typeof given !== 'string' || given.length !== sessionToken.length) return false;
    return timingSafeEqual(Buffer.from(given), Buffer.from(sessionToken));
  };
  const wantsHtml = (req: FastifyRequest) => req.method === 'GET' && String(req.headers.accept ?? '').includes('text/html');
  // Pending second step after a correct password: id → user and expiry (5 min).
  const pending2fa = new Map<string, { until: number; next: string; userId: number }>();

  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]!;
    if (PUBLIC_PATHS.includes(path) || path.startsWith('/invite/') || isStaticAsset(req.url)) return;

    const user = auth.checkSession(req.cookies[SESSION_COOKIE]);
    if (user) {
      req.user = user;
      // Checked against the route Fastify actually matched (its pattern, e.g.
      // /settings/users/:id/role), never the raw URL: "/%73ettings" is decoded
      // by the router and would otherwise slip past a check on the text.
      const route = req.routeOptions.url ?? '';
      const denied = (!isAdminRole(user.role) && isAdminPath(route) && 'auth.adminOnly') || (user.role !== 'owner' && isOwnerPath(route) && 'auth.ownerOnly');
      if (denied) {
        if (wantsHtml(req)) return reply.code(403).type('text/html').send(runWithUser(user, () => errorPage({ status: 403, message: t(denied), back: { href: '/', label: t('common.nav.dashboard') } }), req.cspNonce));
        return reply.code(403).type('text/plain').send(t(denied));
      }
      return;
    }

    // No users yet: like Ghost, whoever opens the panel first creates the admin.
    if (!auth.hasUsers()) {
      if (path === '/setup-password') return;
      if (wantsHtml(req)) return reply.redirect('/setup-password');
      return reply.code(401).type('text/plain').send(t('server.unauthorized'));
    }

    const query = req.query as Record<string, string | undefined>;
    const viaToken = query.t !== undefined && explicitToken && tokenMatches(query.t);
    const viaOnce = query.once !== undefined && consumeOneTimeLogin(query.once);
    const owner = viaToken || viaOnce ? auth.firstAdmin() : null;
    if (owner) {
      startSession(req, reply, owner);
      if (req.method === 'GET') {
        const params = new URLSearchParams(req.url.split('?')[1] ?? '');
        params.delete('t');
        params.delete('once');
        const rest = params.toString();
        return reply.redirect(`${path}${rest ? `?${rest}` : ''}`);
      }
      return;
    }

    if (wantsHtml(req)) return reply.redirect(`/login?next=${encodeURIComponent(req.url)}`);
    await reply.code(401).type('text/plain').send(t('server.unauthorized'));
  });

  // Who is behind the request, for the views (header, nav) and authorship.
  app.addHook('onRequest', (req, _reply, done) => runWithUser(req.user ?? null, done, req.cspNonce));

  app.get('/login', async (req, reply) => {
    if (auth.checkSession(req.cookies[SESSION_COOKIE])) return reply.redirect('/');
    const next = safeNext((req.query as { next?: string }).next);
    return reply.type('text/html').send(loginPage({ next, error: auth.hasUsers() ? undefined : t('auth.login.noPassword'), notice: (req.query as { reset?: string }).reset === '1' ? t('auth.login.resetDone') : undefined }));
  });

  app.post('/login', async (req, reply) => {
    const body = req.body as { username?: string; password?: string; next?: string };
    const next = safeNext(body.next);
    const username = String(body.username ?? '').slice(0, 64);
    const wait = auth.lockedFor(username, req.ip);
    if (wait > 0) return reply.code(429).type('text/html').send(loginPage({ next, username, error: t('auth.locked', { minutes: Math.ceil(wait / 60_000) }) }));
    const user = await auth.verifyLogin(username, body.password ?? '');
    if (!user) {
      auth.recordFailure(username, req.ip);
      // Only names that exist: a password typed into the username box must not end up in the log.
      logActivity('loginFailed', { actor: null, target: auth.findUser(username)?.username ?? null, detail: auth.findUser(username) ? null : 'unknownUser' });
      return reply.code(401).type('text/html').send(loginPage({ next, username, error: t('auth.login.wrong') }));
    }
    if (auth.totpEnabled(user.id)) {
      const id = randomBytes(24).toString('base64url');
      prunePending();
      pending2fa.set(id, { until: Date.now() + 5 * 60_000, next, userId: user.id });
      reply.setCookie(PENDING_COOKIE, id, { httpOnly: true, sameSite: 'strict', path: '/login', secure: secureCookie, maxAge: 300 });
      return reply.redirect('/login/2fa');
    }
    auth.clearFailures(username, req.ip);
    startSession(req, reply, user);
    logActivity('login', { actor: user.username });
    return reply.redirect(next);
  });

  const prunePending = () => {
    const now = Date.now();
    for (const [k, v] of pending2fa) if (v.until < now) pending2fa.delete(k);
  };
  const pendingOf = (id: string | undefined) => {
    const p = id ? pending2fa.get(id) : undefined;
    if (!p || p.until < Date.now()) return null;
    return p;
  };

  app.get('/login/2fa', async (req, reply) => {
    if (!pendingOf(req.cookies[PENDING_COOKIE])) return reply.redirect('/login');
    return reply.type('text/html').send(twoFactorPage({}));
  });

  app.post('/login/2fa', async (req, reply) => {
    const id = req.cookies[PENDING_COOKIE];
    const p = pendingOf(id);
    const user = p ? auth.getUser(p.userId) : null;
    if (!p || !user) return reply.redirect('/login');
    const wait = auth.lockedFor(user.username, req.ip);
    if (wait > 0) return reply.code(429).type('text/html').send(twoFactorPage({ error: t('auth.locked', { minutes: Math.ceil(wait / 60_000) }) }));
    const used = auth.verifySecondFactor(user.id, (req.body as { code?: string }).code ?? '');
    if (!used) {
      auth.recordFailure(user.username, req.ip);
      logActivity('loginFailed', { actor: null, target: user.username, detail: '2fa' });
      return reply.code(401).type('text/html').send(twoFactorPage({ error: t('auth.twoFactor.wrong') }));
    }
    pending2fa.delete(id!);
    reply.clearCookie(PENDING_COOKIE, { path: '/login' });
    auth.clearFailures(user.username, req.ip);
    startSession(req, reply, user);
    logActivity('login', { actor: user.username, detail: used === 'recovery' ? 'recovery' : '2fa' });
    return reply.redirect(used === 'recovery' ? '/account?sec=recoveryUsed' : p.next);
  });

  app.post('/logout', async (req, reply) => {
    logActivity('logout');
    auth.revokeSession(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.redirect('/login');
  });

  // ---------- First start: the first admin ----------
  app.get('/setup-password', async (req, reply) => {
    if (auth.hasUsers()) return reply.redirect('/');
    return reply.type('text/html').header('Cache-Control', 'no-store').send(setupPage({ min: auth.MIN_PASSWORD }));
  });

  app.post('/setup-password', async (req, reply) => {
    if (auth.hasUsers()) return reply.redirect('/');
    const b = req.body as { username?: string; password?: string; repeat?: string };
    const again = (error: string) => reply.code(422).type('text/html').send(setupPage({ min: auth.MIN_PASSWORD, username: b.username, error }));
    const problem = passwordProblem(b.password, b.repeat);
    if (problem) return again(problem);
    try {
      // Re-checked after the slow hash: two first visitors at once, only one admin.
      if (auth.hasUsers()) return reply.redirect('/login');
      const user = await auth.createUser(b.username ?? '', b.password!, 'admin');
      if (auth.listUsers()[0]?.id !== user.id) {
        auth.deleteUser(user.id);
        return reply.redirect('/login');
      }
      startSession(req, reply, user);
      logActivity('userJoined', { actor: user.username, detail: user.role });
    } catch (err) {
      if (err instanceof auth.AuthError) return again(t(`auth.errors.${err.code}`));
      throw err;
    }
    return reply.redirect('/account/2fa?first=1');
  });

  // ---------- Invites and password resets (single-use links) ----------
  app.get('/invite/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const invite = auth.findInvite(token);
    if (!invite) return reply.code(404).type('text/html').send(inviteGonePage());
    return reply.type('text/html').header('Cache-Control', 'no-store').send(invitePage({ token, invite, min: auth.MIN_PASSWORD }));
  });

  app.post('/invite/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const invite = auth.findInvite(token);
    if (!invite) return reply.code(404).type('text/html').send(inviteGonePage());
    if (invite.userId !== null) {
      // A reset link is only as good as its maker's rights today: if they lost
      // them (or the target changed role), the link is void.
      const maker = invite.createdBy ? auth.findUser(invite.createdBy) : null;
      const target = auth.getUser(invite.userId);
      if (!maker || !target || !canManage(maker, target)) {
        auth.revokeInvite(invite.id);
        return reply.code(404).type('text/html').send(inviteGonePage());
      }
    }
    const b = req.body as { username?: string; password?: string; repeat?: string };
    const again = (error: string) => reply.code(422).type('text/html').send(invitePage({ token, invite, min: auth.MIN_PASSWORD, username: b.username, error }));
    const problem = passwordProblem(b.password, b.repeat);
    if (problem) return again(problem);
    let user: auth.AuthUser;
    try {
      user = await auth.acceptInvite(token, { username: b.username, password: b.password! });
    } catch (err) {
      if (err instanceof auth.AuthError) return err.code === 'notFound' ? reply.code(404).type('text/html').send(inviteGonePage()) : again(t(`auth.errors.${err.code}`));
      throw err;
    }
    logActivity(invite.userId !== null ? 'passwordReset' : 'userJoined', { actor: user.username, detail: invite.userId !== null ? null : invite.role });
    // With 2FA on, a new password is not enough to get in: log in normally (password + code).
    if (auth.totpEnabled(user.id)) return reply.redirect('/login?reset=1');
    startSession(req, reply, user);
    return reply.redirect('/account/2fa?first=1');
  });

  // ---------- My account (every user) ----------
  const me = (req: FastifyRequest) => req.user!;

  app.get('/account', async (req, reply) => {
    const u = me(req);
    return reply.type('text/html').send(
      accountPage({ user: u, totp: auth.totpEnabled(u.id), recoveryLeft: auth.recoveryCodesLeft(u.id), sessions: auth.countSessions(u.id), min: auth.MIN_PASSWORD, notice: (req.query as { sec?: string }).sec }),
    );
  });

  app.get('/account/2fa', async (req, reply) => {
    if (auth.totpEnabled(me(req).id)) return reply.redirect('/account');
    const secret = newTotpSecret();
    return reply.type('text/html').send(totpSetupPage({ secret, qrSvg: await qrSvg(secret, me(req).username) }));
  });

  app.post('/account/2fa', async (req, reply) => {
    const u = me(req);
    const b = req.body as { secret?: string; code?: string };
    const secret = (b.secret ?? '').replace(/[^A-Z2-7]/g, '');
    if (auth.totpEnabled(u.id) || secret.length < 32) return reply.redirect('/account');
    if (!auth.checkNewTotp(secret, b.code ?? '')) {
      return reply.code(422).type('text/html').send(totpSetupPage({ secret, qrSvg: await qrSvg(secret, u.username), error: t('auth.enroll.wrong') }));
    }
    const codes = auth.enableTotp(u.id, secret);
    logActivity('twoFactorOn');
    return reply.type('text/html').header('Cache-Control', 'no-store').send(recoveryCodesPage(codes));
  });

  const secondFactorOk = (req: FastifyRequest) => {
    const u = me(req);
    if (auth.lockedFor(u.username, req.ip) > 0) return false;
    if (!auth.verifySecondFactor(u.id, (req.body as { code?: string }).code ?? '')) {
      auth.recordFailure(u.username, req.ip);
      return false;
    }
    return true;
  };

  app.post('/account/2fa/recovery', async (req, reply) => {
    if (!secondFactorOk(req)) return reply.redirect('/account?sec=badCode');
    return reply.type('text/html').header('Cache-Control', 'no-store').send(recoveryCodesPage(auth.newRecoveryCodes(me(req).id)));
  });

  app.post('/account/2fa/disable', async (req, reply) => {
    if (!secondFactorOk(req)) return reply.redirect('/account?sec=badCode');
    auth.disableTotp(me(req).id);
    logActivity('twoFactorOff');
    return reply.redirect('/account?sec=disabled');
  });

  app.post('/account/2fa/snooze', async (req, reply) => {
    auth.snooze2faNag(me(req).id);
    return reply.redirect('/');
  });

  app.post('/account/password', async (req, reply) => {
    const u = me(req);
    const b = req.body as { current?: string; password?: string; repeat?: string };
    const wait = auth.lockedFor(u.username, req.ip);
    if (wait > 0 || !(await auth.verifyPassword(u.id, b.current ?? ''))) {
      auth.recordFailure(u.username, req.ip);
      return reply.redirect('/account?sec=badPassword');
    }
    if (passwordProblem(b.password, b.repeat)) return reply.redirect('/account?sec=weakPassword');
    await auth.setPassword(u.id, b.password!); // closes every session of theirs…
    startSession(req, reply, u); // …except this one, which gets a new cookie
    logActivity('passwordChanged');
    return reply.redirect('/account?sec=passwordChanged');
  });

  app.post('/account/sessions/revoke', async (req, reply) => {
    auth.revokeAllSessions(me(req).id, req.cookies[SESSION_COOKIE]);
    logActivity('sessionsRevoked');
    return reply.redirect('/account?sec=revoked');
  });

  // ---------- Settings → Users (admin; isAdminPath guards /settings) ----------
  const linkBase = () => (publicUrl ? publicUrl.origin : `http://127.0.0.1:${opts.port}`);
  /** The user an admin action is about, if this admin may manage them (see canManage). */
  const userTarget = (req: FastifyRequest) => {
    const target = auth.getUser(Number((req.params as { id: string }).id));
    return target && canManage(me(req), target) ? target : null;
  };
  const usersBack = (notice: string) => `/settings?users=${notice}#s-users`;

  app.post('/settings/users/invite', async (req, reply) => {
    const role = (req.body as { role?: string }).role === 'admin' ? 'admin' : 'editor';
    if (role === 'admin' && me(req).role !== 'owner') return reply.redirect(usersBack('owner'));
    const token = auth.createInvite({ role, createdBy: me(req).username });
    logActivity('userInvited', { detail: role });
    return reply.type('text/html').header('Cache-Control', 'no-store').send(inviteLinkPage({ url: `${linkBase()}/invite/${token}`, invite: { role }, days: auth.INVITE_DAYS }));
  });

  app.post('/settings/users/:id/reset-password', async (req, reply) => {
    const target = userTarget(req);
    if (!target) return reply.redirect(usersBack('owner'));
    const token = auth.createInvite({ role: target.role, userId: target.id, createdBy: me(req).username });
    logActivity('passwordLink', { target: target.username });
    return reply.type('text/html').header('Cache-Control', 'no-store').send(inviteLinkPage({ url: `${linkBase()}/invite/${token}`, invite: { role: target.role, username: target.username }, days: auth.INVITE_DAYS }));
  });

  app.post('/settings/users/:id/role', async (req, reply) => {
    const target = userTarget(req);
    if (!target) return reply.redirect(usersBack('owner'));
    const role = (req.body as { role?: string }).role === 'admin' ? 'admin' : 'editor';
    if (me(req).role !== 'owner') return reply.redirect(usersBack('owner'));
    try {
      auth.setRole(target.id, role);
    } catch (err) {
      if (err instanceof auth.AuthError && err.code === 'lastAdmin') return reply.redirect(usersBack('lastAdmin'));
      throw err;
    }
    logActivity('userRole', { target: target.username, detail: role });
    return reply.redirect(usersBack('roleChanged'));
  });

  app.post('/settings/users/:id/reset-2fa', async (req, reply) => {
    const target = userTarget(req);
    if (!target) return reply.redirect(usersBack('owner'));
    auth.disableTotp(target.id);
    auth.revokeAllSessions(target.id);
    logActivity('userTwoFactorReset', { target: target.username });
    return reply.redirect(usersBack('twoFactorReset'));
  });

  app.post('/settings/users/:id/delete', async (req, reply) => {
    const target = userTarget(req);
    if (!target) return reply.redirect(usersBack('owner'));
    try {
      auth.deleteUser(target.id);
    } catch (err) {
      if (err instanceof auth.AuthError && err.code === 'lastAdmin') return reply.redirect(usersBack('lastAdmin'));
      throw err;
    }
    logActivity('userDeleted', { target: target.username });
    return reply.redirect(usersBack('deleted'));
  });

  app.get('/settings/activity', async (req, reply) => {
    const q = req.query as { actor?: string; before?: string };
    const PAGE = 100;
    const actor = q.actor?.trim() || undefined;
    const rows = listActivity({ limit: PAGE + 1, actor, before: Number(q.before) || undefined });
    const page = rows.slice(0, PAGE);
    return reply.type('text/html').send(activityPage({ rows: page, actors: activityActors(), actor, nextBefore: rows.length > PAGE ? page[page.length - 1]!.id : undefined }));
  });

  app.post('/settings/users/:id/transfer', async (req, reply) => {
    const u = me(req);
    const target = auth.getUser(Number((req.params as { id: string }).id));
    if (u.role !== 'owner' || !target || target.id === u.id) return reply.redirect(usersBack('owner'));
    if (auth.lockedFor(u.username, req.ip) > 0 || !(await auth.verifyPassword(u.id, String((req.body as { password?: string }).password ?? '')))) {
      auth.recordFailure(u.username, req.ip);
      return reply.redirect(usersBack('badPassword'));
    }
    auth.transferOwnership(target.id);
    logActivity('ownership', { target: target.username });
    return reply.redirect(usersBack('transferred'));
  });

  app.post('/settings/invites/revoke', async (req, reply) => {
    const invite = auth.listInvites().find((i) => i.id === String((req.body as { id?: string }).id ?? ''));
    if (!invite) return reply.redirect(usersBack('inviteRevoked'));
    // Admin invites and links for admins are the owner's to manage (same rule as canManage).
    const target = invite.userId !== null ? auth.getUser(invite.userId) : null;
    if (me(req).role !== 'owner' && (invite.role !== 'editor' || (target && target.role !== 'editor'))) return reply.redirect(usersBack('owner'));
    auth.revokeInvite(invite.id);
    logActivity('inviteRevoked');
    return reply.redirect(usersBack('inviteRevoked'));
  });

  // A private panel: never in search results, even if its URL leaks; never
  // framed (clickjacking); only its own scripts run (the two inline ones carry
  // this response's nonce), so an injection that slipped through can't execute.
  const hsts = publicUrl?.protocol === 'https:';
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    // Proxies and CDNs must not rewrite the pages: Cloudflare's Rocket Loader, for
    // one, re-injects every script through its own loader, which the CSP blocks.
    const cc = String(reply.getHeader('Cache-Control') ?? '');
    if (!/no-transform/i.test(cc)) reply.header('Cache-Control', cc ? `${cc}, no-transform` : 'no-transform');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (hsts) reply.header('Strict-Transport-Security', 'max-age=31536000');
    if (!reply.hasHeader('Content-Security-Policy')) {
      reply.header(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          `script-src 'self' 'nonce-${req.cspNonce ?? ''}'`,
          "style-src 'self' 'unsafe-inline'",
          // Post images (Ghost, image sources) are shown in previews.
          "img-src 'self' data: https:",
          "font-src 'self' data:",
          "connect-src 'self'",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'self'",
          "frame-ancestors 'none'",
        ].join('; '),
      );
    }
    return payload;
  });

  // Form errors (400/404/409/502 in plain text) are shown
  // as a regular UI page, with a link back, instead of a
  // blank page with no navigation. APIs (JSON) and 401/403 are unchanged.
  app.addHook('onSend', async (req, reply, payload) => {
    if (reply.statusCode < 400 || reply.statusCode === 401 || reply.statusCode === 403) return payload;
    if (!String(reply.getHeader('content-type') ?? '').startsWith('text/plain')) return payload;
    if (!String(req.headers.accept ?? '').includes('text/html')) return payload;
    reply.type('text/html; charset=utf-8');
    return errorPage({ status: reply.statusCode, message: String(payload ?? ''), back: sameOriginBack(req.headers.referer, allowedOrigins) });
  });

  // Routes that call the AI: refused up front once the daily cap is used up
  // (the plan job also checks it per post, for batches that cross it midway).
  const AI_ROUTES = new Set(['/posts/new', '/posts/:id/plan', '/batch/plan', '/posts/:id/plan/resolve', '/posts/:id/plan/fix', '/ideas/generate', '/ideas/snippet', '/posts/:id/resolve/preview']);
  app.addHook('preHandler', async (req, reply) => {
    if (req.method !== 'POST' || !AI_ROUTES.has(req.routeOptions.url ?? '')) return;
    try {
      assertBudget();
    } catch (err) {
      if (err instanceof BudgetExceededError) return reply.code(429).type('text/plain').send(err.message);
      throw err;
    }
  });

  // Unknown URLs: plain text, so the hook above turns it into a UI page for browsers.
  app.setNotFoundHandler(async (_req, reply) => reply.code(404).type('text/plain').send(t('errors.pageNotFound')));

  app.post('/auto-plan/dismiss', async (_req, reply) => {
    dismissAutoPlanNotice();
    return reply.redirect('/');
  });

  app.get('/healthz', async () => ({ ok: true }));

  app.get('/', async (req, reply) => {
    const query = req.query as { kind?: PostStateKind; q?: string; noImage?: string; mine?: string };
    const users = auth.listUsers();
    const me = req.user!.username;
    const summaries = readPostSummaries();
    const cfg = getConfig();
    return reply.type('text/html').send(
      dashboardPage({
        summaries,
        activeKind: query.kind,
        q: query.q,
        noImage: query.noImage === '1',
        mine: query.mine === '1',
        team: users.length > 1 ? { me, assignments: team.allAssignments(), notes: team.noteCounts(), viewing: team.presenceByPost(me) } : undefined,
        ghostUrl: cfg.GHOST_API_URL,
        draftFilter: cfg.DRAFT_FILTER,
        syncedAt: summaries[0]?.syncedAt ?? null,
        quotas: getProviderQuotas(),
        gone: listPostsGone(),
        cost: getCostSummary(),
        budget: budgetStatus(),
        autoPlan: autoPlanNotice(),
        nag2fa: req.user && !auth.totpEnabled(req.user.id) && Date.now() > auth.nagUntil(req.user.id) ? twoFactorNag() : '',
        queueDone: (req.query as { done?: string }).done === '1',
      }),
    );
  });

  app.post('/sync', async (_req, reply) => {
    const jobId = enqueueSyncJob({});
    return reply.redirect(`/jobs/${jobId}`);
  });

  /**
   * Creates a new EMPTY draft in Ghost (no content of its own) and enqueues a
   * plan on it, passing topic/sources/instructions as extraInstructions.
   * Arriving without html, the WriterAgent applies its rule 2 (develop the
   * topic from scratch) instead of "keep existing content" -- the rest
   * of the flow (SEO, image, apply with precheck) is identical to any
   * other post, with no new code in the pipeline.
   */
  app.get('/posts/new', async (req, reply) => {
    // Prefilled from an idea (/ideas): title and topic in the query.
    const q = req.query as { title?: string; topic?: string; idea?: string };
    const values = { title: q.title?.slice(0, 200), topic: q.topic?.slice(0, 2000), idea: q.idea?.slice(0, 40) };
    return reply.type('text/html').send(newPostPage({ values, ghostUrl: getConfig().GHOST_API_URL }));
  });

  app.post('/posts/new', async (req, reply) => {
    const body = req.body as { title?: string; topic?: string; sources?: string; instructions?: string; idea?: string };
    const topic = (body.topic ?? '').trim();
    if (!topic) {
      return reply.code(400).type('text/html').send(newPostPage({ values: body, error: t('server.missingTopic'), ghostUrl: getConfig().GHOST_API_URL }));
    }
    const title = (body.title ?? '').trim() || provisionalTitle(topic);

    const briefParts = [`Tema del articulo: ${topic}`];
    const sources = (body.sources ?? '').trim();
    if (sources) briefParts.push(`Fuentes/datos a incorporar (usalos tal cual, no inventes mas alla de esto):\n${sources}`);
    const instructions = (body.instructions ?? '').trim();
    if (instructions) briefParts.push(`Instrucciones adicionales del editor: ${instructions}`);

    const draft = await createDraft({ title, html: '', tags: [] });
    if (body.idea) markIdeaUsed(body.idea, draft.id);
    const jobId = enqueuePlanJob({ postIds: [draft.id], extraInstructions: briefParts.join('\n\n') });
    return reply.redirect(`/jobs/${jobId}`);
  });

  app.post('/posts/:id/image/retry', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await retryFeatureImage(id);
    if (result.status !== 'uploaded' && result.status !== 'skipped-existing') {
      return reply.code(409).type('text/plain').send(result.message);
    }
    return reply.redirect(`/posts/${id}`);
  });

  // Lightweight list for the command palette (local index, no Ghost).
  app.get('/api/posts', async () => ({
    posts: readPostSummaries().map((s) => ({ id: s.id, title: s.title, kindLabel: KIND_LABELS[s.kind] })),
  }));

  // Dashboard side panel (HTML fragment, local data only).
  app.get('/posts/:id/peek', async (req, reply) => {
    const { id } = req.params as { id: string };
    const summary = readPostSummaries().find((s) => s.id === id);
    if (!summary) return reply.code(404).type('text/plain').send(t('server.postNotIndexed'));
    return reply.type('text/html').send(peekPanel(summary, await findLatestArtifact(id)));
  });

  // "Next to review": jumps to the next post in the inbox (or to the dashboard if none are left).
  app.get('/posts/:id/next', async (req, reply) => {
    const { id } = req.params as { id: string };
    const next = nextInQueue(readPostSummaries(), id);
    return reply.redirect(next ? `/posts/${encodeURIComponent(next.id)}` : '/?done=1');
  });

  const postTeam = (postId: string, user: auth.AuthUser): PostTeam => ({
    me: { username: user.username, admin: isAdminRole(user.role) },
    users: auth.listUsers().map((u) => u.username),
    assignee: team.getAssignment(postId),
    notes: team.listNotes(postId),
    others: team.othersOnPost(postId, user.username).map((o) => o.username),
    plannedBy: team.lastPlannedBy(postId),
  });

  app.get('/posts/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const detail = await getPostDetail(id);
    const cfg = getConfig();
    team.touchPresence(id, req.user!.username);
    return reply.type('text/html').send(
      detailPage({
        ...detail,
        saved: (req.query as { saved?: string }).saved === '1',
        fixed: (req.query as { fixed?: string }).fixed !== undefined,
        restored: (req.query as { restored?: string }).restored !== undefined,
        resolved: (req.query as { resolved?: string }).resolved !== undefined ? { unresolved: Number((req.query as { resolved?: string }).resolved) || 0 } : undefined,
        ghostAdminUrl: `${cfg.GHOST_API_URL}/ghost/#/editor/post/${id}`,
        team: postTeam(id, req.user!),
      }),
    );
  });

  // ---------- Team: who has it open, assignment, notes ----------
  // Heartbeat from detail.js (every minute while the tab is visible): returns the banner.
  app.post('/api/posts/:id/presence', async (req) => {
    const { id } = req.params as { id: string };
    team.touchPresence(id, req.user!.username);
    return { html: presenceBanner(team.othersOnPost(id, req.user!.username).map((o) => o.username)) };
  });

  app.post('/posts/:id/assign', async (req, reply) => {
    const { id } = req.params as { id: string };
    const wanted = String((req.body as { username?: string }).username ?? '').trim();
    const user = wanted ? auth.findUser(wanted) : null;
    if (wanted && !user) return reply.code(400).type('text/plain').send(t('server.unknownUser'));
    const before = team.getAssignment(id)?.username ?? null;
    if ((before?.toLowerCase() ?? null) !== (user?.username.toLowerCase() ?? null)) {
      team.assignPost(id, user?.username ?? null);
      logActivity(user ? 'assigned' : 'unassigned', { target: team.postTitle(id), detail: user?.username ?? null });
    }
    return reply.redirect(`/posts/${id}`);
  });

  app.post('/posts/:id/notes', async (req, reply) => {
    const { id } = req.params as { id: string };
    team.addNote(id, String((req.body as { text?: string }).text ?? ''));
    return reply.redirect(`/posts/${id}#notas`);
  });

  app.post('/posts/:id/notes/:noteId/delete', async (req, reply) => {
    const { id, noteId } = req.params as { id: string; noteId: string };
    if (!team.deleteNote(Number(noteId), { username: req.user!.username, admin: isAdminRole(req.user!.role) })) return reply.code(403).type('text/plain').send(t('auth.adminOnly'));
    return reply.redirect(`/posts/${id}#notas`);
  });

  // WriterAgent draft while it writes (streaming), polled
  // from the job console. `since` avoids re-rendering (and
  // re-sending) the HTML if it hasn't changed since the last request.
  app.get('/api/posts/:id/live-draft', async (req, reply) => {
    const { id } = req.params as { id: string };
    const since = Number((req.query as { since?: string }).since ?? 0);
    const draft = getLiveDraft(id);
    if (!draft) return reply.send({ available: false });
    if (draft.updatedAt <= since) return reply.send({ available: true, unchanged: true, done: draft.done, updatedAt: draft.updatedAt });
    return reply.send({
      available: true,
      done: draft.done,
      updatedAt: draft.updatedAt,
      words: draft.markdown.split(/\s+/).filter(Boolean).length,
      html: renderWriterPreview(draft.markdown),
    });
  });

  app.post('/posts/:id/plan', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { instructions?: string; mode?: string };
    const jobId = enqueuePlanJob({ postIds: [id], extraInstructions: body.instructions?.trim() || undefined, mode: parseMode(body.mode) });
    return reply.redirect(`/jobs/${jobId}`);
  });

  app.post('/batch/plan', async (req, reply) => {
    const body = req.body as { postIds?: string | string[]; instructions?: string; mode?: string };
    const postIds = Array.isArray(body.postIds) ? body.postIds : body.postIds ? [body.postIds] : [];
    if (postIds.length === 0) {
      return reply.code(400).type('text/plain').send(t('server.selectPost'));
    }
    const jobId = enqueuePlanJob({ postIds, extraInstructions: body.instructions?.trim() || undefined, mode: parseMode(body.mode) });
    return reply.redirect(`/jobs/${jobId}`);
  });

  // Manual editing of the plan ("Edit" tab in the detail view).
  app.post('/posts/:id/plan/edit', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { runId?: string; title?: string; markdown?: string; meta_title?: string; meta_description?: string; custom_excerpt?: string };
    const artifact = await findLatestArtifact(id);
    if (!artifact || artifact.runId !== body.runId) {
      return reply.code(409).type('text/plain').send(t('server.planChangedEditing'));
    }
    try {
      await editPlannedArtifact(artifact, {
        title: body.title ?? '',
        markdown: body.markdown ?? '',
        meta_title: body.meta_title,
        meta_description: body.meta_description,
        custom_excerpt: body.custom_excerpt,
      });
    } catch (err) {
      return reply.code(400).type('text/plain').send((err as Error).message);
    }
    return reply.redirect(`/posts/${id}?saved=1#plan-preview`);
  });

  // Plan's featured image ("Image" tab): search, pick (downloaded
  // locally, not to Ghost), tweak its text or go without an image.
  const planFor = async (id: string, runId: string | undefined): Promise<ImageWork | null> => {
    const artifact = await findLatestArtifact(id);
    const hasPlan = !!artifact && artifact.status === 'planned' && !!artifact.writer;
    // Image-only work (no text plan): only while there is no plan, so
    // there are never two competing image choices for the same post.
    if (runId === IMAGE_ONLY_RUN) {
      if (hasPlan) return null;
      const title = artifact?.postTitle ?? readPostSummaries().find((s) => s.id === id)?.title ?? id;
      return loadImageOnly(id, title, artifact?.writer?.language);
    }
    return artifact && artifact.runId === runId && artifact.status === 'planned' ? artifact : null;
  };
  const stalePlan = (reply: FastifyReply) => reply.code(409).type('text/plain').send(t('server.planChanged'));

  app.post('/posts/:id/image/search', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { runId?: string; q?: string; source?: string };
    const artifact = await planFor(id, body.runId);
    if (!artifact) return stalePlan(reply);
    const source = (IMAGE_SOURCES as readonly string[]).includes(body.source ?? '') ? body.source : undefined;
    await searchPlanImages(artifact, body.q ?? '', source);
    return reply.redirect(`/posts/${id}#imagen`);
  });

  app.post('/posts/:id/image/choose', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { runId?: string; index?: string };
    const artifact = await planFor(id, body.runId);
    if (!artifact) return stalePlan(reply);
    try {
      await choosePlanImage(artifact, Number(body.index));
    } catch (err) {
      return reply.code(502).type('text/plain').send(t('server.imageDownload', { error: (err as Error).message }));
    }
    return reply.redirect(`/posts/${id}?saved=1#imagen`);
  });

  app.post('/posts/:id/image/text', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { runId?: string; alt?: string; caption?: string };
    const artifact = await planFor(id, body.runId);
    if (!artifact) return stalePlan(reply);
    await editPlanImageText(artifact, body.alt ?? '', body.caption ?? '');
    return reply.redirect(`/posts/${id}?saved=1#imagen`);
  });

  app.post('/posts/:id/image/none', async (req, reply) => {
    const { id } = req.params as { id: string };
    const artifact = await planFor(id, (req.body as { runId?: string }).runId);
    if (!artifact) return stalePlan(reply);
    await skipPlanImage(artifact);
    return reply.redirect(`/posts/${id}?saved=1#imagen`);
  });

  app.post('/posts/:id/image/remove', async (req, reply) => {
    const { id } = req.params as { id: string };
    const artifact = await planFor(id, (req.body as { runId?: string }).runId);
    if (!artifact) return stalePlan(reply);
    await removeCurrentImage(artifact);
    return reply.redirect(`/posts/${id}?saved=1#imagen`);
  });

  app.post('/posts/:id/image/keep', async (req, reply) => {
    const { id } = req.params as { id: string };
    const artifact = await planFor(id, (req.body as { runId?: string }).runId);
    if (!artifact) return stalePlan(reply);
    await keepCurrentImage(artifact);
    return reply.redirect(`/posts/${id}?saved=1#imagen`);
  });

  app.post('/posts/:id/image/apply', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await applyImageOnly(id);
    } catch (err) {
      return reply.code(409).type('text/plain').send((err as Error).message);
    }
    await syncPostState(id).catch(() => {});
    return reply.redirect(`/posts/${id}?saved=1#historial`);
  });

  // The local copy of the chosen image (never a path coming from the client).
  app.get('/posts/:id/image/chosen', async (req, reply) => {
    const { id } = req.params as { id: string };
    const latest = await findLatestArtifact(id);
    const artifact = latest?.imageChoice?.kind === 'option' ? latest : await planFor(id, IMAGE_ONLY_RUN);
    if (artifact?.imageChoice?.kind !== 'option') return reply.code(404).send();
    try {
      // Only real image types: a plan (maybe imported) can't make this serve HTML.
      const type = /^image\/(?:jpeg|png|webp|gif|avif)$/.test(artifact.imageChoice.contentType) ? artifact.imageChoice.contentType : null;
      if (!type) return reply.code(415).send();
      const data = await readFile(localImagePath(artifact.imageChoice.localFile));
      return reply.type(type).header('cache-control', 'private, max-age=3600').header('content-security-policy', "default-src 'none'; sandbox").send(data);
    } catch {
      return reply.code(404).send();
    }
  });

  // Answers to the [[PENDING:]] items of an unapplied plan ("Pending" tab).
  app.post('/posts/:id/plan/resolve', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, string | undefined>;
    const artifact = await findLatestArtifact(id);
    if (!artifact || artifact.runId !== body.runId || artifact.status !== 'planned' || !artifact.writer) {
      return reply.code(409).type('text/plain').send(t('server.planChangedAnswering'));
    }
    const questions = uniquePendingQuestions(artifact.writer.markdown);
    const qas = questions.map((question, i) => ({ question, answer: (body[`answer_${i}`] ?? '').trim() }));
    const fixes = (artifact.answers ?? []).map((a, i) => ({ question: a.question, answer: (body[`fix_${i}`] ?? a.answer).trim() }));
    const changedFix = fixes.some((f, i) => f.answer && f.answer !== artifact.answers![i]!.answer);
    if (qas.every((qa) => !qa.answer) && !changedFix) return reply.redirect(`/posts/${id}#pendientes`);
    try {
      const result = await resolvePlan(artifact, qas, fixes);
      const left = uniquePendingQuestions(result.artifact.writer!.markdown).length;
      // If questions remain (or the resolver asked a follow-up), go back to the form.
      return reply.redirect(`/posts/${id}?resolved=${left}#${left > 0 ? 'pendientes' : 'plan-preview'}`);
    } catch (err) {
      return reply.code(502).type('text/plain').send(t('server.answersFailed', { error: (err as Error).message }));
    }
  });

  // Topic ideas: Search Console / Bing Webmaster "almost there" searches (no AI) and AI ideas from the published posts.
  app.get('/ideas', async (_req, reply) => {
    const gscConfigured = searchSourcesConfigured();
    let opportunities: Awaited<ReturnType<typeof searchOpportunities>> | null = null;
    let gscError: string | undefined;
    if (gscConfigured) {
      try {
        opportunities = await searchOpportunities();
      } catch (err) {
        gscError = (err as Error).message;
      }
    }
    return reply.type('text/html').send(ideasPage({ gscConfigured, opportunities, gscError, search: searchCacheInfo(), ideas: loadIdeas(), history: loadIdeaHistory(), snippets: snippetsByUrl() }));
  });

  app.post('/ideas/:id/dismiss', async (req, reply) => {
    dismissIdea((req.params as { id: string }).id);
    return reply.redirect('/ideas#ai-ideas-title');
  });

  app.post('/ideas/:id/restore', async (req, reply) => {
    restoreIdea((req.params as { id: string }).id);
    return reply.redirect('/ideas#ai-ideas-title');
  });

  app.post('/ideas/snippet', async (req, reply) => {
    const b = req.body as { page?: string; query?: string; position?: string; ctr?: string };
    try {
      const plan = await suggestForPage({ page: b.page ?? '', query: (b.query ?? '').slice(0, 200), position: Number(b.position) || 0, ctr: Number(b.ctr) || 0 });
      return reply.redirect(`/ideas/snippet/${plan.postId}`);
    } catch (err) {
      return reply.code(502).type('text/plain').send(t('server.snippetFailed', { error: (err as Error).message }));
    }
  });

  app.get('/ideas/snippet/:postId', async (req, reply) => {
    const { postId } = req.params as { postId: string };
    const plan = loadSnippet(postId);
    if (!plan) return reply.redirect('/ideas#ctr-title');
    return reply.type('text/html').send(snippetPage(plan, { result: (req.query as { r?: string }).r }));
  });

  app.post('/ideas/snippet/:postId/apply', async (req, reply) => {
    const { postId } = req.params as { postId: string };
    const b = req.body as { meta_title?: string; meta_description?: string };
    const r = await applySnippet(postId, { meta_title: b.meta_title ?? '', meta_description: b.meta_description ?? '' });
    return reply.redirect(`/ideas/snippet/${postId}?r=${r.status}`);
  });

  app.post('/ideas/snippet/:postId/restore', async (req, reply) => {
    const { postId } = req.params as { postId: string };
    const r = await restoreSnippet(postId);
    return reply.redirect(`/ideas/snippet/${postId}?r=${r.status}`);
  });

  app.post('/ideas/refresh', async (_req, reply) => {
    try {
      await searchOpportunities(true);
    } catch {
      // The GET shows the error.
    }
    return reply.redirect('/ideas#gsc-title');
  });

  app.post('/ideas/generate', async (_req, reply) => {
    try {
      await generateIdeas();
    } catch (err) {
      return reply.code(502).type('text/plain').send(t('server.ideasFailed', { error: (err as Error).message }));
    }
    return reply.redirect('/ideas#ai-ideas-title');
  });

  // Undo the last apply (History tab): back to the snapshot, if Ghost wasn't touched since.
  app.post('/posts/:id/restore', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await restoreLastApply(id);
    await syncPostState(id).catch(() => {});
    if (result.status !== 'restored') return reply.code(409).type('text/plain').send(t('server.restoreFailed', { error: result.message }));
    return reply.redirect(`/posts/${id}?restored=1#historial`);
  });

  // "Fix with AI" in the quality panel: rewrites the plan's text (not Ghost).
  app.post('/posts/:id/plan/fix', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { runId?: string };
    const artifact = await findLatestArtifact(id);
    if (!artifact || artifact.runId !== body.runId || artifact.status !== 'planned' || !artifact.writer) {
      return reply.code(409).type('text/plain').send(t('server.planChangedFixing'));
    }
    try {
      await fixPlanQuality(artifact);
    } catch (err) {
      return reply.code(502).type('text/plain').send(t('server.fixFailed', { error: (err as Error).message }));
    }
    return reply.redirect(`/posts/${id}?fixed=1#plan-preview`);
  });

  // Block-by-block review ("Review" tab): one decision per change.
  app.post('/posts/:id/plan/review', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, string | undefined>;
    const artifact = await findLatestArtifact(id);
    if (!artifact || artifact.runId !== body.runId || artifact.status !== 'planned') {
      return reply.code(409).type('text/plain').send(t('server.planChangedReviewing'));
    }
    const count = Math.min(Number(body.count ?? 0), 2000);
    const decisions = Array.from({ length: count }, (_, i) => body[`d_${i}`] !== 'old');
    try {
      await applyPlanReview(artifact, body.fp ?? '', decisions);
    } catch (err) {
      return reply.code(err instanceof StaleReviewError ? 409 : 400).type('text/plain').send((err as Error).message);
    }
    return reply.redirect(`/posts/${id}?saved=1#plan-preview`);
  });

  // Preview while editing: markdown -> sanitized HTML (same render as the plan).
  app.post('/api/preview', async (req, reply) => {
    const body = req.body as {
      markdown?: string;
      title?: string;
      metaTitle?: string;
      metaDescription?: string;
      keyword?: string;
      hasImage?: boolean;
    };
    const markdown = body.markdown ?? '';
    const quality = qualityPanel(
      checkQuality({
        title: body.title ?? '',
        markdown,
        metaTitle: body.metaTitle,
        metaDescription: body.metaDescription,
        primaryKeyword: body.keyword || null,
        hasImage: !!body.hasImage,
      }),
    );
    return reply.send({ html: renderWriterPreview(markdown), quality });
  });

  app.post('/posts/:id/apply/precheck', async (req, reply) => {
    const { id } = req.params as { id: string };
    const artifact = await findLatestArtifact(id);
    if (!artifact || artifact.status !== 'planned') {
      return reply.code(400).type('text/plain').send(t('server.noPlan'));
    }
    const precheck = await precheckApply(artifact);
    return reply.type('text/html').send(applyPrecheckPage({ artifact, precheck }));
  });

  app.post('/posts/:id/apply/confirm', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { confirmed?: string; allowPending?: string; forceSanity?: string; allowLinks?: string };
    if (body.confirmed !== 'on') {
      return reply.code(400).type('text/plain').send(t('server.confirmDiff'));
    }
    const jobId = enqueueApplyJob({
      postIds: [id],
      allowPending: body.allowPending === 'on',
      forceSanity: body.forceSanity === 'on',
      allowUnknownLinks: body.allowLinks === 'on',
    });
    return reply.redirect(`/jobs/${jobId}`);
  });

  app.post('/batch/apply', async (req, reply) => {
    const body = req.body as { postIds?: string | string[]; confirmed?: string };
    if (body.confirmed !== 'on') {
      return reply.code(400).type('text/plain').send(t('server.confirmBatch'));
    }
    const postIds = Array.isArray(body.postIds) ? body.postIds : body.postIds ? [body.postIds] : [];
    if (postIds.length === 0) {
      return reply.code(400).type('text/plain').send(t('server.selectPost'));
    }
    // No allowPending/forceSanity in the batch: each post that needs them
    // stays "skipped" with its reason, and is reviewed/applied individually
    // from its detail page -- avoids bypassing guards in one go across
    // several posts at once without having seen each diff.
    const jobId = enqueueApplyJob({ postIds });
    return reply.redirect(`/jobs/${jobId}`);
  });

  app.post('/posts/:id/resolve/preview', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, string>;
    const fresh = await readRawPost(id);
    const questions = extractPendingQuestions(fresh.html ?? '');
    if (questions.length === 0) {
      return reply.redirect(`/posts/${id}`);
    }
    const qas = questions.map((question, i) => ({ question, answer: (body[`answer_${i}`] ?? '').trim() }));
    if (qas.every((qa) => !qa.answer)) {
      return reply.redirect(`/posts/${id}`);
    }
    const preview: PreviewResolveResult = await previewResolve(id, qas);
    resolvePreviewCache.set(id, {
      html: preview.html,
      snapshotUpdatedAt: preview.snapshotUpdatedAt,
      answered: qas.filter((qa) => qa.answer).length,
      unresolved: preview.unresolved.length,
    });
    return reply.type('text/html').send(resolvePreviewPage({ postId: id, preview }));
  });

  app.post('/posts/:id/resolve/commit', async (req, reply) => {
    const { id } = req.params as { id: string };
    const cached = resolvePreviewCache.get(id);
    if (!cached) {
      return reply.code(400).type('text/plain').send(t('server.noPreview'));
    }
    const result = await commitResolve(id, cached.html, cached.snapshotUpdatedAt, {
      answered: cached.answered,
      unresolved: cached.unresolved,
    });
    resolvePreviewCache.delete(id);
    if (result.status !== 'applied') {
      return reply.code(409).type('text/plain').send(result.message);
    }
    return reply.redirect(`/posts/${id}`);
  });

  app.get('/jobs', async (req, reply) => {
    const query = req.query as { state?: string; type?: string; limit?: string; deleted?: string };
    const state: JobStateFilter = query.state === 'active' || query.state === 'failed' ? query.state : 'all';
    const type = isJobType(query.type) ? query.type : undefined;
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500);
    const jobs = listJobs({ state, type, limit });
    const active = listJobs({ state: 'active', limit: 20 });
    const titles = new Map(readPostSummaries().map((s) => [s.id, s.title]));
    return reply.type('text/html').send(
      jobsListPage({ jobs, active, counts: countJobEventsByLevel(jobs.map((j) => j.id)), titles, filter: { state, type }, limit, deleted: query.deleted !== undefined ? Number(query.deleted) || 0 : undefined }),
    );
  });

  // Status of running jobs, to refresh the Jobs tab without reloading.
  app.get('/api/jobs/active', async () => ({
    jobs: listJobs({ state: 'active', limit: 20 }).map((j) => ({
      id: j.id,
      state: j.state,
      done: j.done,
      total: j.total,
      last: listJobEvents(j.id, 0).at(-1)?.message ?? '',
    })),
  }));

  app.get('/jobs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = getJob(id);
    if (!job) return reply.code(404).type('text/plain').send(t('server.jobNotFound'));
    const titles = new Map(readPostSummaries().map((s) => [s.id, s.title]));
    return reply.type('text/html').send(jobConsolePage({ job, events: listJobEvents(id, 0), titles }));
  });

  app.post('/jobs/delete-finished', async (_req, reply) => {
    const n = deleteFinishedJobs();
    return reply.redirect(`/jobs?deleted=${n}`);
  });

  app.post('/jobs/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string };
    cancelJob(id);
    return reply.redirect(`/jobs/${id}`);
  });

  // SSE: replay of job_events from `since`, then live events. The
  // connection closes itself when the job reaches a terminal state.
  app.get('/api/jobs/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string };
    const since = Number((req.query as { since?: string }).since ?? 0);

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const writeEvent = (e: JobEventRecord) => {
      reply.raw.write(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`);
    };

    for (const e of listJobEvents(id, since)) writeEvent(e);

    const currentJob = getJob(id);
    if (!currentJob || TERMINAL_JOB_STATES.includes(currentJob.state)) {
      reply.raw.write('event: end\ndata: {}\n\n');
      reply.raw.end();
      return;
    }

    const unsubscribe = onJobEvent(id, (e) => {
      writeEvent(e);
      const job = getJob(id);
      if (job && TERMINAL_JOB_STATES.includes(job.state)) {
        reply.raw.write('event: end\ndata: {}\n\n');
        reply.raw.end();
      }
    });

    req.raw.on('close', unsubscribe);
  });

  const renderSettings = (
    extra: { reindexed?: number; saved?: string[]; group?: string; errors?: Array<{ key: string; message: string }>; openverseRegistered?: boolean; users?: string; imported?: string[] } = {},
    submitted?: EnvSubmission,
  ) => {
    const cfg = getConfig();
    const values: Record<string, string> = {};
    const secretsSet: Record<string, boolean> = {};
    for (const f of ENV_FIELDS) {
      const v = (cfg as unknown as Record<string, unknown>)[f.key];
      if (f.secret) secretsSet[f.key] = !!v;
      else values[f.key] = v === undefined ? '' : String(v);
      // After an error, what was submitted is shown again (never the secrets), so it isn't lost.
      if (!f.secret && submitted && (!submitted.__group || submitted.__group === f.group)) values[f.key] = f.type === 'boolean' ? String(submitted[f.key] === 'true') : (submitted[f.key] ?? values[f.key]!);
    }
    return settingsPage({
      activityHtml: activitySection(listActivity({ limit: 8 })),
      isOwner: currentUser()?.role === 'owner',
      usersHtml: currentUser() ? usersSection({ me: currentUser()!, users: auth.listUsers(), invites: auth.listInvites(), notice: extra.users }) : '',
      values,
      secretsSet,
      ghostKeyId: ghostKeyId(cfg.GHOST_ADMIN_API_KEY),
      suggestedAppName: `ghost-connector-${new URL(cfg.GHOST_API_URL).hostname}`,
      envPath: APP_HOME.mode === 'repo' ? '.env' : envFilePath(),
      dataDir: cfg.DATA_DIR,
      customizedPrompts: PROMPT_NAMES.filter((n) => isPromptCustomized(n)),
      activeJobs: listJobs({ state: 'active', limit: 20 }).length,
      quotas: getProviderQuotas(),
      indexedArtifacts: countIndexedArtifacts(),
      cost: getCostSummary(),
      budget: budgetStatus(),
      dailyCost: getDailyCost(30),
      costByAgent: getCostByAgent(),
      ...extra,
    });
  };

  // ---------- Export / import of the workspace (never users, 2FA or keys) ----------
  app.post('/settings/export', async (_req, reply) => {
    const file = createExport();
    logActivity('exported');
    return reply.type('application/gzip').header('Content-Disposition', `attachment; filename="${exportFileName()}"`).header('Cache-Control', 'no-store').send(file);
  });

  const importError = (reply: FastifyReply, code: string) => reply.code(422).type('text/plain').send(t(`settings.transfer.errors.${code}`));

  // The file comes as the raw body (settings.js sends it with fetch), up to 100 MB.
  // Registered in its own scope: no other route accepts a 100 MB raw body.
  await app.register(async (scope) => {
    scope.addContentTypeParser(['application/gzip', 'application/octet-stream', 'application/x-gzip'], { parseAs: 'buffer', bodyLimit: 100 * 1024 * 1024 }, (_req, body, done) => done(null, body));

    scope.post('/settings/import', async (req, reply) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length) return importError(reply, 'notExport');
      try {
        const preview = stageImport(req.body);
        return reply.redirect(`/settings/import/${preview.id}`);
      } catch (err) {
        if (err instanceof ImportError) return importError(reply, err.code);
        throw err;
      }
    });
  });

  app.get('/settings/import/:id', async (req, reply) => {
    const preview = getStagedImport((req.params as { id: string }).id);
    if (!preview) return importError(reply, 'expired');
    return reply.type('text/html').send(importPreviewPage(preview));
  });

  app.post('/settings/import/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getStagedImport(id)) return importError(reply, 'expired');
    const raw = (req.body as { parts?: string | string[] }).parts;
    const parts = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((x): x is ImportPart => (IMPORT_PARTS as string[]).includes(x));
    if (parts.includes('settings') && listJobs({ state: 'active', limit: 1 }).length > 0) return importError(reply, 'jobs');
    const done = applyImport(id, parts, envFile);
    if (done.includes('plans')) {
      clearArtifactIndex();
      for (const a of await listAllArtifacts()) upsertArtifactIndex(a);
    }
    if (done.length) logActivity('imported', { detail: done.join(', ') });
    return reply.redirect(`/settings?imported=${done.join(',')}#s-transfer`);
  });

  app.get('/settings', async (req, reply) => {
    const query = req.query as { reindexed?: string; saved?: string; group?: string; openverse?: string; users?: string; imported?: string };
    return reply.type('text/html').send(
      renderSettings({
        users: query.users,
        imported: query.imported ? query.imported.split(',').filter((x) => (IMPORT_PARTS as string[]).includes(x)) : undefined,
        reindexed: query.reindexed !== undefined ? Number(query.reindexed) || 0 : undefined,
        saved: query.saved !== undefined ? query.saved.split(',').filter((k) => ENV_FIELDS.some((f) => f.key === k)) : undefined,
        group: query.group,
        openverseRegistered: query.openverse === 'registered',
      }),
    );
  });

  // Saves the editable variables to .env. Empty secrets are
  // kept; nothing is written if validation fails or jobs are running
  // (changing Ghost or the model mid-batch would mix results).
  app.post('/settings/env', async (req, reply) => {
    try {
      const body = req.body as EnvSubmission;
      // Keys and where they are sent are the owner's: an admin's form never carries them.
      const cfg = getConfig() as unknown as Record<string, unknown>;
      const touches = (f: (typeof ENV_FIELDS)[number]) =>
        f.secret ? (body[f.key] ?? '').trim() !== '' || body[`clear_${f.key}`] === 'on' : body[f.key] !== undefined && body[f.key]!.trim() !== String(cfg[f.key] ?? '');
      if (req.user!.role !== 'owner' && ENV_FIELDS.some((f) => isOwnerOnlyField(f) && touches(f))) {
        return reply.code(403).type('text/plain').send(t('auth.ownerOnly'));
      }
      if (listJobs({ state: 'active', limit: 1 }).length > 0) {
        return reply.code(409).type('text/html').send(renderSettings({ errors: [{ key: 'jobs', message: t('settings.errors.jobs') }] }));
      }
      const changed = saveEnv(body, envFile);
      // Only the names of what changed: never the values (keys).
      if (changed.length) logActivity('settingsSaved', { detail: changed.join(', ') });
      const anchor = body.__group && /^[a-z]+$/.test(body.__group) ? `#g-${body.__group}` : '';
      return reply.redirect(`/settings?saved=${encodeURIComponent(changed.join(','))}${body.__group ? `&group=${encodeURIComponent(body.__group)}` : ''}${anchor}`);
    } catch (err) {
      if (err instanceof EnvValidationError) return reply.code(422).type('text/html').send(renderSettings({ errors: err.issues, group: (req.body as EnvSubmission).__group }, req.body as EnvSubmission));
      throw err;
    }
  });

  // Interface language (Settings card and command palette).
  // Unlike /settings/env it's allowed with running jobs: it only changes
  // the UI text, not what the jobs do.
  app.post('/settings/language', async (req, reply) => {
    const lang = String((req.body as { lang?: string } | undefined)?.lang ?? '');
    const locales = availableLocales();
    if (!locales.includes(lang)) return reply.code(400).type('text/plain').send(t('server.unknownLanguage', { lang, list: locales.join(', ') }));
    try {
      saveEnv({ UI_LANGUAGE: lang }, envFile);
      logActivity('language', { detail: lang });
    } catch (err) {
      if (err instanceof EnvValidationError) return reply.code(422).type('text/html').send(renderSettings({ errors: err.issues }));
      throw err;
    }
    return reply.redirect(sameOriginBack(req.headers.referer, allowedOrigins).href);
  });

  // OAuth2 registration with Openverse: done by the server, which saves client_id and
  // client_secret directly to .env; the secret never reaches the browser.
  app.post('/settings/openverse/register', async (req, reply) => {
    const body = (req.body ?? {}) as { name?: string; description?: string; email?: string; replace?: string };
    const name = (body.name ?? '').trim();
    const description = (body.description ?? '').trim();
    const email = (body.email ?? '').trim();
    const errors: Array<{ key: string; message: string }> = [];
    if (!name || name.length > 150) errors.push({ key: t('settings.errors.ovName'), message: t('settings.errors.ovNameMsg') });
    if (!description) errors.push({ key: t('settings.errors.ovDescription'), message: t('settings.errors.ovDescriptionMsg') });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push({ key: 'Email', message: t('settings.errors.ovEmailMsg') });
    const cfg = getConfig();
    if (cfg.OPENVERSE_CLIENT_ID && body.replace !== 'on') errors.push({ key: 'Openverse', message: t('settings.errors.ovExists') });
    if (errors.length) return reply.code(422).type('text/html').send(renderSettings({ errors }));
    try {
      const app = await registerOpenverseApp({ name, description, email });
      try {
        saveEnv({ OPENVERSE_CLIENT_ID: app.clientId, OPENVERSE_CLIENT_SECRET: app.clientSecret }, envFile);
      } catch (err) {
        // Openverse won't show the secret again: if it couldn't be saved, it's shown ONCE so it isn't lost.
        return reply.code(500).type('text/html').send(
          renderSettings({ errors: [{ key: 'Openverse', message: t('settings.errors.ovNotSaved', { error: err instanceof Error ? err.message : String(err), id: app.clientId, secret: app.clientSecret }) }] }),
        );
      }
      logActivity('openverse');
      return reply.redirect('/settings?openverse=registered#f-OPENVERSE_CLIENT_ID');
    } catch (err) {
      return reply.code(502).type('text/html').send(renderSettings({ errors: [{ key: 'Openverse', message: err instanceof Error ? err.message : String(err) }] }));
    }
  });

  // Ghost tags (public and internal "#...") for the drafts filter picker. Read-only.
  app.get('/api/settings/ghost-tags', async () => {
    const data = await ghostRawRequest<{ tags: Array<{ name: string; slug: string; visibility: string }> }>('/tags/', {
      query: { limit: 'all', fields: 'name,slug,visibility', filter: 'visibility:[public,internal]', order: 'name ASC' },
    });
    return { tags: data.tags.map((t) => ({ name: t.name, slug: t.slug, internal: t.visibility === 'internal' })) };
  });

  // An admin tests what is saved, never values typed in the form (a different URL would receive the key).
  const testInput = (req: FastifyRequest) => (req.user!.role === 'owner' ? ((req.body ?? {}) as EnvSubmission) : {});
  app.post('/api/settings/ai-models', async (req) => listAiModels(testInput(req)));

  app.post('/api/settings/test/:service', async (req, reply) => {
    const { service } = req.params as { service: string };
    if (!isTestableService(service)) return reply.code(404).send({ ok: false, message: t('server.unknownService') });
    return testConnection(service, testInput(req));
  });

  app.post('/settings/reindex', async (_req, reply) => {
    clearArtifactIndex();
    const all = await listAllArtifacts();
    for (const a of all) upsertArtifactIndex(a);
    logActivity('reindex', { detail: String(all.length) });
    return reply.redirect(`/settings?reindexed=${all.length}`);
  });

  app.get('/settings/prompts/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!isPromptName(name)) return reply.code(404).type('text/plain').send(t('server.unknownPrompt'));
    const { append, notice } = req.query as { append?: string; notice?: string };
    const content = loadPrompt(name) + (append ? `\n\n${append}\n` : '');
    return reply.type('text/html').send(
      promptEditorPage({
        name,
        content,
        revisions: listPromptRevisions(name),
        appended: !!append,
        notice: notice === 'saved' || notice === 'reset' || notice === 'reverted' ? notice : undefined,
        customized: isPromptCustomized(name),
        overridePath: `${overridesDir()}/${name}.md`,
        reviewStats: name === 'writer.system' ? getReviewStats() : [],
      }),
    );
  });

  app.post('/settings/prompts/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!isPromptName(name)) return reply.code(404).type('text/plain').send(t('server.unknownPrompt'));
    const body = req.body as { content?: string };
    if (!body.content || !body.content.trim()) {
      return reply.code(400).type('text/plain').send(t('server.emptyPrompt'));
    }
    savePrompt(name, body.content, 'edited from the UI');
    logActivity('promptSaved', { target: name });
    return reply.redirect(`/settings/prompts/${name}?notice=saved`);
  });

  app.post('/settings/prompts/:name/reset', async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!isPromptName(name)) return reply.code(404).type('text/plain').send(t('server.unknownPrompt'));
    resetPromptToFactory(name);
    logActivity('promptReset', { target: name });
    return reply.redirect(`/settings/prompts/${name}?notice=reset`);
  });

  app.post('/settings/prompts/:name/revert', async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!isPromptName(name)) return reply.code(404).type('text/plain').send(t('server.unknownPrompt'));
    const body = req.body as { revisionId?: string };
    const revisionId = Number(body.revisionId);
    if (!revisionId) return reply.code(400).type('text/plain').send(t('server.missingRevision'));
    revertPrompt(name, revisionId);
    logActivity('promptReverted', { target: name, detail: String(revisionId) });
    return reply.redirect(`/settings/prompts/${name}?notice=reverted`);
  });

  return { app, sessionToken };
}

export async function startServer(opts: ServeOptions & { sessionToken?: string }): Promise<void> {
  if (opts.sessionToken !== undefined && opts.sessionToken.length < 24) throw new Error('WEB_SESSION_TOKEN must be at least 24 characters');
  const { app, sessionToken } = await buildApp(opts);

  // Any job left "running"/"cancelling"/"queued" from a
  // previous process crash is marked "interrupted": it isn't blindly
  // revived (it could reapply writes), the user decides whether to rerun it.
  const interrupted = interruptOrphanedJobs();
  if (interrupted > 0) logger.warn({ interrupted }, 'Orphaned jobs from a previous start marked as "interrupted"');

  await app.listen({ port: opts.port, host: opts.host });
  startScheduler();

  const shownHost = opts.host === '0.0.0.0' || opts.host === '::' ? '127.0.0.1' : opts.host;
  const base = opts.publicUrl ? opts.publicUrl.replace(/\/+$/, '') : `http://${shownHost}:${opts.port}`;
  if (!auth.hasUsers()) {
    // Until the first admin exists, whoever opens the panel creates it (like Ghost).
    const url = `${base}/setup-password`;
    console.log(`\n${t('server.runningSetup')}\n\n  ${url}\n`);
    if (opts.open) openBrowser(url);
    return;
  }
  console.log(`\n${t('server.running')}\n\n  ${base}/\n`);
  if (opts.open) {
    openBrowser(`${base}/?once=${issueOneTimeLogin()}`);
    console.log(`${t('server.opened')}\n`);
  }
}

/** Opens the default browser (macOS, Windows, Linux desktop); silent if there is none. */
function openBrowser(url: string): void {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args as string[], { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
  } catch {
    // no browser: the URL is in the terminal
  }
}

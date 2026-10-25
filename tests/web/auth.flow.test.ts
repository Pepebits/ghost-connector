import { beforeAll, describe, expect, it } from 'vitest';
import * as auth from '../../src/auth/store.js';
import { base32Decode } from '../../src/auth/totp.js';
import { hotp, totpCounter } from '../../src/auth/totp.js';
import { getJob } from '../../src/db/jobs.js';
import { buildApp, issueOneTimeLogin } from '../../src/web/server.js';

type App = Awaited<ReturnType<typeof buildApp>>['app'];
const HOST = '127.0.0.1:4398';
const FORM = 'application/x-www-form-urlencoded';
const PW = 'una frase bien larga';
const cookieOf = (res: { cookies: Array<{ name: string; value: string }> }, name = 'gc_session') => {
  const c = res.cookies.find((x) => x.name === name);
  return c ? `${c.name}=${c.value}` : '';
};
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

describe('login with users, roles and 2FA', () => {
  let app: App;
  let token: string;
  let admin: string;

  const login = async (username: string, password = PW) =>
    app.inject({ method: 'POST', url: '/login', headers: { host: HOST, 'content-type': FORM }, payload: form({ username, password }) });
  const post = (url: string, cookie: string, payload: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, headers: { host: HOST, cookie, 'content-type': FORM }, payload: form(payload) });

  beforeAll(async () => {
    // No WEB_SESSION_TOKEN: the start-up token is random and only for the first admin.
    ({ app, sessionToken: token } = await buildApp({ port: 4398, host: '127.0.0.1' }));
  });

  it('no users: whoever opens the panel first creates the admin (like Ghost), and then nobody else can', async () => {
    const first = await app.inject({ method: 'GET', url: '/ideas', headers: { accept: 'text/html' } });
    expect(first.headers.location).toBe('/setup-password');
    expect((await app.inject({ method: 'GET', url: '/setup-password' })).body).toContain('name="repeat"');
    expect((await app.inject({ method: 'GET', url: '/api/posts' })).statusCode).toBe(401);

    const weak = await app.inject({ method: 'POST', url: '/setup-password', headers: { host: HOST, 'content-type': FORM }, payload: form({ username: 'ana', password: 'corta', repeat: 'corta' }) });
    expect(weak.statusCode).toBe(422);
    const ok = await app.inject({ method: 'POST', url: '/setup-password', headers: { host: HOST, 'content-type': FORM }, payload: form({ username: 'ana', password: PW, repeat: PW }) });
    expect(ok.headers.location).toBe('/account/2fa?first=1');
    admin = cookieOf(ok);
    expect(auth.findUser('ANA')?.role).toBe('owner');

    // Once it exists, nobody else can create an admin there.
    const late = await app.inject({ method: 'POST', url: '/setup-password', headers: { host: HOST, 'content-type': FORM }, payload: form({ username: 'intruso', password: PW, repeat: PW }) });
    expect(late.statusCode).not.toBe(200);
    expect(auth.findUser('intruso')).toBeNull();
    expect((await app.inject({ method: 'GET', url: `/?t=${token}`, headers: { accept: 'text/html' } })).headers.location).toMatch(/^\/login/);
  });

  it('no session: HTML goes to login with next, everything else 401', async () => {
    const html = await app.inject({ method: 'GET', url: '/ideas?x=1', headers: { accept: 'text/html' } });
    expect(html.headers.location).toBe('/login?next=%2Fideas%3Fx%3D1');
    expect((await app.inject({ method: 'GET', url: '/api/posts' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/login' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/app.css' })).statusCode).not.toBe(401);
  });

  it('correct username and password → session and back to next (never another site)', async () => {
    expect((await login('ana', 'mala')).statusCode).toBe(401);
    expect((await login('nadie')).statusCode).toBe(401);
    const res = await app.inject({ method: 'POST', url: '/login', headers: { host: HOST, 'content-type': FORM }, payload: form({ username: 'Ana', password: PW, next: '//evil.com' }) });
    expect(res.headers.location).toBe('/');
    const cookie = cookieOf(res);
    const page = await app.inject({ method: 'GET', url: '/ideas', headers: { cookie } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('href="/account"');
    const out = await post('/logout', cookie);
    expect(out.headers.location).toBe('/login');
    expect((await app.inject({ method: 'GET', url: '/api/posts', headers: { cookie } })).statusCode).toBe(401);
  });

  it('editor invite: single use, and the editor cannot open Settings', async () => {
    const created = await post('/settings/users/invite', admin, { role: 'editor' });
    const link = created.body.match(/\/invite\/([\w-]+)/)![1]!;
    expect((await app.inject({ method: 'GET', url: `/invite/${link}` })).statusCode).toBe(200);

    // A wrong form doesn't burn the link; a taken name is refused.
    expect((await app.inject({ method: 'POST', url: `/invite/${link}`, headers: { host: HOST, 'content-type': FORM }, payload: form({ username: 'ana', password: PW, repeat: PW }) })).statusCode).toBe(422);
    const ok = await app.inject({ method: 'POST', url: `/invite/${link}`, headers: { host: HOST, 'content-type': FORM }, payload: form({ username: 'luis', password: PW, repeat: PW }) });
    expect(ok.headers.location).toBe('/account/2fa?first=1');
    const editor = cookieOf(ok);
    expect((await app.inject({ method: 'GET', url: `/invite/${link}` })).statusCode).toBe(404);

    expect((await app.inject({ method: 'GET', url: '/settings', headers: { cookie: editor, accept: 'text/html' } })).statusCode).toBe(403);
    // Percent-encoded paths reach the same route: the guard must not be fooled by the URL text.
    for (const url of ['/%73ettings', '/%73ettings/activity', '/api/%73ettings/ghost-tags', '/settings%2Factivity']) {
      expect((await app.inject({ method: 'GET', url, headers: { cookie: editor } })).statusCode).not.toBe(200);
    }
    expect((await post('/%73ettings/users/invite', editor, { role: 'editor' })).statusCode).toBe(403);
    expect((await post('/settings/env', editor, { AI_MODEL: 'x' })).statusCode).toBe(403);
    expect((await post('/settings/users/invite', editor, { role: 'admin' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/settings/ghost-tags', headers: { cookie: editor } })).statusCode).toBe(403);
    const dash = await app.inject({ method: 'GET', url: '/ideas', headers: { cookie: editor } });
    expect(dash.statusCode).toBe(200);
    expect(dash.body).not.toContain('href="/settings"');
    expect((await app.inject({ method: 'GET', url: '/account', headers: { cookie: editor } })).statusCode).toBe(200);

    // Authorship: the job records who started it.
    const sync = await post('/sync', editor);
    const jobId = String(sync.headers.location).split('/').pop()!;
    expect(getJob(jobId)?.created_by).toBe('luis');

    // Ana sees Luis in Settings → Users.
    const settings = await app.inject({ method: 'GET', url: '/settings', headers: { cookie: admin } });
    expect(settings.body).toContain('luis');
  });

  it('owner: cannot be demoted or deleted; an admin only manages editors; transferred with password', async () => {
    const ana = auth.findUser('ana')!;
    const luis = auth.findUser('luis')!;
    expect(() => auth.setRole(ana.id, 'editor')).toThrow(auth.AuthError);
    expect(() => auth.deleteUser(ana.id)).toThrow(auth.AuthError);
    expect((await post(`/settings/users/${ana.id}/delete`, admin)).headers.location).toContain('users=owner');

    expect((await post(`/settings/users/${luis.id}/role`, admin, { role: 'admin' })).headers.location).toContain('roleChanged');
    expect(auth.getUser(luis.id)?.role).toBe('admin');
    const luisCookie = cookieOf(await login('luis'));
    // An admin: settings yes, but not export/import, keys, endpoints nor other admins.
    expect((await app.inject({ method: 'GET', url: '/settings', headers: { cookie: luisCookie } })).statusCode).toBe(200);
    expect((await post('/settings/export', luisCookie)).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/settings/costs', headers: { cookie: luisCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/settings/costs', headers: { cookie: admin } })).statusCode).toBe(200);
    // Results CSV: needs a session (.csv isn't a public static asset); no cache yet → 404.
    for (const url of ['/results/export.csv', '/results/x/export.csv']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).not.toBe(200);
      expect((await app.inject({ method: 'GET', url, headers: { cookie: luisCookie } })).statusCode).toBe(404);
    }
    // Default Ghost authors: saved per user, primary first.
    auth.setDefaultAuthors(luis.id, ['g2', 'g1']);
    expect(auth.defaultAuthors(luis.id)).toEqual(['g2', 'g1']);
    auth.setDefaultAuthors(luis.id, []);
    expect(auth.defaultAuthors(luis.id)).toEqual([]);
    expect((await post('/%73ettings/export', luisCookie)).statusCode).toBe(403);
    expect((await post('/settings/%65xport', luisCookie)).statusCode).toBe(403);
    expect((await post('/settings/env', luisCookie, { __group: 'ai', AI_API_KEY: 'sk-robada' })).statusCode).toBe(403);
    expect((await post('/settings/env', luisCookie, { __group: 'ai', AI_BASE_URL: 'https://evil.example/v1' })).statusCode).toBe(403);
    expect((await post('/settings/users/invite', luisCookie, { role: 'admin' })).headers.location).toContain('users=owner');
    expect((await post(`/settings/users/${ana.id}/reset-password`, luisCookie)).headers.location).toContain('users=owner');

    // Transfer: wrong password does nothing; the right one swaps owner and admin.
    expect((await post(`/settings/users/${luis.id}/transfer`, admin, { password: 'mala' })).headers.location).toContain('badPassword');
    expect(auth.getUser(ana.id)?.role).toBe('owner');
    auth.clearFailures('ana', '127.0.0.1');
    expect((await post(`/settings/users/${luis.id}/transfer`, admin, { password: PW })).headers.location).toContain('transferred');
    expect(auth.getUser(luis.id)?.role).toBe('owner');
    expect(auth.getUser(ana.id)?.role).toBe('admin');
    auth.transferOwnership(ana.id);
    auth.setRole(luis.id, 'editor');
  });

  it('password reset link: changes the password of that user and closes their sessions', async () => {
    const luis = auth.findUser('luis')!;
    const before = cookieOf(await login('luis'));
    const res = await post(`/settings/users/${luis.id}/reset-password`, admin);
    const link = res.body.match(/\/invite\/([\w-]+)/)![1]!;
    const NEW = 'otra frase todavía más larga';
    const ok = await app.inject({ method: 'POST', url: `/invite/${link}`, headers: { host: HOST, 'content-type': FORM }, payload: form({ password: NEW, repeat: NEW }) });
    expect(ok.statusCode).toBe(302);
    expect((await app.inject({ method: 'GET', url: '/api/posts', headers: { cookie: before } })).statusCode).toBe(401);
    expect((await login('luis', NEW)).statusCode).toBe(302);
    expect(auth.findUser('luis')?.role).toBe('editor');
  });

  it('with 2FA: asks for the code; a recovery code works only once', async () => {
    const ana = auth.findUser('ana')!;
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const codes = auth.enableTotp(ana.id, secret);
    const step1 = async () => {
      const r = await login('ana');
      expect(r.headers.location).toBe('/login/2fa');
      return cookieOf(r, 'gc_2fa');
    };
    let pending = await step1();
    const wrong = await app.inject({ method: 'POST', url: '/login/2fa', headers: { host: HOST, cookie: pending, 'content-type': FORM }, payload: 'code=000000' });
    expect(wrong.statusCode).toBe(401);
    const good = await app.inject({ method: 'POST', url: '/login/2fa', headers: { host: HOST, cookie: pending, 'content-type': FORM }, payload: `code=${hotp(secret, totpCounter())}` });
    expect(good.headers.location).toBe('/');
    expect(cookieOf(good)).not.toBe('');
    // Luis has no 2FA: his login is unaffected.
    expect((await login('luis', 'otra frase todavía más larga')).headers.location).toBe('/');

    pending = await step1();
    const rec = await app.inject({ method: 'POST', url: '/login/2fa', headers: { host: HOST, cookie: pending, 'content-type': FORM }, payload: `code=${codes[0]}` });
    expect(rec.headers.location).toContain('recoveryUsed');
    pending = await step1();
    const reuse = await app.inject({ method: 'POST', url: '/login/2fa', headers: { host: HOST, cookie: pending, 'content-type': FORM }, payload: `code=${codes[0]}` });
    expect(reuse.statusCode).toBe(401);
    expect(base32Decode(secret).length).toBe(20);
    auth.disableTotp(ana.id);
    auth.clearFailures('ana', '127.0.0.1');
  });

  it('single-use link (open browser) signs in as the first admin', async () => {
    const code = issueOneTimeLogin();
    const first = await app.inject({ method: 'GET', url: `/jobs?once=${code}` });
    expect(first.headers.location).toBe('/jobs');
    const cookie = cookieOf(first);
    expect((await app.inject({ method: 'GET', url: '/account', headers: { cookie } })).body).toContain('ana');
    const second = await app.inject({ method: 'GET', url: `/jobs?once=${code}`, headers: { accept: 'text/html' } });
    expect(second.headers.location).toMatch(/^\/login/);
  });

  it('after 5 failures locks that account (not others), even with the right password', async () => {
    for (let i = 0; i < 5; i++) await login('ana', 'mal');
    expect((await login('ana')).statusCode).toBe(429);
    expect((await login('luis', 'otra frase todavía más larga')).statusCode).toBe(302);
    auth.clearFailures('ana', '127.0.0.1');
  });
});

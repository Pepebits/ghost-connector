import { beforeAll, describe, expect, it } from 'vitest';
import * as auth from '../../src/auth/store.js';
import { hotp, totpCounter } from '../../src/auth/totp.js';
import { listActivity } from '../../src/team/store.js';
import { buildApp } from '../../src/web/server.js';

const HOST = '127.0.0.1:4394';
const FORM = 'application/x-www-form-urlencoded';
const PW = 'una frase bien larga';
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

describe('security hardening', () => {
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  let owner: string;
  let admin: string;

  const login = async (username: string, password = PW, ip = '127.0.0.1') => {
    const r = await app.inject({ method: 'POST', url: '/login', remoteAddress: ip, headers: { host: HOST, 'content-type': FORM }, payload: form({ username, password }) });
    const c = r.cookies.find((x) => x.name === 'gc_session');
    return { res: r, cookie: c ? `${c.name}=${c.value}` : '' };
  };
  const post = (url: string, cookie: string, payload: Record<string, string> = {}, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, headers: { host: HOST, cookie, 'content-type': FORM, ...headers }, payload: form(payload) });

  beforeAll(async () => {
    await auth.createUser('olga', PW, 'admin'); // first user: owner
    await auth.createUser('adam', PW, 'admin');
    await auth.createUser('eva', PW, 'editor');
    await auth.createUser('teo', PW, 'editor');
    ({ app } = await buildApp({ port: 4394, host: '127.0.0.1' }));
    owner = (await login('olga')).cookie;
    admin = (await login('adam')).cookie;
  });

  it('sends security headers and a nonce-based CSP', async () => {
    const r = await app.inject({ method: 'GET', url: '/login' });
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['referrer-policy']).toBe('same-origin');
    const csp = String(r.headers['content-security-policy']);
    expect(csp).toMatch(/script-src 'self' 'nonce-[\w+/=]+'/);
    expect(csp).toContain("frame-ancestors 'none'");
    const nonce = /'nonce-([^']+)'/.exec(csp)![1]!;
    expect(r.body).toContain(`<script nonce="${nonce}">`);
    expect(r.body).not.toMatch(/\son(click|focus|load)=/);
  });

  it('never redirects off-site after login, even with control characters', async () => {
    for (const next of ['//evil.test', '/\t/evil.test', '/\\evil.test', 'https://evil.test', '/%0a/evil.test'.replace('%0a', '\n')]) {
      const r = await app.inject({ method: 'POST', url: '/login', headers: { host: HOST, 'content-type': FORM }, payload: form({ username: 'olga', password: PW, next }) });
      expect(r.headers.location, JSON.stringify(next)).toBe('/');
    }
  });

  it('a lockout from one client does not lock the account elsewhere', async () => {
    for (let i = 0; i < 5; i++) await login('olga', 'mala', '203.0.113.9');
    expect((await login('olga', PW, '203.0.113.9')).res.statusCode).toBe(429);
    expect((await login('olga', PW, '198.51.100.7')).res.statusCode).toBe(302);
    auth.clearFailures('olga', '203.0.113.9');
  });

  it('limits login posts per client before hashing anything', async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await login(`nobody${i}`, 'x', '192.0.2.50')).res.statusCode;
    expect(last).toBe(429);
  });

  it('failed logins never store what was typed as an unknown username', async () => {
    await login('my secret password', 'x', '192.0.2.60');
    const row = listActivity({ limit: 1 })[0]!;
    expect(row.action).toBe('loginFailed');
    expect(JSON.stringify(row)).not.toContain('secret');
  });

  it('refuses cross-site posts that omit Origin, and ids that walk out of a folder', async () => {
    expect((await post('/sync', owner, {}, { 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/posts/..%2F..%2Fetc%2Fpasswd', headers: { cookie: owner } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/posts/..%2Fprompts/image/chosen', headers: { cookie: owner } })).statusCode).toBe(400);
  });

  it('the AI spending cap and prices are the owner\'s', async () => {
    expect((await post('/settings/env', admin, { __group: 'ai', AI_DAILY_BUDGET_USD: '9999' })).statusCode).toBe(403);
    expect((await post('/settings/env', admin, { __group: 'ai', AI_PRICES: 'deepseek-flash=0/0' })).statusCode).toBe(403);
  });

  it('a reset link never skips 2FA, and dies when its maker loses the right', async () => {
    const eva = auth.findUser('eva')!;
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    auth.enableTotp(eva.id, secret);
    const link = (await post(`/settings/users/${eva.id}/reset-password`, admin)).body.match(/\/invite\/([\w-]+)/)![1]!;
    const NEW = 'otra frase nueva y larga';
    const done = await app.inject({ method: 'POST', url: `/invite/${link}`, headers: { host: HOST, 'content-type': FORM }, payload: form({ password: NEW, repeat: NEW }) });
    expect(done.headers.location).toBe('/login?reset=1');
    expect(done.cookies.find((c) => c.name === 'gc_session')).toBeUndefined();
    const step = await login('eva', NEW);
    expect(step.res.headers.location).toBe('/login/2fa');
    expect(hotp(secret, totpCounter())).toMatch(/^\d{6}$/);

    // Adam makes a link for Teo, then is demoted to editor: the link is void.
    const teo = auth.findUser('teo')!;
    const stale = (await post(`/settings/users/${teo.id}/reset-password`, admin)).body.match(/\/invite\/([\w-]+)/)![1]!;
    auth.setRole(auth.findUser('adam')!.id, 'editor');
    const r = await app.inject({ method: 'POST', url: `/invite/${stale}`, headers: { host: HOST, 'content-type': FORM }, payload: form({ password: NEW, repeat: NEW }) });
    expect(r.statusCode).toBe(404);
    expect(await auth.verifyLogin('teo', NEW)).toBeNull();
    auth.setRole(auth.findUser('adam')!.id, 'admin');
  });

  it('an admin cannot revoke the owner\'s admin invites', async () => {
    await post('/settings/users/invite', owner, { role: 'admin' });
    const inv = auth.listInvites().find((i) => i.role === 'admin' && i.userId === null)!;
    const adm = (await login('adam')).cookie;
    expect((await post('/settings/invites/revoke', adm, { id: inv.id })).headers.location).toContain('users=owner');
    expect(auth.listInvites().some((i) => i.id === inv.id)).toBe(true);
  });
});

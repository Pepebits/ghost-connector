import { beforeAll, describe, expect, it } from 'vitest';
import { createUser, findUser } from '../../src/auth/store.js';
import { buildApp } from '../../src/web/server.js';

// app.inject() (fastify light-my-request) exercises the real hooks without opening
// any socket or touching Ghost/DeepSeek: GET routes only read the local
// SQLite index (empty in tests, see tests/setup.ts).
describe('server: security guards', () => {
  const FIXED_TOKEN = 'test-session-token';
  let app: Awaited<ReturnType<typeof buildApp>>['app'];

  beforeAll(async () => {
    if (!findUser('admin')) await createUser('admin', 'contraseña-de-test', 'admin');
    ({ app } = await buildApp({ port: 4399, host: '127.0.0.1', sessionToken: FIXED_TOKEN }));
  });

  it('rejects a request without token/cookie with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(401);
  });

  it('allows /healthz without authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
  });

  it('exchanges ?t=<token> for an httpOnly cookie and lets that same response through', async () => {
    const res = await app.inject({ method: 'GET', url: `/?t=${FIXED_TOKEN}` });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
    const cookie = res.cookies.find((c) => c.name === 'gc_session');
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
  });

  it('rejects a wrong token', async () => {
    const res = await app.inject({ method: 'GET', url: '/?t=lo-que-sea' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a POST with a foreign Origin, even with a valid session cookie', async () => {
    const auth = await app.inject({ method: 'GET', url: `/?t=${FIXED_TOKEN}` });
    const cookie = auth.cookies.find((c) => c.name === 'gc_session')!;
    const res = await app.inject({
      method: 'POST',
      url: '/sync',
      headers: { origin: 'https://evil.example.com', cookie: `${cookie.name}=${cookie.value}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a POST with an unexpected Host (also blocks DNS rebinding)', async () => {
    const res = await app.inject({ method: 'POST', url: '/sync', headers: { host: 'evil.example.com' } });
    expect(res.statusCode).toBe(403);
  });

  it('never exposes secrets (API keys) in the dashboard HTML', async () => {
    const auth = await app.inject({ method: 'GET', url: `/?t=${FIXED_TOKEN}` });
    const cookie = auth.cookies.find((c) => c.name === 'gc_session')!;
    const res = await app.inject({ method: 'GET', url: '/', headers: { cookie: `${cookie.name}=${cookie.value}` } });
    expect(res.body).not.toContain(process.env.GHOST_ADMIN_API_KEY);
    expect(res.body).not.toContain(process.env.AI_API_KEY);
  });

  it('the settings page never includes secrets, only whether they are set', async () => {
    const auth = await app.inject({ method: 'GET', url: `/?t=${FIXED_TOKEN}` });
    const cookie = auth.cookies.find((c) => c.name === 'gc_session')!;
    const res = await app.inject({ method: 'GET', url: '/settings', headers: { cookie: `${cookie.name}=${cookie.value}` } });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(process.env.AI_API_KEY);
    expect(res.body).not.toContain(process.env.GHOST_ADMIN_API_KEY!.split(':')[1]);
    expect(res.body).toContain('type="password"');
  });

  it('saving settings requires same origin (CSRF)', async () => {
    const auth = await app.inject({ method: 'GET', url: `/?t=${FIXED_TOKEN}` });
    const cookie = auth.cookies.find((c) => c.name === 'gc_session')!;
    for (const url of ['/settings/env', '/api/settings/test/ai', '/settings/openverse/register']) {
      const res = await app.inject({
        method: 'POST',
        url,
        headers: { origin: 'https://evil.example.com', cookie: `${cookie.name}=${cookie.value}`, 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'AI_BASE_URL=https://evil.example.com',
      });
      expect(res.statusCode).toBe(403);
    }
  });
});

describe('server: behind a proxy (publicUrl)', () => {
  const TOKEN = 'test-session-token';
  let app: Awaited<ReturnType<typeof buildApp>>['app'];

  beforeAll(async () => {
    ({ app } = await buildApp({ port: 4398, host: '127.0.0.1', sessionToken: TOKEN, publicUrl: 'https://ghost.example.com' }));
  });

  it('accepts the public Host and Origin and still rejects foreign ones', async () => {
    const auth = await app.inject({ method: 'GET', url: `/?t=${TOKEN}`, headers: { host: 'ghost.example.com' } });
    const cookie = auth.cookies.find((c) => c.name === 'gc_session')!;
    expect(cookie.secure).toBe(true);
    const ok = await app.inject({ method: 'POST', url: '/posts/nope/image/keep', headers: { host: 'ghost.example.com', origin: 'https://ghost.example.com', cookie: `gc_session=${cookie.value}` } });
    expect(ok.statusCode).not.toBe(403);
    const bad = await app.inject({ method: 'POST', url: '/sync', headers: { host: 'ghost.example.com', origin: 'https://evil.example.com', cookie: `gc_session=${cookie.value}` } });
    expect(bad.statusCode).toBe(403);
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { createUser, findUser } from '../../src/auth/store.js';
import { buildApp } from '../../src/web/server.js';

// app.inject() (fastify light-my-request) exercises the real hooks without opening
// any socket or touching Ghost/DeepSeek: GET routes only read the local
// SQLite index (empty in tests, see tests/setup.ts).
describe('server: guards de seguridad', () => {
  const FIXED_TOKEN = 'test-session-token';
  let app: Awaited<ReturnType<typeof buildApp>>['app'];

  beforeAll(async () => {
    if (!findUser('admin')) await createUser('admin', 'contraseña-de-test', 'admin');
    ({ app } = await buildApp({ port: 4399, host: '127.0.0.1', sessionToken: FIXED_TOKEN }));
  });

  it('rechaza una peticion sin token/cookie con 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(401);
  });

  it('permite /healthz sin autenticacion', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
  });

  it('canjea ?t=<token> por una cookie httpOnly y dejar pasar esa misma respuesta', async () => {
    const res = await app.inject({ method: 'GET', url: `/?t=${FIXED_TOKEN}` });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
    const cookie = res.cookies.find((c) => c.name === 'gc_session');
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
  });

  it('rechaza un token incorrecto', async () => {
    const res = await app.inject({ method: 'GET', url: '/?t=lo-que-sea' });
    expect(res.statusCode).toBe(401);
  });

  it('rechaza un POST con un Origin ajeno, incluso con la cookie de sesion valida', async () => {
    const auth = await app.inject({ method: 'GET', url: `/?t=${FIXED_TOKEN}` });
    const cookie = auth.cookies.find((c) => c.name === 'gc_session')!;
    const res = await app.inject({
      method: 'POST',
      url: '/sync',
      headers: { origin: 'https://evil.example.com', cookie: `${cookie.name}=${cookie.value}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rechaza un POST con un Host inesperado (cierra tambien DNS rebinding)', async () => {
    const res = await app.inject({ method: 'POST', url: '/sync', headers: { host: 'evil.example.com' } });
    expect(res.statusCode).toBe(403);
  });

  it('nunca expone secretos (API keys) en el HTML del dashboard', async () => {
    const auth = await app.inject({ method: 'GET', url: `/?t=${FIXED_TOKEN}` });
    const cookie = auth.cookies.find((c) => c.name === 'gc_session')!;
    const res = await app.inject({ method: 'GET', url: '/', headers: { cookie: `${cookie.name}=${cookie.value}` } });
    expect(res.body).not.toContain(process.env.GHOST_ADMIN_API_KEY);
    expect(res.body).not.toContain(process.env.AI_API_KEY);
  });

  it('la pagina de configuracion nunca incluye los secretos, solo si estan configurados', async () => {
    const auth = await app.inject({ method: 'GET', url: `/?t=${FIXED_TOKEN}` });
    const cookie = auth.cookies.find((c) => c.name === 'gc_session')!;
    const res = await app.inject({ method: 'GET', url: '/settings', headers: { cookie: `${cookie.name}=${cookie.value}` } });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(process.env.AI_API_KEY);
    expect(res.body).not.toContain(process.env.GHOST_ADMIN_API_KEY!.split(':')[1]);
    expect(res.body).toContain('type="password"');
  });

  it('guardar la configuracion exige el mismo origen (CSRF)', async () => {
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

describe('server: detras de un proxy (publicUrl)', () => {
  const TOKEN = 'test-session-token';
  let app: Awaited<ReturnType<typeof buildApp>>['app'];

  beforeAll(async () => {
    ({ app } = await buildApp({ port: 4398, host: '127.0.0.1', sessionToken: TOKEN, publicUrl: 'https://ghost.example.com' }));
  });

  it('acepta el Host y el Origin publicos y sigue rechazando los ajenos', async () => {
    const auth = await app.inject({ method: 'GET', url: `/?t=${TOKEN}`, headers: { host: 'ghost.example.com' } });
    const cookie = auth.cookies.find((c) => c.name === 'gc_session')!;
    expect(cookie.secure).toBe(true);
    const ok = await app.inject({ method: 'POST', url: '/posts/nope/image/keep', headers: { host: 'ghost.example.com', origin: 'https://ghost.example.com', cookie: `gc_session=${cookie.value}` } });
    expect(ok.statusCode).not.toBe(403);
    const bad = await app.inject({ method: 'POST', url: '/sync', headers: { host: 'ghost.example.com', origin: 'https://evil.example.com', cookie: `gc_session=${cookie.value}` } });
    expect(bad.statusCode).toBe(403);
  });
});

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reloadConfig } from '../../src/config.js';
import { t } from '../../src/i18n/index.js';
import { createUser, findUser } from '../../src/auth/store.js';
import { buildApp } from '../../src/web/server.js';

describe('i18n: t()', () => {
  it('cae al ingles si el idioma no tiene la clave, y a la clave si nadie la tiene', () => {
    expect(t('settings.title', undefined, 'xx')).toBe('Settings');
    expect(t('settings.no.such.key')).toBe('settings.no.such.key');
  });

  it('plurales en ingles y en espanol', () => {
    expect(t('settings.cost.runs', { count: 1 }, 'en')).toBe('in 1 run');
    expect(t('settings.cost.runs', { count: 3 }, 'en')).toBe('in 3 runs');
    expect(t('settings.cost.runs', { count: 1 }, 'es')).toBe('en 1 ejecución');
    expect(t('settings.index.count', { count: 2 }, 'es')).toBe('2 artefactos indexados.');
  });
});

describe('POST /settings/language', () => {
  const TOKEN = 'i18n-token';
  const PORT = 4398;
  const envFile = join(mkdtempSync(join(tmpdir(), 'gc-i18n-')), '.env');
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  let cookie: string;
  const previous = process.env.UI_LANGUAGE;
  const headers = () => ({ host: `127.0.0.1:${PORT}`, cookie, 'content-type': 'application/x-www-form-urlencoded' });

  beforeAll(async () => {
    if (!findUser('admin')) await createUser('admin', 'contraseña-de-test', 'admin');
    writeFileSync(envFile, 'UI_LANGUAGE=en\n');
    ({ app } = await buildApp({ port: PORT, host: '127.0.0.1', sessionToken: TOKEN, envFile }));
    const auth = await app.inject({ method: 'GET', url: `/healthz?t=${TOKEN}` });
    const c = (await app.inject({ method: 'GET', url: `/settings?t=${TOKEN}` })).cookies.find((x) => x.name === 'gc_session') ?? auth.cookies[0]!;
    cookie = `${c.name}=${c.value}`;
  });

  afterAll(() => {
    if (previous === undefined) delete process.env.UI_LANGUAGE;
    else process.env.UI_LANGUAGE = previous;
    reloadConfig();
  });

  it('rechaza un idioma desconocido sin tocar el .env', async () => {
    const res = await app.inject({ method: 'POST', url: '/settings/language', headers: headers(), payload: 'lang=xx' });
    expect(res.statusCode).toBe(400);
    expect(readFileSync(envFile, 'utf8')).toBe('UI_LANGUAGE=en\n');
  });

  it('cambia a espanol, vuelve al Referer y la pagina sale en espanol', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/settings/language',
      headers: { ...headers(), referer: `http://127.0.0.1:${PORT}/settings` },
      payload: 'lang=es',
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/settings');
    expect(readFileSync(envFile, 'utf8')).toContain('UI_LANGUAGE=es');
    const page = await app.inject({ method: 'GET', url: '/settings', headers: { cookie } });
    expect(page.body).toContain('<html lang="es">');
    expect(page.body).toContain('Configuración');

    const back = await app.inject({ method: 'POST', url: '/settings/language', headers: { ...headers(), referer: 'https://evil.example.com/x' }, payload: 'lang=en' });
    expect(back.headers.location).toBe('/');
    expect((await app.inject({ method: 'GET', url: '/settings', headers: { cookie } })).body).toContain('Interface language');
  });
});

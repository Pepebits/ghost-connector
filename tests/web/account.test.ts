import { beforeAll, describe, expect, it } from 'vitest';
import * as auth from '../../src/auth/store.js';
import { buildApp } from '../../src/web/server.js';
import { deviceLabel, recoveryCodesPage } from '../../src/web/views/auth.js';

const HOST = '127.0.0.1:4393';
const FORM = 'application/x-www-form-urlencoded';
const PW = 'una frase bien larga';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

describe('my account', () => {
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  const login = async (username: string, ua: string) => {
    const r = await app.inject({ method: 'POST', url: '/login', headers: { host: HOST, 'content-type': FORM, 'user-agent': ua }, payload: `username=${username}&password=${encodeURIComponent(PW)}` });
    const c = r.cookies.find((x) => x.name === 'gc_session')!;
    return `${c.name}=${c.value}`;
  };

  beforeAll(async () => {
    await auth.createUser('ana', PW, 'admin');
    await auth.createUser('luis', PW, 'editor');
    ({ app } = await buildApp({ port: 4393, host: '127.0.0.1' }));
  });

  it('names devices from their User-Agent', () => {
    expect(deviceLabel(MAC)).toBe('Chrome · macOS');
    expect(deviceLabel(IPHONE)).toBe('Safari · iOS');
    expect(deviceLabel('')).toBe('Unknown device');
  });

  it('lists the sessions with their device, marks this one, and closes another', async () => {
    const mac = await login('ana', MAC);
    await login('ana', IPHONE);
    const page = await app.inject({ method: 'GET', url: '/account', headers: { cookie: mac } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Chrome · macOS');
    expect(page.body).toContain('Safari · iOS');
    expect(page.body).toContain('This device');
    expect(page.body).not.toContain('[object Object]');
    expect(page.body).toMatch(/Account created on/);

    const ana = auth.findUser('ana')!;
    const phone = auth.listUserSessions(ana.id).find((s) => s.userAgent === IPHONE)!;
    const r = await app.inject({ method: 'POST', url: `/account/sessions/${phone.id}/revoke`, headers: { host: HOST, cookie: mac } });
    expect(r.headers.location).toBe('/account?sec=sessionRevoked');
    expect(auth.listUserSessions(ana.id).map((s) => s.userAgent)).toEqual([MAC]);
  });

  it("can't close someone else's session", async () => {
    const mac = await login('ana', MAC);
    await login('luis', IPHONE);
    const luisSession = auth.listUserSessions(auth.findUser('luis')!.id)[0]!;
    await app.inject({ method: 'POST', url: `/account/sessions/${luisSession.id}/revoke`, headers: { host: HOST, cookie: mac } });
    expect(auth.listUserSessions(auth.findUser('luis')!.id).some((s) => s.id === luisSession.id)).toBe(true);
  });

  it('shows failed logins with your username in your account activity', async () => {
    await app.inject({ method: 'POST', url: '/login', remoteAddress: '203.0.113.20', headers: { host: HOST, 'content-type': FORM }, payload: 'username=ana&password=wrong' });
    const mac = await login('ana', MAC);
    const page = await app.inject({ method: 'GET', url: '/account', headers: { cookie: mac } });
    expect(page.body).toMatch(/Failed login attempt as/);
    // Several logins in a row show as one line with a count.
    expect(page.body).toMatch(/Logged in <span class="text-xs text-muted">· \d+ times/);
  });

  it('recovery codes select as plain text and can be copied or downloaded all at once', () => {
    const html = recoveryCodesPage(['aaaaa-11111', 'bbbbb-22222']);
    // user-select: all per code made a drag across several codes jump around.
    expect(html).not.toContain('select-all');
    expect(html).toContain('data-copy-codes');
    expect(html).toContain('data-download-codes');
  });
});

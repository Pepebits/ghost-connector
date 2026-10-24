import { beforeAll, describe, expect, it } from 'vitest';
import * as auth from '../../src/auth/store.js';
import { runWithUser } from '../../src/auth/context.js';
import * as team from '../../src/team/store.js';
import { buildApp } from '../../src/web/server.js';

const HOST = '127.0.0.1:4397';
const FORM = 'application/x-www-form-urlencoded';
const PW = 'una frase bien larga';
const POST = '6a11e93c0000000000000001';

describe('teamwork: activity, assignments, notes and presence', () => {
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  let ana: string;
  let luis: string;

  const login = async (username: string, password = PW) => {
    const r = await app.inject({ method: 'POST', url: '/login', headers: { host: HOST, 'content-type': FORM }, payload: new URLSearchParams({ username, password }).toString() });
    const c = r.cookies.find((x) => x.name === 'gc_session');
    return c ? `${c.name}=${c.value}` : '';
  };
  const post = (url: string, cookie: string, payload: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, headers: { host: HOST, cookie, 'content-type': FORM, origin: `http://${HOST}` }, payload: new URLSearchParams(payload).toString() });

  beforeAll(async () => {
    await auth.createUser('ana', PW, 'admin');
    await auth.createUser('luis', PW, 'editor');
    ({ app } = await buildApp({ port: 4397, host: '127.0.0.1', sessionToken: 'team-token-de-24-caracteres' }));
    ana = await login('ana');
    luis = await login('luis');
  });

  it('the log records sign-ins and failures, and only an admin sees it', async () => {
    await login('ana', 'mala');
    const rows = team.listActivity({ limit: 10 });
    expect(rows.some((r) => r.action === 'login' && r.actor === 'luis')).toBe(true);
    expect(rows.some((r) => r.action === 'loginFailed' && r.target === 'ana' && r.actor === null)).toBe(true);
    auth.clearFailures('ana', '127.0.0.1');

    const page = await app.inject({ method: 'GET', url: '/settings/activity?actor=luis', headers: { cookie: ana } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('luis');
    expect(page.body).not.toContain('mala'); // passwords never reach the log
    expect((await app.inject({ method: 'GET', url: '/settings/activity', headers: { cookie: luis } })).statusCode).toBe(403);
  });

  it('assigning a post: logged and shown under "Mine"', async () => {
    expect((await post(`/posts/${POST}/assign`, ana, { username: 'nadie' })).statusCode).toBe(400);
    expect((await post(`/posts/${POST}/assign`, ana, { username: 'LUIS' })).headers.location).toBe(`/posts/${POST}`);
    expect(team.getAssignment(POST)).toMatchObject({ username: 'luis', assignedBy: 'ana' });
    expect(team.listActivity({ limit: 1 })[0]).toMatchObject({ action: 'assigned', actor: 'ana', detail: 'luis' });
    expect(team.allAssignments().get(POST)).toBe('luis');

    await post(`/posts/${POST}/assign`, ana, { username: '' });
    expect(team.getAssignment(POST)).toBeNull();
  });

  it('notes: each user deletes their own; an admin, any', async () => {
    await post(`/posts/${POST}/notes`, luis, { text: '  Falta revisar las cifras  ' });
    await post(`/posts/${POST}/notes`, ana, { text: '   ' }); // empty: ignored
    const [note] = team.listNotes(POST);
    expect(team.listNotes(POST)).toHaveLength(1);
    expect(note).toMatchObject({ author: 'luis', text: 'Falta revisar las cifras' });

    await post(`/posts/${POST}/notes`, ana, { text: 'Es mía' });
    const anas = team.listNotes(POST)[1]!;
    expect((await post(`/posts/${POST}/notes/${anas.id}/delete`, luis)).statusCode).toBe(403);
    expect((await post(`/posts/${POST}/notes/${note!.id}/delete`, ana)).statusCode).toBe(302);
    expect(team.listNotes(POST).map((n) => n.author)).toEqual(['ana']);
  });

  it('presence: shows who else has the post open, and expires', async () => {
    const first = await app.inject({ method: 'POST', url: `/api/posts/${POST}/presence`, headers: { host: HOST, cookie: ana } });
    expect(first.json().html).toBe('');
    const second = await app.inject({ method: 'POST', url: `/api/posts/${POST}/presence`, headers: { host: HOST, cookie: luis } });
    expect(second.json().html).toContain('ana');
    expect(team.presenceByPost('ana').get(POST)).toEqual(['luis']);
    expect(team.othersOnPost(POST, 'ana', Date.now() + team.PRESENCE_MS + 1)).toEqual([]);
  });

  it('deleting a user frees their posts, but their notes keep the name', async () => {
    const tmp = await auth.createUser('temporal', PW, 'editor');
    runWithUser(tmp, () => team.addNote(POST, 'Nota de temporal'));
    team.assignPost(POST, 'temporal');
    auth.deleteUser(tmp.id);
    expect(team.getAssignment(POST)).toBeNull();
    expect(team.listNotes(POST).some((n) => n.author === 'temporal')).toBe(true);
  });

  it('changing settings logs what changed, never the value', () => {
    runWithUser(auth.findUser('ana'), () => team.logActivity('settingsSaved', { detail: 'AI_API_KEY' }));
    const row = team.listActivity({ limit: 1 })[0]!;
    expect(row).toMatchObject({ actor: 'ana', action: 'settingsSaved', detail: 'AI_API_KEY' });
  });
});

import { currentActor } from '../auth/context.js';
import { getDb, safeWrite } from '../db/index.js';

/**
 * Working as a team: an activity log (logins, users, settings), who each
 * post is assigned to, notes on a post, and who has it open right now.
 */

// ---------- activity log ----------

export type ActivityAction =
  | 'login'
  | 'loginFailed'
  | 'logout'
  | 'twoFactorOn'
  | 'twoFactorOff'
  | 'passwordChanged'
  | 'sessionsRevoked'
  | 'userInvited'
  | 'userJoined'
  | 'passwordReset'
  | 'passwordLink'
  | 'userRole'
  | 'userDeleted'
  | 'ownership'
  | 'userTwoFactorReset'
  | 'inviteRevoked'
  | 'settingsSaved'
  | 'language'
  | 'promptSaved'
  | 'promptReset'
  | 'promptReverted'
  | 'exported'
  | 'imported'
  | 'reindex'
  | 'openverse'
  | 'assigned'
  | 'unassigned';

export interface ActivityRow {
  id: number;
  at: string;
  actor: string | null;
  action: ActivityAction;
  target: string | null;
  detail: string | null;
}

const KEEP_DAYS = 365;
const KEEP_ROWS = 20_000;
let writes = 0;

/** Records an action. `actor` defaults to whoever is behind the request. Never breaks the action itself. */
export function logActivity(action: ActivityAction, o: { target?: string | null; detail?: string | null; actor?: string | null } = {}): void {
  safeWrite('logActivity', (db) => {
    db.prepare('INSERT INTO activity (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)').run(
      new Date().toISOString(),
      o.actor !== undefined ? o.actor : currentActor(),
      action,
      o.target?.slice(0, 200) ?? null,
      o.detail?.slice(0, 500) ?? null,
    );
    // Prune now and then: a year, and never more than KEEP_ROWS (failed logins can pile up).
    if (++writes % 200 === 1) {
      db.prepare('DELETE FROM activity WHERE at < ?').run(new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString());
      db.prepare('DELETE FROM activity WHERE id <= (SELECT MAX(id) FROM activity) - ?').run(KEEP_ROWS);
    }
  });
}

export function listActivity(o: { limit?: number; actor?: string; before?: number } = {}): ActivityRow[] {
  const where: string[] = [];
  const args: Array<string | number> = [];
  if (o.actor) {
    where.push('actor = ? COLLATE NOCASE');
    args.push(o.actor);
  }
  if (o.before) {
    where.push('id < ?');
    args.push(o.before);
  }
  args.push(Math.min(o.limit ?? 50, 500));
  return getDb()
    .prepare(`SELECT * FROM activity ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`)
    .all(...args) as unknown as ActivityRow[];
}

/** Everyone who appears in the log (for the filter). */
export function activityActors(): string[] {
  return (getDb().prepare('SELECT DISTINCT actor FROM activity WHERE actor IS NOT NULL ORDER BY actor COLLATE NOCASE').all() as Array<{ actor: string }>).map((r) => r.actor);
}

// ---------- assignments ----------

export interface Assignment {
  username: string;
  assignedBy: string | null;
  at: string;
}

export function getAssignment(postId: string): Assignment | null {
  const r = getDb().prepare('SELECT username, assigned_by, at FROM post_assignments WHERE post_id = ?').get(postId) as { username: string; assigned_by: string | null; at: string } | undefined;
  return r ? { username: r.username, assignedBy: r.assigned_by, at: r.at } : null;
}

/** post id → assignee. */
export function allAssignments(): Map<string, string> {
  const rows = getDb().prepare('SELECT post_id, username FROM post_assignments').all() as Array<{ post_id: string; username: string }>;
  return new Map(rows.map((r) => [r.post_id, r.username]));
}

/** Assigns (or, with null, unassigns) a post. */
export function assignPost(postId: string, username: string | null): void {
  if (username) {
    getDb()
      .prepare('INSERT INTO post_assignments (post_id, username, assigned_by, at) VALUES (?, ?, ?, ?) ON CONFLICT(post_id) DO UPDATE SET username = excluded.username, assigned_by = excluded.assigned_by, at = excluded.at')
      .run(postId, username, currentActor(), new Date().toISOString());
  } else {
    getDb().prepare('DELETE FROM post_assignments WHERE post_id = ?').run(postId);
  }
}

/** A user leaves: their posts go back to nobody (the notes keep their name). */
export function unassignUser(username: string): void {
  getDb().prepare('DELETE FROM post_assignments WHERE username = ? COLLATE NOCASE').run(username);
}

// ---------- notes ----------

export const MAX_NOTE = 2000;

export interface PostNote {
  id: number;
  postId: string;
  at: string;
  author: string | null;
  text: string;
}

export function listNotes(postId: string): PostNote[] {
  const rows = getDb().prepare('SELECT id, post_id, at, author, text FROM post_notes WHERE post_id = ? ORDER BY id').all(postId) as Array<{ id: number; post_id: string; at: string; author: string | null; text: string }>;
  return rows.map((r) => ({ id: r.id, postId: r.post_id, at: r.at, author: r.author, text: r.text }));
}

/** post id → number of notes. */
export function noteCounts(): Map<string, number> {
  const rows = getDb().prepare('SELECT post_id, COUNT(*) AS n FROM post_notes GROUP BY post_id').all() as Array<{ post_id: string; n: number }>;
  return new Map(rows.map((r) => [r.post_id, r.n]));
}

export function addNote(postId: string, text: string): PostNote | null {
  const clean = text.replace(/\r\n/g, '\n').trim().slice(0, MAX_NOTE);
  if (!clean) return null;
  const at = new Date().toISOString();
  const author = currentActor();
  const r = getDb().prepare('INSERT INTO post_notes (post_id, at, author, text) VALUES (?, ?, ?, ?)').run(postId, at, author, clean);
  return { id: Number(r.lastInsertRowid), postId, at, author, text: clean };
}

/** Deletes a note: its author, or an admin. Returns whether it was deleted. */
export function deleteNote(id: number, by: { username: string; admin: boolean }): boolean {
  const r = getDb().prepare('SELECT author FROM post_notes WHERE id = ?').get(id) as { author: string | null } | undefined;
  if (!r || (!by.admin && r.author?.toLowerCase() !== by.username.toLowerCase())) return false;
  getDb().prepare('DELETE FROM post_notes WHERE id = ?').run(id);
  return true;
}

// ---------- who has a post open (in memory: it only matters right now) ----------

export const PRESENCE_MS = 3 * 60_000;
const presence = new Map<string, Map<string, number>>();

export function touchPresence(postId: string, username: string, now = Date.now()): void {
  let users = presence.get(postId);
  if (!users) presence.set(postId, (users = new Map()));
  users.set(username, now);
}

/** Other users with this post open in the last few minutes, most recent first. */
export function othersOnPost(postId: string, me: string, now = Date.now()): Array<{ username: string; at: number }> {
  const users = presence.get(postId);
  if (!users) return [];
  const out: Array<{ username: string; at: number }> = [];
  for (const [username, at] of users) {
    if (now - at > PRESENCE_MS) users.delete(username);
    else if (username.toLowerCase() !== me.toLowerCase()) out.push({ username, at });
  }
  if (!users.size) presence.delete(postId);
  return out.sort((a, b) => b.at - a.at);
}

/** post id → who else has it open (for the dashboard). */
export function presenceByPost(me: string, now = Date.now()): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const postId of [...presence.keys()]) {
    const others = othersOnPost(postId, me, now);
    if (others.length) out.set(postId, others.map((o) => o.username));
  }
  return out;
}

/** Who started the latest plan of a post (null: nightly plan, CLI, or never planned). */
export function lastPlannedBy(postId: string): { by: string | null; at: string } | null {
  if (!/^[\w-]+$/.test(postId)) return null;
  const r = getDb()
    .prepare(`SELECT created_by, created_at FROM jobs WHERE type = 'plan' AND params_json LIKE ? ORDER BY created_at DESC LIMIT 1`)
    .get(`%"${postId}"%`) as { created_by: string | null; created_at: string } | undefined;
  return r ? { by: r.created_by, at: r.created_at } : null;
}

/** The post's title from the local index (for the activity log), or its id. */
export function postTitle(postId: string): string {
  const r = getDb().prepare('SELECT title FROM posts_live WHERE post_id = ?').get(postId) as { title: string | null } | undefined;
  return r?.title || postId;
}

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import pLimit from 'p-limit';
import { getDb } from '../db/index.js';
import type { AuthUser, Role } from './context.js';
import { verifyTotp } from './totp.js';

export type { AuthUser, Role } from './context.js';

/**
 * Panel users: each one with a password (scrypt hash), optional TOTP 2FA
 * with recovery codes, and server-side sessions. Two roles: admin (all,
 * including settings and users) and editor (all the editorial work, no
 * settings). New users come in through single-use invite links. Everything
 * lives in the local SQLite; writes are NOT best-effort like the index ones.
 */

const scryptRaw = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/**
 * scrypt is slow and memory-hungry on purpose (~100 ms, 32 MB): at most a few
 * at once, and a short queue. Past that the server answers "busy" instead of
 * letting a flood of logins (even with made-up users) starve everything else.
 */
const hashing = pLimit(3);
const MAX_QUEUED = 24;
export class AuthBusyError extends Error {}
const scrypt: typeof scryptRaw = (pw, salt, len, opts) => {
  if (hashing.pendingCount >= MAX_QUEUED) return Promise.reject(new AuthBusyError('busy'));
  return hashing(() => scryptRaw(pw, salt, len, opts));
};
export const MIN_PASSWORD = 10;
export const SESSION_DAYS = 30;
export const INVITE_DAYS = 7;
/** Roles that can be given (the owner is only ever transferred). */
export const ROLES: Array<Exclude<Role, 'owner'>> = ['admin', 'editor'];
const USERNAME = /^[\p{L}\p{N}._@+-]{2,64}$/u;

const AUTH_ERRORS = {
  badUsername: 'The username must have 2-64 letters, digits or . _ @ + -',
  taken: 'That username is already taken',
  weakPassword: `The password must have at least ${MIN_PASSWORD} characters`,
  lastAdmin: 'The panel needs at least one admin',
  notFound: 'No such user or link',
  owner: 'Not possible on the owner: transfer the ownership first',
  badRole: 'The role must be admin or editor',
};

/** Error with a code the UI translates (auth.errors.<code>); the message is for the CLI. */
export class AuthError extends Error {
  constructor(readonly code: keyof typeof AUTH_ERRORS) {
    super(AUTH_ERRORS[code]);
  }
}

interface UserRow {
  id: number;
  username: string;
  role: Role;
  password_hash: string;
  totp_secret: string | null;
  totp_last: number | null;
  recovery_json: string | null;
  nag_until: number | null;
  created_at: string;
}

const db = () => getDb();
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const row = (id: number) => db().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
const toUser = (r: UserRow): AuthUser => ({ id: r.id, username: r.username, role: r.role });
const isRole = (r: unknown): r is Exclude<Role, 'owner'> => r === 'admin' || r === 'editor';

// ---------- passwords ----------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function checkPasswordHash(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const got = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return timingSafeEqual(got, expected);
}

function checkNewPassword(password: string): void {
  if (password.length < MIN_PASSWORD) throw new AuthError('weakPassword');
}

// ---------- users ----------

export function hasUsers(): boolean {
  return !!db().prepare('SELECT 1 FROM users LIMIT 1').get();
}

export function getUser(id: number): AuthUser | null {
  const r = row(id);
  return r ? toUser(r) : null;
}

export function findUser(username: string): AuthUser | null {
  const r = db().prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username.trim()) as UserRow | undefined;
  return r ? toUser(r) : null;
}

/** The owner (or, failing that, the oldest admin): who the start-up links log in as. */
export function firstAdmin(): AuthUser | null {
  const r = db().prepare("SELECT * FROM users WHERE role IN ('owner', 'admin') ORDER BY role = 'owner' DESC, id LIMIT 1").get() as UserRow | undefined;
  return r ? toUser(r) : null;
}

export interface UserListItem extends AuthUser {
  totp: boolean;
  createdAt: string;
  sessions: number;
  lastSeen: string | null;
}

export function listUsers(): UserListItem[] {
  pruneSessions();
  const rows = db()
    .prepare(
      `SELECT u.*, COUNT(s.id_hash) AS sessions, MAX(s.last_seen) AS last_seen
       FROM users u LEFT JOIN auth_sessions s ON s.user_id = u.id GROUP BY u.id ORDER BY u.id`,
    )
    .all() as unknown as Array<UserRow & { sessions: number; last_seen: string | null }>;
  return rows.map((r) => ({ ...toUser(r), totp: !!r.totp_secret, createdAt: r.created_at, sessions: r.sessions, lastSeen: r.last_seen }));
}

function countAdmins(): number {
  return (db().prepare("SELECT COUNT(*) AS n FROM users WHERE role IN ('owner', 'admin')").get() as { n: number }).n;
}

/** The very first user is always the owner, whatever was asked. */
export async function createUser(username: string, password: string, asked: Exclude<Role, 'owner'>): Promise<AuthUser> {
  const name = username.trim();
  if (!USERNAME.test(name)) throw new AuthError('badUsername');
  if (!isRole(asked)) throw new AuthError('badRole');
  const role: Role = hasUsers() ? asked : 'owner';
  checkNewPassword(password);
  if (findUser(name)) throw new AuthError('taken');
  const hash = await hashPassword(password);
  // Re-checked after the (slow) hash: another request may have taken the name meanwhile.
  if (findUser(name)) throw new AuthError('taken');
  const r = db().prepare('INSERT INTO users (username, role, password_hash, created_at) VALUES (?, ?, ?, ?)').run(name, role, hash, new Date().toISOString());
  return { id: Number(r.lastInsertRowid), username: name, role };
}

/** Changing the role never leaves the panel without an admin. */
export function setRole(id: number, role: Exclude<Role, 'owner'>): void {
  if (!isRole(role)) throw new AuthError('badRole');
  const r = row(id);
  if (!r) throw new AuthError('notFound');
  if (r.role === 'owner') throw new AuthError('owner');
  if (r.role === 'admin' && role !== 'admin' && countAdmins() <= 1) throw new AuthError('lastAdmin');
  db().prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  dropResetLinks(id);
}

export function deleteUser(id: number): void {
  const r = row(id);
  if (!r) throw new AuthError('notFound');
  if (r.role === 'owner') throw new AuthError('owner');
  if (r.role === 'admin' && countAdmins() <= 1) throw new AuthError('lastAdmin');
  db().prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(id);
  db().prepare('DELETE FROM invites WHERE user_id = ?').run(id);
  db().prepare('DELETE FROM post_assignments WHERE username = ? COLLATE NOCASE').run(r.username); // their posts go back to nobody
  db().prepare('DELETE FROM users WHERE id = ?').run(id);
}

/** Hands the ownership to another user: they become owner, the current owner becomes admin. */
export function transferOwnership(toId: number): void {
  const to = row(toId);
  if (!to) throw new AuthError('notFound');
  if (to.role === 'owner') return;
  db().exec('BEGIN');
  try {
    db().prepare("UPDATE users SET role = 'admin' WHERE role = 'owner'").run();
    db().prepare("UPDATE users SET role = 'owner' WHERE id = ?").run(toId);
    // Links made under the old roles must not outlive them.
    db().exec("DELETE FROM invites WHERE user_id IS NOT NULL");
    db().exec('COMMIT');
  } catch (err) {
    db().exec('ROLLBACK');
    throw err;
  }
}

/** Username + password → user, or null. Spends the same time when the user doesn't exist. */
export async function verifyLogin(username: string, password: string): Promise<AuthUser | null> {
  const r = db().prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username.trim()) as UserRow | undefined;
  if (!r) {
    await hashPassword(password);
    return null;
  }
  return (await checkPasswordHash(password, r.password_hash)) ? toUser(r) : null;
}

export async function verifyPassword(id: number, password: string): Promise<boolean> {
  const r = row(id);
  return !!r && checkPasswordHash(password, r.password_hash);
}

/** Sets (or changes) a user's password and closes every session of theirs. */
export async function setPassword(id: number, password: string): Promise<void> {
  checkNewPassword(password);
  if (!row(id)) throw new AuthError('notFound');
  db().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), id);
  revokeAllSessions(id);
}

// ---------- 2FA ----------

export function totpEnabled(id: number): boolean {
  return !!row(id)?.totp_secret;
}

/** Enables 2FA with a confirmed secret; returns the recovery codes (shown once). */
export function enableTotp(id: number, secret: string): string[] {
  db().prepare('UPDATE users SET totp_secret = ?, totp_last = NULL WHERE id = ?').run(secret, id);
  return newRecoveryCodes(id);
}

export function disableTotp(id: number): void {
  db().prepare('UPDATE users SET totp_secret = NULL, totp_last = NULL, recovery_json = NULL WHERE id = ?').run(id);
  dropResetLinks(id);
}

/** Pending "new password" links for a user, made void (role or 2FA changed). */
function dropResetLinks(userId: number): void {
  db().prepare('DELETE FROM invites WHERE user_id = ?').run(userId);
}

export function newRecoveryCodes(id: number): string[] {
  const codes = Array.from({ length: 10 }, () => {
    const raw = randomBytes(5).toString('hex');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  db().prepare('UPDATE users SET recovery_json = ? WHERE id = ?').run(JSON.stringify(codes.map((c) => sha256(c))), id);
  return codes;
}

export function recoveryCodesLeft(id: number): number {
  return (JSON.parse(row(id)?.recovery_json ?? '[]') as string[]).length;
}

/** A 6-digit app code (not replayable) or a single-use recovery code. */
export function verifySecondFactor(id: number, code: string, now = Date.now()): 'totp' | 'recovery' | null {
  const r = row(id);
  if (!r?.totp_secret) return null;
  const counter = verifyTotp(r.totp_secret, code, now, r.totp_last ?? -1);
  if (counter !== null) {
    db().prepare('UPDATE users SET totp_last = ? WHERE id = ?').run(counter, id);
    return 'totp';
  }
  const clean = code.trim().toLowerCase();
  if (!/^[0-9a-f]{5}-?[0-9a-f]{5}$/.test(clean)) return null;
  const normalized = clean.includes('-') ? clean : `${clean.slice(0, 5)}-${clean.slice(5)}`;
  const hashes = JSON.parse(r.recovery_json ?? '[]') as string[];
  const h = sha256(normalized);
  if (!hashes.includes(h)) return null;
  db().prepare('UPDATE users SET recovery_json = ? WHERE id = ?').run(JSON.stringify(hashes.filter((x) => x !== h)), id);
  return 'recovery';
}

/** Only checks a code against a secret not saved yet (enabling 2FA). */
export function checkNewTotp(secret: string, code: string): boolean {
  return verifyTotp(secret, code) !== null;
}

export function nagUntil(id: number): number {
  return row(id)?.nag_until ?? 0;
}
export function snooze2faNag(id: number, days = 30): void {
  db().prepare('UPDATE users SET nag_until = ? WHERE id = ?').run(Date.now() + days * 86400_000, id);
}

// ---------- invites and password resets ----------

export interface Invite {
  /** Hash of the link's token: identifies it in the UI without revealing it. */
  id: string;
  role: Role;
  /** Set for a password reset of an existing user. */
  userId: number | null;
  username: string | null;
  createdBy: string | null;
  expiresAt: string;
}

/** Single-use link to join (role) or to set a new password (userId). Returns the token. */
export function createInvite(o: { role: Role; userId?: number; createdBy?: string | null }): string {
  if (o.userId === undefined && !isRole(o.role)) throw new AuthError('badRole');
  const token = randomBytes(24).toString('base64url');
  const now = new Date();
  if (o.userId !== undefined) db().prepare('DELETE FROM invites WHERE user_id = ?').run(o.userId); // one reset at a time
  db()
    .prepare('INSERT INTO invites (id_hash, role, user_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sha256(token), o.role, o.userId ?? null, o.createdBy ?? null, now.toISOString(), new Date(now.getTime() + INVITE_DAYS * 86400_000).toISOString());
  return token;
}

function pruneInvites(): void {
  db().prepare('DELETE FROM invites WHERE expires_at < ?').run(new Date().toISOString());
}

export function listInvites(): Invite[] {
  pruneInvites();
  const rows = db()
    .prepare('SELECT i.*, u.username FROM invites i LEFT JOIN users u ON u.id = i.user_id ORDER BY i.created_at DESC')
    .all() as unknown as Array<{ id_hash: string; role: Role; user_id: number | null; username: string | null; created_by: string | null; expires_at: string }>;
  return rows.map((r) => ({ id: r.id_hash, role: r.role, userId: r.user_id, username: r.username, createdBy: r.created_by, expiresAt: r.expires_at }));
}

export function findInvite(token: string | undefined): Invite | null {
  if (!token) return null;
  return listInvites().find((i) => i.id === sha256(token)) ?? null;
}

export function revokeInvite(id: string): void {
  db().prepare('DELETE FROM invites WHERE id_hash = ?').run(id);
}

/**
 * Uses a link: creates the user (invite) or changes their password (reset).
 * The link is spent only if it worked, so a typo in the form doesn't burn it.
 */
export async function acceptInvite(token: string, o: { username?: string; password: string }): Promise<AuthUser> {
  const invite = findInvite(token);
  if (!invite) throw new AuthError('notFound');
  // Claim it first (only one DELETE can remove the row, even with two tabs at once)…
  const saved = db().prepare('SELECT * FROM invites WHERE id_hash = ?').get(invite.id) as { id_hash: string; role: string; user_id: number | null; created_by: string | null; created_at: string; expires_at: string } | undefined;
  if (!saved || Number(db().prepare('DELETE FROM invites WHERE id_hash = ?').run(invite.id).changes) !== 1) throw new AuthError('notFound');
  try {
    if (invite.userId !== null) {
      await setPassword(invite.userId, o.password);
      return getUser(invite.userId)!;
    }
    return await createUser(o.username ?? '', o.password, invite.role === 'owner' ? 'admin' : invite.role);
  } catch (err) {
    // …and give it back if the form was wrong, so a typo doesn't burn the link.
    db()
      .prepare('INSERT OR IGNORE INTO invites (id_hash, role, user_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(saved.id_hash, saved.role, saved.user_id, saved.created_by, saved.created_at, saved.expires_at);
    throw err;
  }
}

// ---------- sessions ----------

export function createSession(userId: number, userAgent?: string): { token: string; expires: Date } {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400_000);
  db()
    .prepare('INSERT INTO auth_sessions (id_hash, user_id, created_at, expires_at, last_seen, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sha256(token), userId, now.toISOString(), expires.toISOString(), now.toISOString(), (userAgent ?? '').slice(0, 200));
  return { token, expires };
}

/** The session's user, or null. Refreshes last_seen at most once a minute. */
export function checkSession(token: string | undefined): AuthUser | null {
  if (!token) return null;
  const id = sha256(token);
  const r = db()
    .prepare('SELECT s.expires_at, s.last_seen, u.id, u.username, u.role FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?')
    .get(id) as { expires_at: string; last_seen: string; id: number; username: string; role: Role } | undefined;
  if (!r) return null;
  const now = Date.now();
  if (Date.parse(r.expires_at) < now) {
    db().prepare('DELETE FROM auth_sessions WHERE id_hash = ?').run(id);
    return null;
  }
  if (now - Date.parse(r.last_seen) > 60_000) db().prepare('UPDATE auth_sessions SET last_seen = ? WHERE id_hash = ?').run(new Date(now).toISOString(), id);
  return { id: r.id, username: r.username, role: r.role };
}

export function revokeSession(token: string | undefined): void {
  if (token) db().prepare('DELETE FROM auth_sessions WHERE id_hash = ?').run(sha256(token));
}

/** Closes the sessions of one user (or of everyone), optionally keeping `keep`. */
export function revokeAllSessions(userId?: number, keep?: string): void {
  const keepHash = keep ? sha256(keep) : '';
  if (userId === undefined) db().prepare('DELETE FROM auth_sessions WHERE id_hash != ?').run(keepHash);
  else db().prepare('DELETE FROM auth_sessions WHERE user_id = ? AND id_hash != ?').run(userId, keepHash);
}

function pruneSessions(): void {
  db().prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(new Date().toISOString());
}

export function countSessions(userId: number): number {
  pruneSessions();
  return (db().prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id = ?').get(userId) as { n: number }).n;
}

// ---------- brute force ----------

/**
 * Two brakes, both before hashing anything:
 * - per account AND client (IP): 5 free tries, then 1, 2, 4… minutes (max 1 h).
 *   Someone guessing from one place can't lock the real user out elsewhere.
 * - per account from anywhere: 25 tries, then 15, 30… minutes (max 4 h), so
 *   rotating IPs doesn't give unlimited guesses either.
 */
const failures = new Map<string, { count: number; until: number; at: number }>();
const PER_CLIENT = { free: 5, unitMs: 60_000, maxMs: 3600_000 };
const PER_ACCOUNT = { free: 25, unitMs: 15 * 60_000, maxMs: 4 * 3600_000 };

const norm = (username: string) => username.trim().toLowerCase();
const clientKey = (username: string, ip: string) => `c:${norm(username)}|${ip}`;
const accountKey = (username: string) => `a:${norm(username)}`;

function lockOf(key: string, now: number): number {
  const f = failures.get(key);
  return f && f.until > now ? f.until - now : 0;
}

/** Milliseconds this account still has to wait from this client, 0 if it may try. */
export function lockedFor(username: string, ip: string, now = Date.now()): number {
  return Math.max(lockOf(clientKey(username, ip), now), lockOf(accountKey(username), now));
}

function bump(key: string, rule: typeof PER_CLIENT, now: number): void {
  const f = failures.get(key) ?? { count: 0, until: 0, at: now };
  f.count += 1;
  f.at = now;
  if (f.count >= rule.free) f.until = now + Math.min(rule.maxMs, rule.unitMs * 2 ** (f.count - rule.free));
  failures.set(key, f);
}

/** A failed attempt. While locked nothing is counted (the lock doesn't keep growing). */
export function recordFailure(username: string, ip: string, now = Date.now()): void {
  if (lockedFor(username, ip, now) > 0) return;
  if (failures.size > 5000) {
    // Made-up usernames shouldn't grow this forever: forget the stale ones.
    for (const [k, v] of failures) if (now - v.at > 3600_000 && v.until < now) failures.delete(k);
  }
  bump(clientKey(username, ip), PER_CLIENT, now);
  bump(accountKey(username), PER_ACCOUNT, now);
}

export function clearFailures(username: string, ip: string): void {
  failures.delete(clientKey(username, ip));
  failures.delete(accountKey(username));
}

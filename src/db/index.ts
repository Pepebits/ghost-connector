import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getConfig } from '../config.js';
import { logger } from '../logger.js';

/**
 * Derived index, 100% rebuildable with `reindex` from .runs/**\/*.json
 * (source of truth, never touched). It also holds what exists nowhere
 * else today: the result of each real apply/resolve. Isolated in this
 * single file so we can switch to better-sqlite3 without touching the rest of
 * the project if Node < 22 ever needs to be supported.
 */

// Node flags node:sqlite as experimental (works the same, only warns).
const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,

  // Panel users (admin | editor), with their password hash and optional TOTP.
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    role TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    totp_secret TEXT,
    totp_last INTEGER,
    recovery_json TEXT,
    nag_until INTEGER,
    created_at TEXT NOT NULL
  )`,
  // Single-use links: join with a role, or (user_id set) set a new password.
  `CREATE TABLE IF NOT EXISTS invites (
    id_hash TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    user_id INTEGER,
    created_by TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  // Team work: activity log, post assignments and notes.
  `CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    actor TEXT,
    action TEXT NOT NULL,
    target TEXT,
    detail TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity(actor, id)`,
  `CREATE TABLE IF NOT EXISTS post_assignments (
    post_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    assigned_by TEXT,
    at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS post_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id TEXT NOT NULL,
    at TEXT NOT NULL,
    author TEXT,
    text TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_post_notes_post ON post_notes(post_id, id)`,

  // Panel login: one row per browser session (only the SHA-256 of the cookie is stored).
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    id_hash TEXT PRIMARY KEY,
    user_id INTEGER,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    user_agent TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS artifacts (
    run_id TEXT NOT NULL,
    post_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL,
    post_title TEXT NOT NULL,
    words_before INTEGER,
    words_after INTEGER,
    pending_count INTEGER,
    has_seo INTEGER,
    has_image_plan INTEGER,
    cost_usd REAL,
    tokens_in INTEGER,
    tokens_out INTEGER,
    errors_json TEXT,
    extra_instructions TEXT,
    file_path TEXT,
    PRIMARY KEY (run_id, post_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_artifacts_post ON artifacts(post_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS posts_live (
    post_id TEXT PRIMARY KEY,
    title TEXT,
    slug TEXT,
    url TEXT,
    updated_at TEXT,
    feature_image TEXT,
    pending_count INTEGER,
    word_count INTEGER,
    tags_json TEXT,
    ai_processed INTEGER,
    kind TEXT,
    issues_json TEXT,
    synced_at TEXT
  )`,

  // AI spend that isn't part of a plan (topic ideas): counted in totals, the chart and the daily cap.
  `CREATE TABLE IF NOT EXISTS extra_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    agent TEXT NOT NULL,
    usd REAL NOT NULL,
    tokens_in INTEGER,
    tokens_out INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS apply_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id TEXT,
    run_id TEXT,
    at TEXT,
    result TEXT,
    reason_code TEXT,
    message TEXT,
    image_result TEXT,
    provenance TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_apply_attempts_post ON apply_attempts(post_id, at)`,

  `CREATE TABLE IF NOT EXISTS resolve_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id TEXT,
    at TEXT,
    answered INTEGER,
    unresolved INTEGER,
    result TEXT,
    message TEXT
  )`,

  // M13: running jobs (plan/apply/resolve/sync in background) + their log.
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    params_json TEXT,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    updated_at TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0,
    result_json TEXT,
    error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS job_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    at TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    data_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_id, id)`,

  // M15: image provider quota telemetry + posts that left
  // DRAFT_FILTER (published manually or another status change).
  `CREATE TABLE IF NOT EXISTS provider_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    provider TEXT NOT NULL,
    kind TEXT NOT NULL,
    status INTEGER,
    remaining INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_provider_calls_provider ON provider_calls(provider, at)`,

  `CREATE TABLE IF NOT EXISTS posts_gone (
    post_id TEXT PRIMARY KEY,
    title TEXT,
    last_status TEXT,
    detected_at TEXT
  )`,

  // M16: revision history of the base prompts (editor + revert).
  `CREATE TABLE IF NOT EXISTS prompt_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    note TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_prompt_revisions_name ON prompt_revisions(name, id)`,

  // Block review: which kind of writer change is accepted or rejected
  // (basis for the writer prompt suggestions).
  `CREATE TABLE IF NOT EXISTS review_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    at TEXT NOT NULL,
    category TEXT NOT NULL,
    accepted INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_review_decisions_at ON review_decisions(at)`,
];

let db: DatabaseSync | null = null;

function dbPath(): string {
  return join(getConfig().DATA_DIR, 'index.db');
}

/**
 * Adds a column to an existing table of a DB created before
 * that column existed in SCHEMA_STATEMENTS. CREATE TABLE IF NOT EXISTS does not
 * alter existing tables, so new columns need this
 * in addition to appearing in the CREATE TABLE (which only applies to new
 * installs). Idempotent: on a new DB the column already exists and the ALTER
 * fails silently.
 */
// DDL does not accept parameters (?): names and type are interpolated, so only
// known identifiers and types are accepted. Today it is only called with
// constants from the code itself; this keeps a future change from opening an
// SQL injection here.
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SQL_COLUMN_TYPES = new Set(['INTEGER', 'REAL', 'TEXT', 'BLOB']);

export function ensureColumn(target: DatabaseSync, table: string, column: string, definition: string): void {
  if (!SQL_IDENTIFIER.test(table) || !SQL_IDENTIFIER.test(column) || !SQL_COLUMN_TYPES.has(definition)) {
    throw new Error(`ensureColumn: identifier or SQL type not allowed (${table}.${column} ${definition})`);
  }
  try {
    target.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch {
    // already exists
  }
}

export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(getConfig().DATA_DIR, { recursive: true });
  db = new DatabaseSync(dbPath());
  db.exec('PRAGMA journal_mode = WAL;');
  for (const stmt of SCHEMA_STATEMENTS) db.exec(stmt);
  ensureColumn(db, 'artifacts', 'tokens_in', 'INTEGER');
  ensureColumn(db, 'artifacts', 'tokens_out', 'INTEGER');
  ensureColumn(db, 'artifacts', 'cost_by_agent_json', 'TEXT');
  ensureColumn(db, 'auth_sessions', 'user_id', 'INTEGER');
  ensureColumn(db, 'jobs', 'created_by', 'TEXT');
  ensureColumn(db, 'apply_attempts', 'actor', 'TEXT');
  migrateSingleUser(db);
  return db;
}

/**
 * The panel had a single login (password and 2FA in `meta`): it becomes the
 * first admin, "admin", keeping its 2FA and its open sessions.
 */
export function migrateSingleUser(target: DatabaseSync): void {
  const meta = (key: string) => (target.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
  const hash = meta('auth_password_hash');
  if (hash && !target.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    const last = meta('auth_totp_last');
    const r = target
      .prepare('INSERT INTO users (username, role, password_hash, totp_secret, totp_last, recovery_json, nag_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('admin', 'owner', hash, meta('auth_totp_secret'), last === null ? null : Number(last), meta('auth_recovery'), Number(meta('auth_2fa_nag_until') ?? 0) || null, new Date().toISOString());
    target.prepare('UPDATE auth_sessions SET user_id = ? WHERE user_id IS NULL').run(Number(r.lastInsertRowid));
    logger.info('Panel login migrated to users: the existing password is now the admin user "admin".');
  }
  if (hash) target.exec("DELETE FROM meta WHERE key IN ('auth_password_hash', 'auth_totp_secret', 'auth_totp_last', 'auth_recovery', 'auth_2fa_nag_until')");
  target.exec('DELETE FROM auth_sessions WHERE user_id IS NULL');
  // Before the owner role existed: the oldest admin becomes the owner.
  if (!target.prepare("SELECT 1 FROM users WHERE role = 'owner'").get()) {
    target.prepare("UPDATE users SET role = 'owner' WHERE id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1)").run();
  }
}

/** Wraps an index write so an index failure never brings down the real operation. */
export function safeWrite(label: string, fn: (db: DatabaseSync) => void): void {
  try {
    fn(getDb());
  } catch (err) {
    logger.warn({ label, err: err instanceof Error ? err.message : String(err) }, 'SQLite index write failed (non-critical)');
  }
}

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { currentActor } from '../auth/context.js';
import { isPromptCustomized, isPromptName, loadPrompt, PROMPT_NAMES, savePrompt } from '../agents/prompts.js';
import { getConfig } from '../config.js';
import { getDb } from '../db/index.js';
import { loadIdeaHistory, type IdeaHistory } from '../orchestrator/ideas.js';
import { ENV_FIELDS, saveEnv, type EnvSubmission } from './envFile.js';
import { tarHeader } from './backup.js';

/**
 * Export / import of the workspace: what only exists in this panel (Ghost
 * keeps the posts). Plans and chosen images, edited prompts, settings
 * WITHOUT keys, team notes and assignments, ideas, title/meta changes and
 * what block reviews learned. Never users, passwords, 2FA, sessions or keys:
 * the full backup (with all of that) is `ghost-connector backup`, on the server.
 */

export const EXPORT_FORMAT = 'ghost-connector-export';
export const EXPORT_VERSION = 1;
/** Uncompressed size an import may reach (plans are JSON; images are the bulk). */
export const MAX_IMPORT_BYTES = 300 * 1024 * 1024;

/** Settings that identify THIS installation (site, accounts): never imported from another. */
const IDENTITY_KEYS = new Set(['GHOST_API_URL', 'GHOST_API_VERSION', 'GSC_SITE_URL', 'BING_SITE_URL', 'OPENVERSE_CLIENT_ID', 'UNSPLASH_APP_NAME']);
const EXPORTED_SETTINGS = ENV_FIELDS.filter((f) => !f.secret && !IDENTITY_KEYS.has(f.key));

export type ImportPart = 'plans' | 'prompts' | 'settings' | 'team' | 'ideas' | 'learning';
export const IMPORT_PARTS: ImportPart[] = ['plans', 'prompts', 'settings', 'team', 'ideas', 'learning'];

interface Manifest {
  format: string;
  version: number;
  exportedAt: string;
  exportedBy: string | null;
  site: string;
}

interface Note {
  post_id: string;
  at: string;
  author: string | null;
  text: string;
}
interface AssignmentRow {
  post_id: string;
  username: string;
  assigned_by: string | null;
  at: string;
}
interface Decision {
  post_id: string;
  run_id: string;
  at: string;
  category: string;
  accepted: number;
}

const dataDir = () => getConfig().DATA_DIR;
const RUN_FILE = /^run-[\w-]+\/[\w-]+\.json$/;
const IMAGE_FILE = /^images\/[\w-]+\/[\w.-]+$/;
const SNIPPET_FILE = /^snippets\/[\w-]+\.json$/;

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (st.isFile()) yield full;
  }
}

/** A plan file is only taken if it really is the plan its path says (post and run). */
function validRun(name: string, data: Buffer): boolean {
  try {
    const a = JSON.parse(data.toString('utf8')) as { postId?: unknown; runId?: unknown };
    const [run, file] = name.split('/');
    return a.postId === file!.replace(/\.json$/, '') && a.runId === run;
  } catch {
    return false;
  }
}

const rel = (full: string) => relative(dataDir(), full).split(sep).join('/');

// ---------- tar (the backup's ustar writer + a reader for what it writes) ----------

function tar(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  const now = new Date();
  for (const e of entries) parts.push(tarHeader(e.name, e.data.length, now), e.data, Buffer.alloc((512 - (e.data.length % 512)) % 512));
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

export function readTar(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let off = 0;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a: number, b: number) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = str(156, 157);
    const prefix = h.subarray(257, 263).toString('ascii').startsWith('ustar') ? str(345, 500) : '';
    const name = prefix ? `${prefix}/${str(0, 100)}` : str(0, 100);
    if (!Number.isFinite(size) || size < 0 || off + 512 + size > buf.length) throw new Error('Damaged file');
    if (type === '0' || type === '') out.set(name, buf.subarray(off + 512, off + 512 + size));
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

// ---------- export ----------

export function exportFileName(now = new Date()): string {
  return `ghost-connector-export-${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.tar.gz`;
}

export function createExport(): Buffer {
  const db = getDb();
  const json = (v: unknown) => Buffer.from(JSON.stringify(v, null, 2));
  const cfg = getConfig() as unknown as Record<string, unknown>;
  const entries: Array<{ name: string; data: Buffer }> = [];

  const manifest: Manifest = { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: new Date().toISOString(), exportedBy: currentActor(), site: getConfig().GHOST_API_URL };
  entries.push({ name: 'manifest.json', data: json(manifest) });

  const settings: Record<string, string> = {};
  for (const f of EXPORTED_SETTINGS) {
    const v = cfg[f.key];
    if (v !== undefined && v !== null) settings[f.key] = Array.isArray(v) ? v.join(',') : String(v);
  }
  entries.push({ name: 'settings.json', data: json(settings) });

  for (const name of PROMPT_NAMES) if (isPromptCustomized(name)) entries.push({ name: `prompts/${name}.md`, data: Buffer.from(loadPrompt(name)) });

  for (const full of walk(dataDir())) {
    const name = rel(full);
    if (RUN_FILE.test(name) || IMAGE_FILE.test(name) || SNIPPET_FILE.test(name)) entries.push({ name, data: readFileSync(full) });
  }

  entries.push({ name: 'ideas-history.json', data: json(loadIdeaHistory()) });
  entries.push({ name: 'team.json', data: json({ notes: db.prepare('SELECT post_id, at, author, text FROM post_notes ORDER BY id').all(), assignments: db.prepare('SELECT post_id, username, assigned_by, at FROM post_assignments').all() }) });
  entries.push({ name: 'review-decisions.json', data: json(db.prepare('SELECT post_id, run_id, at, category, accepted FROM review_decisions ORDER BY id').all()) });

  return gzipSync(tar(entries));
}

// ---------- import: read, preview, apply ----------

export class ImportError extends Error {
  constructor(readonly code: 'notExport' | 'tooBig' | 'newerVersion' | 'damaged') {
    super(code);
  }
}

export interface ImportPreview {
  id: string;
  manifest: Manifest;
  otherSite: boolean;
  plans: { newRuns: number; existingRuns: number; newImages: number };
  prompts: string[];
  settings: Array<{ key: string; from: string; to: string }>;
  team: { notes: number; assignments: number; skippedAssignments: number };
  ideas: { history: number; snippets: number };
  learning: number;
}

interface Staged {
  at: number;
  by: string | null;
  files: Map<string, Buffer>;
  preview: ImportPreview;
}

const staged = new Map<string, Staged>();
const STAGE_MS = 30 * 60_000;

function parse<T>(files: Map<string, Buffer>, name: string, fallback: T): T {
  const b = files.get(name);
  if (!b) return fallback;
  try {
    return JSON.parse(b.toString('utf8')) as T;
  } catch {
    throw new ImportError('damaged');
  }
}

const noteKey = (n: Note) => `${n.post_id}|${n.at}|${n.author ?? ''}|${n.text}`;
const decisionKey = (d: Decision) => `${d.post_id}|${d.run_id}|${d.at}|${d.category}`;

/** Reads an uploaded export and works out what it would change. Nothing is written yet. */
export function stageImport(gz: Buffer): ImportPreview {
  for (const [k, s] of staged) if (Date.now() - s.at > STAGE_MS) staged.delete(k);
  let raw: Buffer;
  try {
    raw = gunzipSync(gz, { maxOutputLength: MAX_IMPORT_BYTES });
  } catch (err) {
    throw new ImportError((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE' ? 'tooBig' : 'notExport');
  }
  let files: Map<string, Buffer>;
  try {
    files = readTar(raw);
  } catch {
    throw new ImportError('damaged');
  }
  const manifest = parse<Manifest | null>(files, 'manifest.json', null);
  if (!manifest || manifest.format !== EXPORT_FORMAT) throw new ImportError('notExport');
  if (manifest.version > EXPORT_VERSION) throw new ImportError('newerVersion');

  const db = getDb();
  const names = [...files.keys()];
  const runFiles = names.filter((n) => RUN_FILE.test(n) && validRun(n, files.get(n)!));
  const cfg = getConfig() as unknown as Record<string, unknown>;
  const importedSettings = parse<Record<string, string>>(files, 'settings.json', {});
  const settings = EXPORTED_SETTINGS.filter((f) => typeof importedSettings[f.key] === 'string')
    .map((f) => {
      const v = cfg[f.key];
      return { key: f.key, from: v === undefined || v === null ? '' : Array.isArray(v) ? v.join(',') : String(v), to: importedSettings[f.key]! };
    })
    .filter((s) => s.from !== s.to);

  const existingNotes = new Set((db.prepare('SELECT post_id, at, author, text FROM post_notes').all() as unknown as Note[]).map(noteKey));
  const team = parse<{ notes?: Note[]; assignments?: AssignmentRow[] }>(files, 'team.json', {});
  const users = new Set((db.prepare('SELECT username FROM users').all() as Array<{ username: string }>).map((u) => u.username.toLowerCase()));
  const assigned = new Set((db.prepare('SELECT post_id FROM post_assignments').all() as Array<{ post_id: string }>).map((r) => r.post_id));
  const assignments = (team.assignments ?? []).filter((a) => !assigned.has(a.post_id));
  const usable = assignments.filter((a) => users.has(a.username.toLowerCase()));

  const history = parse<IdeaHistory>(files, 'ideas-history.json', { dismissed: [], used: [] });
  const current = loadIdeaHistory();
  const known = new Set([...current.dismissed.map((d) => `d${d.id}`), ...current.used.map((u) => `u${u.id}`)]);
  const existingDecisions = new Set((db.prepare('SELECT post_id, run_id, at, category FROM review_decisions').all() as unknown as Decision[]).map(decisionKey));

  const preview: ImportPreview = {
    id: randomBytes(12).toString('base64url'),
    manifest,
    otherSite: manifest.site.replace(/\/+$/, '') !== getConfig().GHOST_API_URL.replace(/\/+$/, ''),
    plans: {
      newRuns: runFiles.filter((n) => !existsSync(join(dataDir(), n))).length,
      existingRuns: runFiles.filter((n) => existsSync(join(dataDir(), n))).length,
      newImages: names.filter((n) => IMAGE_FILE.test(n) && !existsSync(join(dataDir(), n))).length,
    },
    prompts: names
      .map((n) => /^prompts\/(.+)\.md$/.exec(n)?.[1])
      .filter((n): n is string => !!n && isPromptName(n))
      .filter((n) => loadPrompt(n as never) !== files.get(`prompts/${n}.md`)!.toString('utf8')),
    settings,
    team: { notes: (team.notes ?? []).filter((n) => !existingNotes.has(noteKey(n))).length, assignments: usable.length, skippedAssignments: assignments.length - usable.length },
    ideas: {
      history: [...history.dismissed.map((d) => `d${d.id}`), ...history.used.map((u) => `u${u.id}`)].filter((k) => !known.has(k)).length,
      snippets: names.filter((n) => SNIPPET_FILE.test(n) && !existsSync(join(dataDir(), n))).length,
    },
    learning: parse<Decision[]>(files, 'review-decisions.json', []).filter((d) => !existingDecisions.has(decisionKey(d))).length,
  };
  staged.set(preview.id, { at: Date.now(), by: currentActor(), files, preview });
  return preview;
}

export function getStagedImport(id: string): ImportPreview | null {
  const s = staged.get(id);
  return s && Date.now() - s.at <= STAGE_MS && s.by === currentActor() ? s.preview : null;
}

export function discardImport(id: string): void {
  staged.delete(id);
}

function writeNew(name: string, data: Buffer): boolean {
  const target = join(dataDir(), name);
  // Names were already matched against strict patterns; this is a second lock on the door.
  if (relative(dataDir(), target).startsWith('..') || existsSync(target)) return false;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data, { flag: 'wx' });
  return true;
}

/**
 * Applies the chosen parts. Merges, never deletes: existing plans, notes and
 * assignments stay; imported prompts and settings replace the current ones
 * (prompts keep a revision to go back to). Returns what was applied.
 */
export function applyImport(id: string, parts: ImportPart[], envFile?: string): string[] {
  const s = staged.get(id);
  if (!s || s.by !== currentActor()) throw new ImportError('notExport');
  staged.delete(id);
  const { files } = s;
  const db = getDb();
  const done: string[] = [];

  if (parts.includes('settings') && s.preview.settings.length) {
    const sub: EnvSubmission = { __full: '1' };
    for (const f of EXPORTED_SETTINGS) {
      const v = parse<Record<string, string>>(files, 'settings.json', {})[f.key];
      if (typeof v === 'string') sub[f.key] = v;
      // Booleans not in the file keep their current value (__full would turn them off).
      else if (f.type === 'boolean') sub[f.key] = String((getConfig() as unknown as Record<string, unknown>)[f.key] === true);
    }
    saveEnv(sub, envFile);
    done.push('settings');
  }
  if (parts.includes('prompts')) {
    for (const name of s.preview.prompts) if (isPromptName(name)) savePrompt(name, files.get(`prompts/${name}.md`)!.toString('utf8'), 'imported');
    if (s.preview.prompts.length) done.push('prompts');
  }
  if (parts.includes('plans')) {
    for (const [name, data] of files) if ((RUN_FILE.test(name) && validRun(name, data)) || IMAGE_FILE.test(name)) writeNew(name, data);
    done.push('plans');
  }
  if (parts.includes('ideas')) {
    for (const [name, data] of files) if (SNIPPET_FILE.test(name)) writeNew(name, data);
    const history = parse<IdeaHistory>(files, 'ideas-history.json', { dismissed: [], used: [] });
    const current = loadIdeaHistory();
    const merged: IdeaHistory = {
      dismissed: [...current.dismissed, ...history.dismissed.filter((d) => !current.dismissed.some((c) => c.id === d.id))],
      used: [...current.used, ...history.used.filter((u) => !current.used.some((c) => c.id === u.id))],
    };
    writeFileSync(join(dataDir(), 'ideas-history.json'), JSON.stringify(merged, null, 2));
    done.push('ideas');
  }
  if (parts.includes('team')) {
    const team = parse<{ notes?: Note[]; assignments?: AssignmentRow[] }>(files, 'team.json', {});
    const existing = new Set((db.prepare('SELECT post_id, at, author, text FROM post_notes').all() as unknown as Note[]).map(noteKey));
    const addNote = db.prepare('INSERT INTO post_notes (post_id, at, author, text) VALUES (?, ?, ?, ?)');
    for (const n of team.notes ?? []) if (!existing.has(noteKey(n)) && typeof n.text === 'string') addNote.run(String(n.post_id), String(n.at), n.author ?? null, n.text.slice(0, 2000));
    const assign = db.prepare('INSERT OR IGNORE INTO post_assignments (post_id, username, assigned_by, at) SELECT ?, username, ?, ? FROM users WHERE username = ? COLLATE NOCASE');
    for (const a of team.assignments ?? []) assign.run(String(a.post_id), a.assigned_by ?? null, String(a.at), String(a.username));
    done.push('team');
  }
  if (parts.includes('learning')) {
    const existing = new Set((db.prepare('SELECT post_id, run_id, at, category FROM review_decisions').all() as unknown as Decision[]).map(decisionKey));
    const add = db.prepare('INSERT INTO review_decisions (post_id, run_id, at, category, accepted) VALUES (?, ?, ?, ?, ?)');
    for (const d of parse<Decision[]>(files, 'review-decisions.json', [])) if (!existing.has(decisionKey(d))) add.run(String(d.post_id), String(d.run_id), String(d.at), String(d.category), d.accepted ? 1 : 0);
    done.push('learning');
  }
  return done;
}

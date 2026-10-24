import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { once } from 'node:events';
import { PassThrough, pipeline, type Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import { getConfig } from '../config.js';
import { getDb } from '../db/index.js';

/**
 * Backup of DATA_DIR as a .tar.gz: runs, local images, ideas, saved prompts
 * and a consistent copy of the SQLite index (VACUUM INTO, so a write in
 * flight doesn't leave it half-done). The .env (with the keys) only goes in
 * if asked for. Restoring = stop the panel and extract it into DATA_DIR.
 */

/** Never copied as-is: the live database (copied via VACUUM INTO) and the write lock. */
const SKIP = new Set(['index.db', 'index.db-wal', 'index.db-shm', '.write.lock']);

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, '0') + '\0';
}

/** One ustar header (512 bytes). Long paths use the 155-byte prefix field. */
export function tarHeader(name: string, size: number, mtime: Date): Buffer {
  const h = Buffer.alloc(512);
  // Lengths in BYTES (UTF-8): name <= 100, prefix <= 155, split at a "/".
  let prefix = Buffer.alloc(0);
  let base = Buffer.from(name, 'utf8');
  if (base.length > 100) {
    const full = base;
    let cut = -1;
    for (let i = Math.min(155, full.length - 1); i > 0; i--) {
      if (full[i] === 0x2f && full.length - i - 1 <= 100) {
        cut = i;
        break;
      }
    }
    if (cut <= 0) throw new Error(`Path too long for tar: ${name}`);
    prefix = full.subarray(0, cut);
    base = full.subarray(cut + 1);
  }
  base.copy(h, 0);
  h.write(octal(0o644, 8), 100, 'ascii');
  h.write(octal(0, 8), 108, 'ascii');
  h.write(octal(0, 8), 116, 'ascii');
  h.write(octal(size, 12), 124, 'ascii');
  h.write(octal(Math.floor(mtime.getTime() / 1000), 12), 136, 'ascii');
  h.fill(' ', 148, 156); // checksum placeholder
  h.write('0', 156, 'ascii');
  h.write('ustar\0', 257, 'ascii');
  h.write('00', 263, 'ascii');
  prefix.copy(h, 345);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(octal(sum, 7) + ' ', 148, 'ascii');
  return h;
}

function* walk(dir: string, root: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full, root);
    else if (st.isFile() && !(dir === root && SKIP.has(name))) yield full;
  }
}

export interface BackupOptions {
  /** Also the .env (API keys in plain text). */
  includeEnv?: boolean;
  envPath?: string;
}

export function backupFileName(now = new Date()): string {
  return `ghost-connector-backup-${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.tar.gz`;
}

/** Streams the backup. Files are read one at a time (no big buffer in memory). */
export function createBackup(opts: BackupOptions = {}): Readable {
  const dataDir = getConfig().DATA_DIR;
  const tmp = mkdtempSync(join(tmpdir(), 'gc-backup-'));
  const cleanup = () => rmSync(tmp, { recursive: true, force: true });
  let entries: Array<{ name: string; path: string }>;
  try {
    const dbCopy = join(tmp, 'index.db');
    getDb().exec(`VACUUM INTO '${dbCopy.replace(/'/g, "''")}'`);
    entries = [{ name: 'index.db', path: dbCopy }];
    if (existsSync(dataDir)) {
      for (const full of walk(dataDir, dataDir)) entries.push({ name: relative(dataDir, full).split(sep).join('/'), path: full });
    }
    if (opts.includeEnv && opts.envPath && existsSync(opts.envPath)) entries.push({ name: '.env', path: opts.envPath });
  } catch (err) {
    cleanup();
    throw err;
  }

  const tar = new PassThrough();
  const gz = createGzip();
  // pipeline: if the download is cancelled (gz destroyed), tar is destroyed too.
  pipeline(tar, gz, () => {});
  async function* blocks(): AsyncGenerator<Buffer> {
    for (const e of entries) {
      let data: Buffer;
      try {
        data = readFileSync(e.path);
      } catch {
        continue; // removed while backing up: skip it rather than break the archive
      }
      yield Buffer.concat([tarHeader(e.name, data.length, statSync(e.path, { throwIfNoEntry: false })?.mtime ?? new Date()), data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
    }
    yield Buffer.alloc(1024); // two empty blocks = end of archive
  }
  (async () => {
    try {
      for await (const chunk of blocks()) {
        if (tar.destroyed) return;
        if (!tar.write(chunk)) await once(tar, 'drain').catch(() => undefined);
      }
      if (!tar.destroyed) tar.end();
    } catch (err) {
      tar.destroy(err as Error);
    } finally {
      cleanup();
    }
  })();
  return gz;
}

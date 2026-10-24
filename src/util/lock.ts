import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfig } from '../config.js';

const STALE_MS = 10 * 60 * 1000; // 10 minutes

interface LockInfo {
  owner: string;
  pid: number;
  at: string;
}

function lockPath(): string {
  return join(getConfig().DATA_DIR, '.write.lock');
}

function readLock(path: string): LockInfo | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as LockInfo;
  } catch {
    return null;
  }
}

/**
 * Advisory lock (not atomic at the filesystem level) so the
 * CLI and the server don't compete writing the same post at once. The
 * `updated_at` guard in writeback.ts/resolveFlow.ts ALREADY guarantees
 * correctness even if this lock failed or did not exist; this only avoids the
 * confusion of two parallel writes, it does not protect on its own.
 *
 * Locks older than `STALE_MS` are considered orphaned (from a process that
 * died without releasing) and are released automatically -- a lock must never block
 * writes forever.
 */
export function acquireWriteLock(owner: string): () => void {
  const path = lockPath();
  if (existsSync(path)) {
    const existing = readLock(path);
    const ageMs = existing ? Date.now() - new Date(existing.at).getTime() : Infinity;
    if (existing && ageMs < STALE_MS) {
      throw new Error(
        `A write is already in progress: "${existing.owner}" (pid ${existing.pid}, ${Math.round(ageMs / 1000)}s ago). Wait for it to finish.`,
      );
    }
    // Orphaned or unreadable lock: replaced without blocking.
  }

  const info: LockInfo = { owner, pid: process.pid, at: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(info));

  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      unlinkSync(path);
    } catch {
      // no longer exists, ok
    }
  };
}

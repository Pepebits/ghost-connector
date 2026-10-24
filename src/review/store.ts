import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfig } from '../config.js';
import { upsertArtifactIndex } from '../db/repo.js';
import type { RunArtifact } from '../types.js';

export function newRunId(): string {
  return `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

function runDir(runId: string): string {
  return join(getConfig().DATA_DIR, runId);
}

export async function saveArtifact(artifact: RunArtifact): Promise<string> {
  const dir = runDir(artifact.runId);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${artifact.postId}.json`);
  await writeFile(filePath, JSON.stringify(artifact, null, 2), 'utf8');
  // The file (above) is the source of truth; the index is best-effort and
  // 100% rebuildable with `reindex` if something goes wrong here.
  upsertArtifactIndex(artifact);
  return filePath;
}

export async function loadArtifact(runId: string, postId: string): Promise<RunArtifact> {
  const raw = await readFile(join(runDir(runId), `${postId}.json`), 'utf8');
  return JSON.parse(raw) as RunArtifact;
}

export async function listArtifacts(runId: string): Promise<RunArtifact[]> {
  const dir = runDir(runId);
  const files = await readdir(dir);
  const artifacts: RunArtifact[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const raw = await readFile(join(dir, file), 'utf8');
    artifacts.push(JSON.parse(raw) as RunArtifact);
  }
  return artifacts;
}

async function listRunDirs(): Promise<string[]> {
  try {
    return (await readdir(getConfig().DATA_DIR)).filter((d) => d.startsWith('run-'));
  } catch {
    return []; // DATA_DIR does not exist yet (no plan run yet)
  }
}

/** The most recent artifact (by createdAt) of a post, across all runs. */
export async function findLatestArtifact(postId: string): Promise<RunArtifact | null> {
  let best: RunArtifact | null = null;
  for (const dir of await listRunDirs()) {
    try {
      const artifact = await loadArtifact(dir, postId);
      if (!best || new Date(artifact.createdAt) > new Date(best.createdAt)) best = artifact;
    } catch {
      // this run has no artifact for this post, ok
    }
  }
  return best;
}

/** The most recent artifact of EACH post, in a single pass over all runs (for bulk sync). */
export async function findLatestArtifactsByPost(): Promise<Map<string, RunArtifact>> {
  const latest = new Map<string, RunArtifact>();
  for (const artifact of await listAllArtifacts()) {
    const prev = latest.get(artifact.postId);
    if (!prev || new Date(artifact.createdAt) > new Date(prev.createdAt)) latest.set(artifact.postId, artifact);
  }
  return latest;
}

/** ALL artifacts from ALL runs (not just the latest per post). Used by `reindex`. */
export async function listAllArtifacts(): Promise<RunArtifact[]> {
  const all: RunArtifact[] = [];
  for (const dir of await listRunDirs()) {
    const dirPath = join(getConfig().DATA_DIR, dir);
    const files = (await readdir(dirPath)).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const raw = await readFile(join(dirPath, file), 'utf8');
      all.push(JSON.parse(raw) as RunArtifact);
    }
  }
  return all;
}

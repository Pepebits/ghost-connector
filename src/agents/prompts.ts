import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../config.js';
import { getPromptRevision, listPromptRevisions as dbListPromptRevisions, recordPromptRevision, type PromptRevisionRow } from '../db/repo.js';

export type PromptName = 'writer.system' | 'seo.system' | 'image.system' | 'resolve.system' | 'fix.system' | 'ideas.system' | 'snippet.system';

export const PROMPT_NAMES: PromptName[] = ['writer.system', 'seo.system', 'image.system', 'resolve.system', 'fix.system', 'ideas.system', 'snippet.system'];

export function isPromptName(value: string): value is PromptName {
  return (PROMPT_NAMES as string[]).includes(value);
}

/** Factory prompts: shipped with the code and never written. */
const FACTORY_DIR = fileURLToPath(new URL('./prompts/', import.meta.url));

/** User-edited prompts: stored alongside the user's data (<DATA_DIR>/prompts, outside git). */
export function overridesDir(): string {
  return join(getConfig().DATA_DIR, 'prompts');
}

export function promptsDir(): string {
  return FACTORY_DIR;
}

// `name` is restricted to the PromptName type (a fixed literal union), so
// these paths are never built from an arbitrary URL value.
function factoryPath(name: PromptName): string {
  return join(FACTORY_DIR, `${name}.md`);
}
function overridePath(name: PromptName): string {
  return join(overridesDir(), `${name}.md`);
}

/** Whether the active prompt is an edited version (true) or the factory one (false). */
export function isPromptCustomized(name: PromptName): boolean {
  return existsSync(overridePath(name));
}

export function loadFactoryPrompt(name: PromptName): string {
  return readFileSync(factoryPath(name), 'utf8');
}

interface CacheEntry {
  content: string;
  path: string;
  mtimeMs: number;
}
const cache = new Map<PromptName, CacheEntry>();

/**
 * Active prompt: the edited one if it exists, otherwise the factory one. Cached by path and
 * mtime: a change (from the UI or by hand) is used in the next plan without restarting.
 */
export function loadPrompt(name: PromptName): string {
  const path = isPromptCustomized(name) ? overridePath(name) : factoryPath(name);
  const stat = statSync(path);
  const cached = cache.get(name);
  if (cached && cached.path === path && cached.mtimeMs === stat.mtimeMs) return cached.content;
  const content = readFileSync(path, 'utf8');
  cache.set(name, { content, path, mtimeMs: stat.mtimeMs });
  return content;
}

/**
 * Saves a new version of the prompt (as the edited version; the factory one
 * is untouched). ALWAYS records the PREVIOUS content as a revision before
 * writing: that's the safety net that makes reverting possible. If recording
 * fails, nothing is written. Saving exactly the factory prompt is the same as
 * going back to it (the edited version is deleted).
 */
export function savePrompt(name: PromptName, content: string, note?: string): void {
  const previous = loadPrompt(name);
  recordPromptRevision({ name, content: previous, note: note ?? 'auto (before saving)' });
  if (content === loadFactoryPrompt(name)) {
    rmSync(overridePath(name), { force: true });
  } else {
    mkdirSync(overridesDir(), { recursive: true });
    writeFileSync(overridePath(name), content, 'utf8');
  }
  cache.delete(name);
}

/** Reverts to the factory prompt (recording the edited version first, in case it needs undoing). */
export function resetPromptToFactory(name: PromptName): void {
  if (!isPromptCustomized(name)) return;
  recordPromptRevision({ name, content: loadPrompt(name), note: 'before resetting to the default' });
  rmSync(overridePath(name), { force: true });
  cache.delete(name);
}

export function listPromptRevisions(name: PromptName): PromptRevisionRow[] {
  return dbListPromptRevisions(name);
}

/** Reverts to a saved revision (also records the current state before reverting, in case it needs undoing). */
export function revertPrompt(name: PromptName, revisionId: number): void {
  const revision = getPromptRevision(revisionId);
  if (!revision || revision.name !== name) {
    throw new Error(`Revision #${revisionId} not found for "${name}".`);
  }
  savePrompt(name, revision.content, `reverted to revision #${revisionId}`);
}

import { recordApplyAttempt } from '../db/repo.js';
import { ghostApi } from '../ghost/client.js';
import { readRawPost } from '../ghost/posts.js';
import { logger } from '../logger.js';
import { findLatestArtifact, saveArtifact } from '../review/store.js';
import type { PostPatch, RunArtifact } from '../types.js';
import { acquireWriteLock } from '../util/lock.js';

export type RestoreStatus = 'restored' | 'conflict' | 'not-draft' | 'unavailable' | 'failed';

export interface RestoreResult {
  status: RestoreStatus;
  message: string;
}

/**
 * Whether the latest plan of the post can be undone: applied by this
 * connector, not yet restored, and with the updated_at Ghost returned
 * (applies from before this existed don't have it: Ghost's revision
 * history is the way back for those).
 */
export function canRestore(artifact: RunArtifact | null): artifact is RunArtifact & { appliedUpdatedAt: string } {
  return !!artifact && artifact.status === 'applied' && !!artifact.appliedUpdatedAt && !artifact.restoredAt;
}

/** The snapshot's value for every field the apply touched (the rest is left alone). */
export function restorePatch(artifact: RunArtifact): { patch: PostPatch; source?: 'html' } {
  const s = artifact.snapshot;
  const p = artifact.patch;
  const patch: PostPatch = { status: 'draft' };
  let source: 'html' | undefined;
  if (p.html !== undefined || p.lexical !== undefined) {
    if (s.lexical) patch.lexical = s.lexical;
    else {
      patch.html = s.html ?? '';
      source = 'html';
    }
  }
  if (p.title !== undefined) patch.title = s.title;
  if (p.slug !== undefined) patch.slug = s.slug;
  if (p.custom_excerpt !== undefined) patch.custom_excerpt = s.custom_excerpt ?? '';
  for (const key of ['meta_title', 'meta_description', 'og_title', 'og_description', 'twitter_title', 'twitter_description'] as const) {
    if (p[key] !== undefined) patch[key] = s[key] ?? '';
  }
  if (p.feature_image !== undefined || artifact.uploadedImage) {
    patch.feature_image = s.feature_image;
    patch.feature_image_alt = s.feature_image_alt;
    patch.feature_image_caption = s.feature_image_caption;
  }
  if (p.tags !== undefined) patch.tags = s.tags.map((tag) => ({ id: tag.id }));
  return { patch, ...(source ? { source } : {}) };
}

/**
 * Undoes the last apply: puts back what the post had when it was planned
 * (artifact.snapshot), but ONLY if nobody touched it in Ghost since the
 * apply (same updated_at guard as apply). Saves a Ghost revision, so the
 * applied version stays recoverable too. Never publishes.
 */
export async function restoreLastApply(postId: string): Promise<RestoreResult> {
  const artifact = await findLatestArtifact(postId);
  if (!canRestore(artifact)) return { status: 'unavailable', message: 'There is no apply to undo for this post.' };
  const record = (r: RestoreResult) => {
    recordApplyAttempt({ postId, runId: artifact.runId, result: r.status, reasonCode: r.status === 'restored' ? 'ok' : r.status, message: r.message, imageResult: 'none', provenance: 'recorded' });
    return r;
  };

  const fresh = await readRawPost(postId);
  if (fresh.status !== 'draft') return record({ status: 'not-draft', message: `The post is no longer a draft (status=${fresh.status}).` });
  if (fresh.updated_at !== artifact.appliedUpdatedAt) {
    return record({ status: 'conflict', message: `The post changed in Ghost after the apply (updated_at ${artifact.appliedUpdatedAt} -> ${fresh.updated_at}). Use Ghost's revision history instead.` });
  }

  let release: (() => void) | null = null;
  try {
    release = acquireWriteLock(`apply:${postId}`);
  } catch (err) {
    return record({ status: 'failed', message: err instanceof Error ? err.message : String(err) });
  }
  try {
    const { patch, source } = restorePatch(artifact);
    await ghostApi().posts.edit({ id: postId, ...patch, updated_at: fresh.updated_at, status: 'draft' }, { ...(source ? { source } : {}), save_revision: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ id: postId, err: message }, 'Restore PUT to Ghost failed');
    return record({ status: 'failed', message });
  } finally {
    release();
  }
  await saveArtifact({ ...artifact, restoredAt: new Date().toISOString() });
  logger.info({ id: postId }, 'Post restored to its version before the apply');
  return record({ status: 'restored', message: 'OK' });
}

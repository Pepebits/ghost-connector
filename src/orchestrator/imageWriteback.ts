import { ghostApi } from '../ghost/client.js';
import { readRawPost } from '../ghost/posts.js';
import { acquireFeatureImage } from '../images/pipeline.js';
import { QuotaExhaustedError } from '../images/provider.js';
import { findLatestArtifact } from '../review/store.js';
import { acquireWriteLock } from '../util/lock.js';

export type RetryImageStatus = 'uploaded' | 'skipped-existing' | 'no-plan' | 'quota-exhausted' | 'failed' | 'conflict';

export interface RetryImageResult {
  status: RetryImageStatus;
  message: string;
  url?: string;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Retries ONLY the image of an already-applied post (typically because the
 * Unsplash/Pexels quota was exhausted the first time). The final PUT
 * touches ONLY feature_image/_alt/_caption -- never the rest of the post --
 * and uses the same conflict guard as the rest of the write-back.
 */
export async function retryFeatureImage(postId: string): Promise<RetryImageResult> {
  const before = await readRawPost(postId);
  if (before.feature_image) {
    return { status: 'skipped-existing', message: 'The post already has a feature image; leaving it untouched.' };
  }

  const artifact = await findLatestArtifact(postId);
  if (!artifact?.imagePlan) {
    return { status: 'no-plan', message: 'There is no saved image plan for this post. Plan it again.' };
  }

  try {
    const acquired = await acquireFeatureImage(artifact.imagePlan, {
      postTitle: before.title,
      slug: before.slug,
      existingFeatureImage: null,
    });
    if (!acquired) {
      return { status: 'failed', message: 'No image provider (Unsplash/Pexels) found a valid result.' };
    }

    const fresh = await readRawPost(postId);
    if (fresh.updated_at !== before.updated_at) {
      return { status: 'conflict', message: 'The post changed in Ghost while the image was being fetched. Try again.' };
    }

    let releaseLock: (() => void) | null = null;
    try {
      releaseLock = acquireWriteLock(`image-retry:${postId}`);
    } catch (err) {
      return { status: 'failed', message: errMsg(err) };
    }

    try {
      await ghostApi().posts.edit(
        {
          id: postId,
          feature_image: acquired.url,
          feature_image_alt: acquired.alt,
          feature_image_caption: acquired.caption ?? undefined,
          updated_at: fresh.updated_at,
          status: 'draft',
        },
        { save_revision: true },
      );
    } finally {
      releaseLock();
    }

    return { status: 'uploaded', message: 'OK', url: acquired.url };
  } catch (err) {
    if (err instanceof QuotaExhaustedError) {
      return { status: 'quota-exhausted', message: 'Image provider quota still exhausted; try again later.' };
    }
    return { status: 'failed', message: errMsg(err) };
  }
}

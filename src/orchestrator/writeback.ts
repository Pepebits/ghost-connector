import { recordApplyAttempt } from '../db/repo.js';
import { ghostApi } from '../ghost/client.js';
import { readRawPost } from '../ghost/posts.js';
import { acquireFeatureImage } from '../images/pipeline.js';
import { uploadChosen } from './imageChoice.js';
import { QuotaExhaustedError } from '../images/provider.js';
import { logger } from '../logger.js';
import { acquireWriteLock } from '../util/lock.js';
import { findPendingMarkers } from '../util/pending.js';
import { unknownLinks } from '../review/links.js';
import { saveArtifact } from '../review/store.js';
import type { ApplyReasonCode, ImageOutcome, PostPatch, RunArtifact, SanityCheckResult, WritebackResult } from '../types.js';
import { buildPostPatch } from './merge.js';

const MAX_BODY_RATIO = { min: 0.5, max: 4 };
// Below this, the draft has no real content to "expand":
// it's the case the writer prompt treats as empty/title-only (rule 2
// of writer.system.md), where developing the whole topic from general
// knowledge is the CORRECT behavior, not a derailment. The ratio becomes
// statistically absurd with small denominators.
//
// Hand-calibrated by reviewing real applied drafts (see M9 commits):
// drafts of 84-199 words expand perfectly legitimately
// to 600-950 words (4.4x-11.3x) because there isn't enough original content
// to preserve; drafts of 300+ words with substantial content
// stay at modest ratios (1.9x-2.0x) because the writer preserves more than it
// develops. 200 words is the point where the two patterns diverge.
const MIN_MEANINGFUL_WORDS = 200;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function sanityCheckBody(artifact: RunArtifact): SanityCheckResult | null {
  const before = wordCount((artifact.snapshot.html ?? '').replace(/<[^>]+>/g, ' '));
  const after = wordCount(artifact.writer?.markdown ?? '');
  if (before < MIN_MEANINGFUL_WORDS) return null;
  const ratio = after / before;
  const ok = ratio >= MAX_BODY_RATIO.min && ratio <= MAX_BODY_RATIO.max;
  return { wordsBefore: before, wordsAfter: after, ratio, min: MAX_BODY_RATIO.min, max: MAX_BODY_RATIO.max, ok };
}

export interface ApplyOptions {
  /** If false (default), aborts when the final markdown has unresolved [[PENDING:]] markers. */
  allowPending?: boolean;
  /** If true, applies anyway even if the body sanity guard fails (explicit decision, after reviewing the diff). */
  forceSanity?: boolean;
  /** If true, applies even if the text has links that don't come from any known source (see review/links.ts). */
  allowUnknownLinks?: boolean;
  /** With no image chosen, searches and sets the first one found (the old behavior; CLI only). */
  autoImage?: boolean;
}

export interface ApplyPrecheck {
  canApply: boolean;
  notDraft: boolean;
  conflict: { plannedUpdatedAt: string; actualUpdatedAt: string } | null;
  pending: string[];
  unknownLinks: string[];
  /** What will happen with the featured image. */
  image: 'existing' | 'replace' | 'remove' | 'chosen' | 'none-chosen' | 'not-chosen' | 'no-plan';
  sanity: SanityCheckResult | null;
}

/**
 * Evaluates the same guards as applyArtifact() WITHOUT writing anything to Ghost or
 * resolving the image. Meant for the UI to show "this would happen" before
 * asking for explicit confirmation.
 */
export async function precheckApply(artifact: RunArtifact): Promise<ApplyPrecheck> {
  const fresh = await readRawPost(artifact.postId);
  const notDraft = fresh.status !== 'draft';
  const conflict =
    fresh.updated_at !== artifact.snapshot.updated_at
      ? { plannedUpdatedAt: artifact.snapshot.updated_at, actualUpdatedAt: fresh.updated_at }
      : null;
  const pending = artifact.writer ? findPendingMarkers(artifact.writer.markdown) : [];
  const sanity = sanityCheckBody(artifact);
  const links = unknownLinks(artifact);

  return {
    canApply: !notDraft && !conflict && pending.length === 0 && links.length === 0 && (!sanity || sanity.ok),
    notDraft,
    conflict,
    pending,
    unknownLinks: links,
    image: fresh.feature_image
      ? artifact.imageChoice?.kind === 'option'
        ? 'replace'
        : artifact.imageChoice?.kind === 'remove'
          ? 'remove'
          : 'existing'
      : artifact.imageChoice?.kind === 'option'
        ? 'chosen'
        : artifact.imageChoice?.kind === 'none'
          ? 'none-chosen'
          : artifact.imagePlan && artifact.imagePlan.strategy !== 'skip'
            ? 'not-chosen'
            : 'no-plan',
    sanity,
  };
}

function makeResult(
  status: WritebackResult['status'],
  reasonCode: ApplyReasonCode,
  message: string,
  extra: Partial<Omit<WritebackResult, 'status' | 'reasonCode' | 'message'>> = {},
): WritebackResult {
  return { status, reasonCode, message, image: { kind: 'none' }, ...extra };
}

/** Persists the result to the on-disk artifact. Best-effort: never breaks the apply if it fails. */
async function persist(
  artifact: RunArtifact,
  outcome: WritebackResult,
  overrides: { patch?: PostPatch; contentSource?: 'html'; uploadedImage?: RunArtifact['uploadedImage']; appliedUpdatedAt?: string } = {},
): Promise<WritebackResult> {
  try {
    await saveArtifact({
      ...artifact,
      status: outcome.status,
      patch: overrides.patch ?? artifact.patch,
      contentSource: overrides.contentSource ?? artifact.contentSource,
      uploadedImage: overrides.uploadedImage ?? artifact.uploadedImage,
      ...(overrides.appliedUpdatedAt ? { appliedUpdatedAt: overrides.appliedUpdatedAt } : {}),
    });
  } catch (err) {
    logger.warn({ id: artifact.postId, err: errMsg(err) }, 'Could not persist the apply result in the artifact');
  }
  recordApplyAttempt({
    postId: artifact.postId,
    runId: artifact.runId,
    result: outcome.status,
    reasonCode: outcome.reasonCode,
    message: outcome.message,
    imageResult: outcome.image.kind,
    provenance: 'recorded',
  });
  return outcome;
}

/**
 * Writes the planned patch to Ghost. Safety protocol, in order:
 * 1. Re-reads the post RIGHT NOW (doesn't trust the plan's snapshot, which
 *    may be minutes or hours old).
 * 2. If `updated_at` changed since the plan was generated, aborts as
 *    "conflict": someone (you, or another process) edited the post since then.
 * 3. If it's no longer a draft, aborts as "skipped".
 * 4. Sanity heuristic: if the body changed size drastically,
 *    or [[PENDING:]] remain without `allowPending`, aborts.
 * 5. Resolves the image (the only point in the flow that actually writes to
 *    Ghost, so it's the right time to spend image quota).
 * 6. PUT with `?save_revision=true`: keeps the previous content recoverable
 *    from Ghost's revision history no matter what.
 * `status` is ALWAYS hardcoded to 'draft'; this connector never publishes.
 *
 * The result (success or not) is persisted to the on-disk artifact, so
 * `src/state/postState.ts` can reconstruct what was applied without guessing.
 */
export async function applyArtifact(artifact: RunArtifact, opts: ApplyOptions = {}): Promise<WritebackResult> {
  if (artifact.status !== 'planned') {
    return makeResult('skipped', 'not-planned', `The artifact has status "${artifact.status}" (not "planned"). Not applying.`);
  }
  if (!artifact.writer) {
    return persist(artifact, makeResult('skipped', 'no-writer-output', 'No WriterOutput in the artifact. No content to apply.'));
  }

  const fresh = await readRawPost(artifact.postId);

  if (fresh.updated_at !== artifact.snapshot.updated_at) {
    const message = `The post changed in Ghost since the plan was generated (updated_at ${artifact.snapshot.updated_at} -> ${fresh.updated_at}). Run "plan" again for this post before applying.`;
    logger.warn({ id: artifact.postId }, message);
    return persist(
      artifact,
      makeResult('conflict', 'conflict-updated-at', message, {
        conflict: { plannedUpdatedAt: artifact.snapshot.updated_at, actualUpdatedAt: fresh.updated_at },
      }),
    );
  }
  if (fresh.status !== 'draft') {
    return persist(artifact, makeResult('skipped', 'not-draft', `The post is no longer a draft (status=${fresh.status}).`));
  }

  const pending = findPendingMarkers(artifact.writer.markdown);
  if (pending.length > 0 && !opts.allowPending) {
    return persist(
      artifact,
      makeResult(
        'skipped',
        'pending-unresolved',
        `${pending.length} unresolved [[PENDING:]] marker(s). Complete the draft or run "apply" with --allow-pending if you really want to leave it like that.`,
        { pending },
      ),
    );
  }

  const links = unknownLinks(artifact);
  if (links.length > 0 && !opts.allowUnknownLinks) {
    return persist(
      artifact,
      makeResult(
        'skipped',
        'unknown-links',
        `${links.length} link(s) or image(s) that come from no known source (draft, instructions, fetched sources or your answers): ${links.slice(0, 5).join(', ')}. Review them. If they are correct, apply with --allow-links.`,
        { unknownLinks: links },
      ),
    );
  }

  const sanity = sanityCheckBody(artifact);
  if (sanity && !sanity.ok && !opts.forceSanity) {
    return persist(
      artifact,
      makeResult(
        'skipped',
        'sanity-body-ratio',
        `The new body (${sanity.wordsAfter} words) is ${sanity.ratio.toFixed(1)}x the original (${sanity.wordsBefore} words), outside the range [${sanity.min}x, ${sanity.max}x]. The writer may have gone off the rails.`,
        { sanity },
      ),
    );
  }

  // Advisory lock: prevents the CLI and the server from writing the SAME post at
  // once (the updated_at guard further down already guarantees correctness
  // even if this lock failed; this just avoids the confusion of clobbering).
  let releaseLock: (() => void) | null = null;
  try {
    releaseLock = acquireWriteLock(`apply:${artifact.postId}`);
  } catch (err) {
    return persist(artifact, makeResult('failed', 'write-locked', errMsg(err)));
  }

  try {
    // The image is resolved HERE, not in `plan`: it's the first point in the flow
    // that will actually write to Ghost, so it's the right time
    // to spend Unsplash/Pexels quota and upload the file to the media
    // library.
    let patch: PostPatch = artifact.patch;
    let contentSource = artifact.contentSource;
    let uploadedImage: RunArtifact['uploadedImage'] = null;
    let image: ImageOutcome = { kind: 'none' };

    // The editor picks the image (see imageChoice.ts). With no choice, none
    // is set, unless explicitly requested (--auto-image).
    const choice = artifact.imageChoice;
    const wantsAuto = !choice && opts.autoImage && artifact.imagePlan && artifact.imagePlan.strategy !== 'skip';
    if (choice?.kind === 'remove') {
      // Only clears the reference: Ghost's Admin API can't delete uploaded
      // files, so the image stays in the site's media library.
      if (fresh.feature_image) {
        patch = { ...patch, feature_image: null, feature_image_alt: null, feature_image_caption: null };
        image = { kind: 'removed' };
      } else {
        image = { kind: 'none' };
      }
    } else if (fresh.feature_image && choice?.kind !== 'option') {
      image = { kind: 'skipped-existing' };
    } else if (choice?.kind === 'none') {
      image = { kind: 'skipped-plan' };
    } else if (!choice && !wantsAuto) {
      image = artifact.imagePlan && artifact.imagePlan.strategy !== 'skip' ? { kind: 'not-chosen' } : { kind: 'none' };
    } else {
      try {
        const acquired =
          choice?.kind === 'option'
            ? await uploadChosen(artifact, artifact.snapshot.slug)
            : await acquireFeatureImage(artifact.imagePlan!, {
                postTitle: artifact.writer.title,
                slug: artifact.snapshot.slug,
                existingFeatureImage: fresh.feature_image ?? null,
              });
        if (acquired) {
          const rebuilt = buildPostPatch({ snapshot: artifact.snapshot, writer: artifact.writer, seo: artifact.seo, uploadedImage: acquired });
          patch = rebuilt.patch;
          contentSource = rebuilt.contentSource;
          uploadedImage = acquired;
          image = { kind: 'uploaded', url: acquired.url };
        } else {
          image = { kind: 'failed', message: 'No image provider found a valid result' };
        }
      } catch (err) {
        if (err instanceof QuotaExhaustedError) {
          image = { kind: 'quota-exhausted' };
          logger.warn({ id: artifact.postId }, 'Image provider quota exhausted. Applying the rest without an image');
        } else {
          image = { kind: 'failed', message: errMsg(err) };
          logger.warn({ id: artifact.postId, err: errMsg(err) }, 'Could not upload the image. Applying the rest without it');
        }
      }
    }

    let appliedUpdatedAt: string | undefined;
    try {
      // No automatic retry on purpose: if this PUT half-fails (e.g.
      // it was applied but the response was lost), blindly retrying could
      // collide with the very `updated_at` we just sent. It's
      // safer to return 'failed' and let the user run `apply`
      // again, which re-reads the post fresh before retrying.
      const saved = (await ghostApi().posts.edit(
        { id: artifact.postId, ...patch, updated_at: fresh.updated_at, status: 'draft' },
        { source: contentSource, save_revision: true },
      )) as { updated_at?: string } | undefined;
      appliedUpdatedAt = saved?.updated_at;
    } catch (err) {
      const message = errMsg(err);
      logger.error({ id: artifact.postId, err: message }, 'PUT to Ghost failed');
      return persist(artifact, makeResult('failed', 'ghost-put-failed', message, { image }), { patch, contentSource, uploadedImage });
    }

    logger.info({ id: artifact.postId }, 'Post updated in Ghost (draft, revision saved)');
    return persist(artifact, makeResult('applied', 'ok', 'OK', { image, sanity: sanity ?? undefined }), { patch, contentSource, uploadedImage, appliedUpdatedAt });
  } finally {
    releaseLock();
  }
}

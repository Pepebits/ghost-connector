import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { recordApplyAttempt } from '../db/repo.js';
import { ghostApi } from '../ghost/client.js';
import { readRawPost } from '../ghost/posts.js';
import { acquireWriteLock } from '../util/lock.js';
import { t } from '../i18n/index.js';
import { join, resolve, sep } from 'node:path';
import { getConfig } from '../config.js';
import { uploadImage } from '../ghost/images.js';
import { searchImageOptions, type FeatureImageResult } from '../images/pipeline.js';
import { formatCredit } from '../images/provider.js';
import { stockSource } from '../images/registry.js';
import { saveArtifact } from '../review/store.js';
import type { ImageOutcome, PostPatch, RunArtifact } from '../types.js';
import { slugify } from '../util/slug.js';

/**
 * Featured image choice BEFORE applying: candidates are searched
 * (without downloading), the editor picks one, it's downloaded to DATA_DIR/images to
 * view it and tweak its text, and only on apply is it uploaded to Ghost. With no
 * choice, apply sets no image.
 */

const IMAGES_DIR = 'images';

/** runId of the image-only work (changing the featured image without a text plan). */
export const IMAGE_ONLY_RUN = 'image-only';

/**
 * What the image functions work on: a plan's artifact, or the image-only
 * work, stored apart from the plans in DATA_DIR/images/<post>/image-only.json
 * so changing the photo never needs (or pays for) regenerating the text.
 */
export type ImageWork = Pick<RunArtifact, 'postId' | 'runId' | 'postTitle' | 'status' | 'imagePlan' | 'writer' | 'imageOptions' | 'imageChoice'> & {
  /** Image-only: language of the post (for the credit), taken from its last plan. */
  language?: string;
};

function assertPlan(work: ImageWork): void {
  if (work.status !== 'planned') throw new Error(t('image.errors.notPlanned'));
}

function imageOnlyPath(postId: string): string {
  return localImagePath(join(IMAGES_DIR, postId, `${IMAGE_ONLY_RUN}.json`));
}

async function store<T extends ImageWork>(work: T): Promise<T> {
  if (work.runId === IMAGE_ONLY_RUN) {
    const file = imageOnlyPath(work.postId);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, JSON.stringify(work, null, 2));
  } else {
    await saveArtifact(work as unknown as RunArtifact);
  }
  return work;
}

/** The post's image-only work (empty if there is none yet). */
export async function loadImageOnly(postId: string, postTitle: string, language?: string): Promise<ImageWork> {
  try {
    return JSON.parse(await readFile(imageOnlyPath(postId), 'utf8')) as ImageWork;
  } catch {
    return { postId, runId: IMAGE_ONLY_RUN, postTitle, status: 'planned', imagePlan: null, writer: null, language };
  }
}

function extFor(contentType: string): string {
  return contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
}

/** Absolute path of the local copy, checking it doesn't escape DATA_DIR/images. */
export function localImagePath(relative: string): string {
  const base = resolve(getConfig().DATA_DIR, IMAGES_DIR);
  const full = resolve(getConfig().DATA_DIR, relative);
  if (!full.startsWith(base + sep)) throw new Error(t('image.errors.outsideData'));
  return full;
}

async function removeLocal(artifact: ImageWork): Promise<void> {
  if (artifact.imageChoice?.kind === 'option') await rm(localImagePath(artifact.imageChoice.localFile), { force: true }).catch(() => {});
}

export async function searchPlanImages<T extends ImageWork>(artifact: T, query: string, source?: string): Promise<T> {
  assertPlan(artifact);
  const q = query.trim() || artifact.imagePlan?.unsplash_query || artifact.postTitle;
  const found = await searchImageOptions(q, artifact.imagePlan?.orientation ?? 'landscape', source);
  const updated: T = { ...artifact, imageOptions: { ...found, at: new Date().toISOString() } };
  return store(updated);
}

/** Downloads candidate `index` locally (doesn't touch Ghost) and marks it as chosen. */
export async function choosePlanImage<T extends ImageWork>(artifact: T, index: number): Promise<T> {
  assertPlan(artifact);
  const option = artifact.imageOptions?.options[index];
  if (!option) throw new Error(t('image.errors.gone'));
  const source = stockSource(option.provider);
  if (!source) throw new Error(`Unknown source: ${option.provider}`);
  const candidate = await source.download(option);

  const relative = join(IMAGES_DIR, artifact.postId, `${artifact.runId}-${option.provider}-${slugify(option.id)}.${extFor(candidate.contentType)}`);
  const full = localImagePath(relative);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, candidate.buffer);
  await removeLocal(artifact);

  const previous = artifact.imageChoice?.kind === 'option' ? artifact.imageChoice : null;
  const updated: T = {
    ...artifact,
    imageChoice: {
      kind: 'option',
      option,
      localFile: relative,
      contentType: candidate.contentType,
      // Keep whatever the editor had already written when switching photos.
      alt: previous?.alt ?? artifact.imagePlan?.alt_text ?? '',
      captionText: previous?.captionText ?? '',
    },
  };
  return store(updated);
}

export async function editPlanImageText<T extends ImageWork>(artifact: T, alt: string, captionText: string): Promise<T> {
  assertPlan(artifact);
  if (artifact.imageChoice?.kind !== 'option') throw new Error(t('image.errors.chooseFirst'));
  const updated: T = {
    ...artifact,
    imageChoice: { ...artifact.imageChoice, alt: alt.trim().slice(0, 191), captionText: captionText.replace(/\s+/g, ' ').trim().slice(0, 300) },
  };
  return store(updated);
}

export async function skipPlanImage<T extends ImageWork>(artifact: T): Promise<T> {
  assertPlan(artifact);
  await removeLocal(artifact);
  const updated: T = { ...artifact, imageChoice: { kind: 'none' } };
  return store(updated);
}

/** Clear the post's current featured image on apply (the file stays in Ghost: its API can't delete it). */
export async function removeCurrentImage<T extends ImageWork>(artifact: T): Promise<T> {
  assertPlan(artifact);
  await removeLocal(artifact);
  const updated: T = { ...artifact, imageChoice: { kind: 'remove' } };
  return store(updated);
}

/** Undo the choice: keep whatever image the post has now (or none). */
export async function keepCurrentImage<T extends ImageWork>(artifact: T): Promise<T> {
  assertPlan(artifact);
  await removeLocal(artifact);
  const { imageChoice: _drop, ...rest } = artifact;
  const updated = rest as T;
  return store(updated);
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Language the post is written in (the credit is published with it). */
export function postLanguage(work: ImageWork): string {
  return work.writer?.language ?? work.language ?? 'en';
}

/** Final caption: the editor's text (escaped) and, always, the source attribution in the post's language. */
export function chosenCaption(choice: Extract<NonNullable<RunArtifact['imageChoice']>, { kind: 'option' }>, lang = 'en'): string {
  const credit = formatCredit(choice.option.attribution, lang);
  return choice.captionText ? `${escapeHtml(choice.captionText)} · ${credit}` : credit;
}

/** On apply: uploads the local copy of the chosen image to Ghost (or re-downloads it if it was deleted). */
export async function uploadChosen(artifact: ImageWork, slug: string): Promise<FeatureImageResult> {
  const choice = artifact.imageChoice;
  if (choice?.kind !== 'option') throw new Error(t('image.errors.noneChosen'));
  let buffer: Buffer;
  let contentType = choice.contentType;
  try {
    buffer = await readFile(localImagePath(choice.localFile));
  } catch {
    const again = await stockSource(choice.option.provider)!.download(choice.option);
    buffer = again.buffer;
    contentType = again.contentType;
  }
  const uploaded = await uploadImage(buffer, `${slugify(choice.alt || choice.option.id)}.${extFor(contentType)}`, `${slug}-feature`);
  return { url: uploaded.url, alt: choice.alt, caption: chosenCaption(choice, postLanguage(artifact)) };
}

/**
 * Applies the image-only work: re-reads the post and writes ONLY the
 * featured image fields (with the same updated_at guard as a full apply),
 * then discards the work. The text is never touched.
 */
export async function applyImageOnly(postId: string): Promise<ImageOutcome> {
  const fresh = await readRawPost(postId);
  const work = await loadImageOnly(postId, fresh.title);
  const choice = work.imageChoice;
  if (fresh.status !== 'draft') throw new Error(`The post is no longer a draft (status=${fresh.status}).`);
  if (choice?.kind !== 'option' && choice?.kind !== 'remove') throw new Error(t('image.errors.noneChosen'));

  const release = acquireWriteLock(`apply:${postId}`);
  try {
    let patch: Partial<PostPatch>;
    let image: ImageOutcome;
    if (choice.kind === 'remove') {
      patch = { feature_image: null, feature_image_alt: null, feature_image_caption: null };
      image = fresh.feature_image ? { kind: 'removed' } : { kind: 'none' };
    } else {
      const uploaded = await uploadChosen(work, fresh.slug);
      patch = { feature_image: uploaded.url, feature_image_alt: uploaded.alt || null, feature_image_caption: uploaded.caption };
      image = { kind: 'uploaded', url: uploaded.url };
    }
    await ghostApi().posts.edit({ id: postId, ...patch, updated_at: fresh.updated_at });
    recordApplyAttempt({ postId, runId: IMAGE_ONLY_RUN, result: 'applied', reasonCode: 'ok', message: 'Featured image only', imageResult: image.kind, provenance: 'recorded' });
    await removeLocal(work);
    await rm(imageOnlyPath(postId), { force: true });
    return image;
  } finally {
    release();
  }
}

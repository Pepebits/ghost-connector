import type { RunArtifact } from '../types.js';
import { buildPostPatch } from './merge.js';
import { saveArtifact } from '../review/store.js';

export interface PlanEdits {
  title: string;
  markdown: string;
  meta_title?: string;
  meta_description?: string;
  custom_excerpt?: string;
}

/**
 * Manual editing of a not-yet-applied plan. The SAME artifact is
 * rewritten (same runId: it's still "the plan" for this post, now
 * tweaked) and the patch is regenerated with buildPostPatch, just like the
 * pipeline, so apply doesn't need to know there was an edit. The
 * conflict check (snapshot updated_at) doesn't change: if the post
 * was touched in Ghost after the plan, apply still blocks it.
 */
export async function editPlannedArtifact(artifact: RunArtifact, edits: PlanEdits): Promise<RunArtifact> {
  if (artifact.status !== 'planned' || !artifact.writer) {
    throw new Error('Only a current ("planned") plan with writer text can be edited.');
  }
  const markdown = edits.markdown.replace(/\r\n/g, '\n').trim();
  const title = edits.title.trim();
  if (!markdown) throw new Error('The body cannot be empty.');
  if (!title) throw new Error('The title cannot be empty.');

  const writer = { ...artifact.writer, title, markdown };
  const seo = artifact.seo
    ? {
        ...artifact.seo,
        meta_title: edits.meta_title?.trim() ?? artifact.seo.meta_title,
        meta_description: edits.meta_description?.trim() ?? artifact.seo.meta_description,
        custom_excerpt: edits.custom_excerpt?.trim() ?? artifact.seo.custom_excerpt,
      }
    : null;
  const { patch, contentSource } = buildPostPatch({ snapshot: artifact.snapshot, writer, seo, uploadedImage: artifact.uploadedImage });

  const updated: RunArtifact = {
    ...artifact,
    postTitle: title,
    writer,
    seo,
    patch,
    contentSource,
    editedAt: new Date().toISOString(),
  };
  await saveArtifact(updated);
  return updated;
}

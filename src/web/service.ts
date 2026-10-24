import { resolveWriterMode } from '../agents/writer.agent.js';
import { type ApplyAttemptRow, listApplyAttempts } from '../db/repo.js';
import { readDraft } from '../ghost/posts.js';
import { loadImageOnly, type ImageWork } from '../orchestrator/imageChoice.js';
import { findLatestArtifact } from '../review/store.js';
import { computePostState, type PostState } from '../state/postState.js';
import type { RunArtifact } from '../types.js';

/**
 * Data layer between the HTTP routes and the src/ core. Hard rule: nothing
 * under src/web/ talks to Ghost, DeepSeek, Unsplash or Pexels directly.
 * Everything goes through here (or through src/state, src/orchestrator, etc.).
 */
export interface PostDetail {
  state: PostState;
  latestArtifact: RunArtifact | null;
  applyHistory: ApplyAttemptRow[];
  /** Mode the writer would use in "Automatic" on the CURRENT Ghost content. */
  detectedMode: 'draft' | 'improve';
  /** Image-only work (change just the featured image), when there is no pending plan. */
  imageOnly: ImageWork | null;
}

export async function getPostDetail(postId: string): Promise<PostDetail> {
  const live = await readDraft(postId);
  const latestArtifact = await findLatestArtifact(postId);
  const state = computePostState(live, latestArtifact);
  const applyHistory = listApplyAttempts(postId);
  const hasPlan = latestArtifact?.status === 'planned' && !!latestArtifact.writer;
  const imageOnly = hasPlan ? null : await loadImageOnly(postId, live.title, latestArtifact?.writer?.language);
  return { state, latestArtifact, applyHistory, detectedMode: resolveWriterMode(live), imageOnly };
}

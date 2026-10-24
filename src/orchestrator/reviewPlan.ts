import { recordReviewDecisions } from '../db/repo.js';
import { applyDecisions, categorizedChanges, markdownFingerprint, planHunks } from '../review/blocks.js';
import type { RunArtifact } from '../types.js';
import { editPlannedArtifact } from './editPlan.js';

export class StaleReviewError extends Error {
  constructor() {
    super('The plan changed while you were reviewing it (another edit or a new plan). Reload the page and review again.');
    this.name = 'StaleReviewError';
  }
}

/**
 * Applies the per-hunk review decisions to the plan (one per hunk,
 * `true` = keep the writer's version). Saved through the same path as
 * manual editing, and what was accepted/rejected is recorded for prompt
 * suggestions.
 */
export async function applyPlanReview(artifact: RunArtifact, fingerprint: string, decisions: boolean[]): Promise<RunArtifact> {
  if (!artifact.writer) throw new Error('This plan has no writer text to review.');
  if (markdownFingerprint(artifact.writer.markdown) !== fingerprint) throw new StaleReviewError();

  const hunks = planHunks(artifact.snapshot.html, artifact.writer.markdown);
  const markdown = applyDecisions(hunks, decisions);
  const updated = await editPlannedArtifact(artifact, { title: artifact.writer.title, markdown });

  recordReviewDecisions({
    postId: artifact.postId,
    runId: artifact.runId,
    decisions: categorizedChanges(hunks).map((c, i) => ({ category: c.category, accepted: decisions[i] ?? true })),
  });
  return updated;
}

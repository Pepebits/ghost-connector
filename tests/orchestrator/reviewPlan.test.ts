import { describe, expect, it } from 'vitest';
import { getReviewStats } from '../../src/db/repo.js';
import { applyPlanReview, StaleReviewError } from '../../src/orchestrator/reviewPlan.js';
import { markdownFingerprint } from '../../src/review/blocks.js';
import { findLatestArtifact } from '../../src/review/store.js';
import type { RunArtifact } from '../../src/types.js';

function makePlan(): RunArtifact {
  const markdown = 'Entradilla reescrita por el writer.\n\n## Seccion nueva\n\nTexto nuevo.';
  return {
    runId: 'run-review-1',
    postId: 'post-review-1',
    postTitle: 'Post',
    createdAt: '2026-01-01T00:00:00.000Z',
    snapshot: {
      id: 'post-review-1', uuid: 'u', slug: 's', title: 'Post', html: '<p>Entradilla original del autor.</p>', lexical: null,
      custom_excerpt: null, feature_image: null, feature_image_alt: null, feature_image_caption: null, meta_title: null,
      meta_description: null, og_title: null, og_description: null, twitter_title: null, twitter_description: null,
      tags: [], authors: [], status: 'draft', updated_at: '2026-01-01T00:00:00.000Z', created_at: '2026-01-01T00:00:00.000Z', url: 'https://example.test/s/',
    },
    writer: { title: 'Post', markdown, outline: [], summary: '', language: 'es', changes_made: [], confidence: 'high' },
    seo: null, imagePlan: null, uploadedImage: null, patch: { status: 'draft' },
    cost: { inputTokens: 0, outputTokens: 0, usd: 0 }, errors: [], status: 'planned',
  };
}

describe('orchestrator/reviewPlan', () => {
  it('rejecting the lede and accepting the new section saves the merge and records the decisions', async () => {
    const plan = makePlan();
    // Hunks: [original lede -> rewritten] and [new section added]
    await applyPlanReview(plan, markdownFingerprint(plan.writer!.markdown), [false, true]);
    const saved = await findLatestArtifact('post-review-1');
    expect(saved?.writer?.markdown).toBe('Entradilla original del autor.\n\n## Seccion nueva\n\nTexto nuevo.');
    expect(saved?.patch.html).toContain('Entradilla original del autor.');
    expect(saved?.editedAt).toBeTruthy();
    expect(getReviewStats().find((s) => s.category === 'modified:intro')?.rejected).toBeGreaterThanOrEqual(1);
  });

  it('rejects a review made against another plan version', async () => {
    await expect(applyPlanReview(makePlan(), 'huella-vieja', [true, true])).rejects.toBeInstanceOf(StaleReviewError);
  });
});

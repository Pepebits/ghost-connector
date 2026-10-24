import { describe, expect, it, vi } from 'vitest';
import type { RunArtifact } from '../../src/types.js';

// Ghost is mocked: the test checks what apply sends for each image choice.
const edit = vi.fn(async () => ({}));
const fresh = { id: 'p1', status: 'draft', updated_at: 'u1', feature_image: 'https://site.test/content/images/old.jpg', html: '<p>x</p>', lexical: null, slug: 's', title: 'Post', tags: [] };
vi.mock('../../src/ghost/client.js', () => ({ ghostApi: () => ({ posts: { edit } }) }));
vi.mock('../../src/ghost/posts.js', () => ({ readRawPost: vi.fn(async () => fresh) }));
vi.mock('../../src/orchestrator/imageChoice.js', () => ({ uploadChosen: vi.fn(async () => ({ url: 'https://site.test/content/images/new.jpg', alt: 'New', caption: null })) }));

const { applyArtifact, precheckApply } = await import('../../src/orchestrator/writeback.js');

function plan(imageChoice: RunArtifact['imageChoice']): RunArtifact {
  return {
    runId: `run-${Math.random()}`, postId: 'p1', postTitle: 'Post', createdAt: '', status: 'planned',
    snapshot: { id: 'p1', slug: 's', title: 'Post', html: '<p>x</p>', tags: [], updated_at: 'u1', feature_image: fresh.feature_image } as unknown as RunArtifact['snapshot'],
    writer: { title: 'Post', markdown: 'x', outline: [], summary: '', language: 'en', changes_made: [], confidence: 'high' },
    seo: null, uploadedImage: null, patch: { status: 'draft' }, contentSource: 'html', cost: { inputTokens: 0, outputTokens: 0, usd: 0 }, errors: [],
    imagePlan: null, imageChoice,
  } as unknown as RunArtifact;
}

const sent = () => (edit.mock.calls.at(-1) as unknown as [Record<string, unknown>])[0];

describe('apply: featured image the post already has', () => {
  it('no choice keeps it untouched', async () => {
    const r = await applyArtifact(plan(undefined), { forceSanity: true });
    expect(r.image).toEqual({ kind: 'skipped-existing' });
    expect(sent()).not.toHaveProperty('feature_image');
    expect((await precheckApply(plan(undefined))).image).toBe('existing');
  });

  it('"remove" clears image, alt and caption', async () => {
    const r = await applyArtifact(plan({ kind: 'remove' }), { forceSanity: true });
    expect(r.image).toEqual({ kind: 'removed' });
    expect(sent()).toMatchObject({ feature_image: null, feature_image_alt: null, feature_image_caption: null });
    expect((await precheckApply(plan({ kind: 'remove' }))).image).toBe('remove');
  });

  it('a chosen image replaces it, without leaving the old caption', async () => {
    const choice = { kind: 'option', option: {}, localFile: 'images/x.jpg', contentType: 'image/jpeg', alt: 'New', captionText: '' } as unknown as RunArtifact['imageChoice'];
    const r = await applyArtifact(plan(choice), { forceSanity: true });
    expect(r.image).toEqual({ kind: 'uploaded', url: 'https://site.test/content/images/new.jpg' });
    expect(sent()).toMatchObject({ feature_image: 'https://site.test/content/images/new.jpg', feature_image_caption: null });
    expect((await precheckApply(plan(choice))).image).toBe('replace');
  });
});

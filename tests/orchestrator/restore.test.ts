import { describe, expect, it, vi } from 'vitest';
import type { RunArtifact } from '../../src/types.js';

const edit = vi.fn(async () => ({}));
let fresh = { id: 'p-rs', status: 'draft', updated_at: 'after-apply' };
vi.mock('../../src/ghost/client.js', () => ({ ghostApi: () => ({ posts: { edit } }) }));
vi.mock('../../src/ghost/posts.js', () => ({ readRawPost: vi.fn(async () => fresh) }));

const { canRestore, restoreLastApply } = await import('../../src/orchestrator/restore.js');
const { findLatestArtifact, saveArtifact } = await import('../../src/review/store.js');

function applied(extra: Partial<RunArtifact> = {}): RunArtifact {
  return {
    runId: 'run-rs-1', postId: 'p-rs', postTitle: 'Nuevo', createdAt: '2026-01-01T00:00:00.000Z', status: 'applied', appliedUpdatedAt: 'after-apply',
    snapshot: {
      id: 'p-rs', uuid: 'u', slug: 'viejo', title: 'Viejo', html: '<p>antes</p>', lexical: null, custom_excerpt: null, feature_image: null, feature_image_alt: null,
      feature_image_caption: null, meta_title: null, meta_description: null, og_title: null, og_description: null, twitter_title: null,
      twitter_description: null, tags: [{ id: 't1', name: 'coches', slug: 'coches' }], authors: [], status: 'draft', updated_at: 'before', created_at: '', url: '',
    },
    writer: { title: 'Nuevo', markdown: 'x', outline: [], summary: '', language: 'es', changes_made: [], confidence: 'high' },
    seo: null, imagePlan: null, uploadedImage: null,
    patch: { status: 'draft', title: 'Nuevo', html: '<p>despues</p>', meta_title: 'Meta', tags: [{ name: 'coches' }, { name: 'ai-processed' }] },
    cost: { inputTokens: 0, outputTokens: 0, usd: 0 }, errors: [],
    ...extra,
  };
}

describe('orchestrator/restore', () => {
  it('only applies done by this connector, not yet restored, can be undone', () => {
    expect(canRestore(applied())).toBe(true);
    expect(canRestore(applied({ appliedUpdatedAt: undefined }))).toBe(false);
    expect(canRestore(applied({ restoredAt: 'x' }))).toBe(false);
    expect(canRestore(applied({ status: 'planned' }))).toBe(false);
  });

  it('puts back only the fields the apply touched, from the snapshot', async () => {
    await saveArtifact(applied());
    expect(await restoreLastApply('p-rs')).toMatchObject({ status: 'restored' });
    const [body, opts] = edit.mock.calls.at(-1) as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(body).toEqual({ id: 'p-rs', status: 'draft', updated_at: 'after-apply', title: 'Viejo', html: '<p>antes</p>', meta_title: '', tags: [{ id: 't1' }] });
    expect(opts).toEqual({ source: 'html', save_revision: true });
    expect((await findLatestArtifact('p-rs'))?.restoredAt).toBeTruthy();
    expect(await restoreLastApply('p-rs')).toMatchObject({ status: 'unavailable' });
  });

  it('refuses if the post was touched in Ghost after the apply', async () => {
    await saveArtifact(applied({ runId: 'run-rs-2', createdAt: '2026-02-01T00:00:00.000Z' }));
    fresh = { ...fresh, updated_at: 'edited-by-hand' };
    edit.mockClear();
    expect(await restoreLastApply('p-rs')).toMatchObject({ status: 'conflict' });
    expect(edit).not.toHaveBeenCalled();
  });
});

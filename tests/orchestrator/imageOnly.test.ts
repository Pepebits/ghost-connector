import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ImageOption } from '../../src/images/provider.js';

// Ghost is mocked: changing only the image must never send the text.
const edit = vi.fn(async () => ({}));
const uploadImage = vi.fn(async () => ({ url: 'https://site.test/content/images/new.jpg' }));
const fresh = { id: 'p9', status: 'draft', updated_at: 'u9', feature_image: 'https://site.test/old.jpg', slug: 's', title: 'Post' };
vi.mock('../../src/ghost/client.js', () => ({ ghostApi: () => ({ posts: { edit } }) }));
vi.mock('../../src/ghost/posts.js', () => ({ readRawPost: vi.fn(async () => fresh) }));
vi.mock('../../src/ghost/images.js', () => ({ uploadImage }));
const download = vi.fn(async (o: ImageOption) => ({ buffer: Buffer.from('jpg'), contentType: 'image/jpeg', filename: 'x.jpg', sourceUrl: o.downloadUrl, attribution: o.attribution }));
vi.mock('../../src/images/registry.js', () => ({ stockSource: () => ({ download }), stockSources: () => [] }));

const { applyImageOnly, choosePlanImage, loadImageOnly, removeCurrentImage } = await import('../../src/orchestrator/imageChoice.js');

const option: ImageOption = {
  provider: 'unsplash', id: 'abc', thumbUrl: 'https://img.test/s.jpg', downloadUrl: 'https://img.test/l.jpg', width: 2000, height: 1200, pageUrl: null,
  attribution: { provider: 'unsplash', authorName: 'Ana', licenseNote: 'Unsplash License', htmlCredit: 'stored' },
};

describe('image-only work (no text plan)', () => {
  it('applies just the featured image, in the post language, and discards the work', async () => {
    const work = await loadImageOnly('p9', 'Post', 'es');
    const chosen = await choosePlanImage({ ...work, imageOptions: { query: 'q', options: [option], notes: [], at: '' } }, 0);
    expect((await loadImageOnly('p9', 'Post')).imageChoice?.kind).toBe('option');

    expect(await applyImageOnly('p9')).toEqual({ kind: 'uploaded', url: 'https://site.test/content/images/new.jpg' });
    const body = (edit.mock.calls.at(-1) as unknown as [Record<string, unknown>])[0];
    expect(Object.keys(body).sort()).toEqual(['feature_image', 'feature_image_alt', 'feature_image_caption', 'id', 'updated_at']);
    expect(body.feature_image_caption).toBe('Foto de Ana en Unsplash');
    expect(body.updated_at).toBe('u9');
    expect((await loadImageOnly('p9', 'Post')).imageChoice).toBeUndefined();
    if (chosen.imageChoice?.kind === 'option') expect(existsSync(chosen.imageChoice.localFile)).toBe(false);
  });

  it('remove clears the image fields only', async () => {
    await removeCurrentImage(await loadImageOnly('p9', 'Post'));
    expect(await applyImageOnly('p9')).toEqual({ kind: 'removed' });
    expect((edit.mock.calls.at(-1) as unknown as [Record<string, unknown>])[0]).toEqual({ id: 'p9', updated_at: 'u9', feature_image: null, feature_image_alt: null, feature_image_caption: null });
  });

  it('refuses to apply with nothing chosen', async () => {
    await expect(applyImageOnly('p9')).rejects.toThrow();
  });
});

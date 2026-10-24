import { describe, expect, it, vi } from 'vitest';

const post = { id: 'p1', title: 'Poda de tomates', url: 'https://blog.test/poda-tomates/', slug: 'poda-tomates', status: 'published', updated_at: 'u1', meta_title: 'Viejo', meta_description: 'Desc vieja', custom_excerpt: null, excerpt: 'x', plaintext: 'Texto' };
const edit = vi.fn(async (data: Record<string, unknown>) => {
  Object.assign(post, data, { updated_at: 'u2' });
  return post;
});
vi.mock('../../src/ghost/client.js', () => ({ ghostApi: () => ({ posts: { read: async () => ({ ...post }), edit } }) }));
vi.mock('../../src/agents/snippet.agent.js', () => ({
  suggestSnippet: async () => ({ data: { options: [{ meta_title: 'cómo podar tomates', meta_description: 'Pasos concretos para podar.', angle: 'a' }] }, usage: { inputTokens: 1, outputTokens: 1, usd: 0 } }),
}));

const { applySnippet, bareUrl, loadSnippet, refreshFollowUps, restoreSnippet, slugFromUrl, suggestForPage } = await import('../../src/orchestrator/snippet.js');

describe('orchestrator/snippet', () => {
  it('saca el slug de la URL', () => {
    expect(slugFromUrl('https://blog.test/poda-tomates/?utm=x')).toBe('poda-tomates');
    expect(slugFromUrl('nope')).toBeNull();
  });

  it('propone, aplica solo meta_title/meta_description sin status y restaura', async () => {
    const plan = await suggestForPage({ page: post.url, query: 'podar tomates', position: 3, ctr: 0.01 });
    expect(plan.options[0]!.meta_title).toBe('Cómo podar tomates');
    expect(await applySnippet('p1', { meta_title: 'Nuevo', meta_description: 'Desc nueva' })).toEqual({ status: 'applied' });
    expect(edit.mock.calls[0]![0]).toEqual({ id: 'p1', updated_at: 'u1', meta_title: 'Nuevo', meta_description: 'Desc nueva' });
    expect(await restoreSnippet('p1')).toEqual({ status: 'restored' });
    expect(post).toMatchObject({ meta_title: 'Viejo', meta_description: 'Desc vieja' });
  });

  it('no sobrescribe si se cambiaron en Ghost entre medias', async () => {
    await suggestForPage({ page: post.url, query: 'podar tomates', position: 3, ctr: 0.01 });
    post.meta_title = 'Cambiado a mano';
    edit.mockClear();
    expect(await applySnippet('p1', { meta_title: 'Nuevo', meta_description: 'D' })).toEqual({ status: 'conflict' });
    expect(edit).not.toHaveBeenCalled();
  });

  it('seguimiento: CTR de la busqueda desde el dia despues de aplicar, solo con dias suficientes', async () => {
    post.meta_title = 'Viejo';
    await suggestForPage({ page: post.url, query: 'podar tomates', position: 3, ctr: 0.01 });
    await applySnippet('p1', { meta_title: 'Nuevo', meta_description: 'D' });
    const fetch = vi.fn(async () => [
      { query: 'Podar tomates', page: post.url, clicks: 6, impressions: 100, position: 3 },
      { query: 'otra', page: post.url, clicks: 50, impressions: 60, position: 1 },
    ]);
    await refreshFollowUps(fetch);
    expect(fetch).not.toHaveBeenCalled(); // recien aplicado: aun no
    vi.useFakeTimers({ now: Date.now() + 10 * 86400_000, toFake: ['Date'] });
    await refreshFollowUps(fetch);
    vi.useRealTimers();
    expect(fetch).toHaveBeenCalledOnce();
    expect(loadSnippet('p1')?.followUp).toMatchObject({ impressions: 100, clicks: 6, ctr: 0.06, position: 3 });
  });

  it('no acepta una URL que no es la del post (p. ej. /tag/poda-tomates/)', async () => {
    await expect(suggestForPage({ page: 'https://blog.test/tag/poda-tomates/', query: 'q', position: 3, ctr: 0 })).rejects.toThrow(/not the URL/);
    expect(bareUrl('http://www.Blog.test/poda-tomates/?x=1')).toBe(bareUrl('https://blog.test/poda-tomates'));
  });

  it('el seguimiento filtra por la pagina tal como la da Search Console', async () => {
    post.meta_title = 'Viejo';
    post.meta_description = 'Desc vieja';
    await suggestForPage({ page: 'http://www.blog.test/poda-tomates', query: 'podar tomates', position: 3, ctr: 0.01 });
    await applySnippet('p1', { meta_title: 'Nuevo', meta_description: 'D' });
    const fetch = vi.fn(async (_s: Date, _e: Date, _page: string) => [] as never[]);
    vi.useFakeTimers({ now: Date.now() + 10 * 86400_000, toFake: ['Date'] });
    await refreshFollowUps(fetch);
    vi.useRealTimers();
    expect(fetch.mock.calls[0]![2]).toBe('http://www.blog.test/poda-tomates');
  });
});

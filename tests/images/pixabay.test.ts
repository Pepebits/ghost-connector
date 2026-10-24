import { afterEach, describe, expect, it, vi } from 'vitest';
import { reloadConfig } from '../../src/config.js';
import { PixabayProvider } from '../../src/images/pixabay.provider.js';

const hit = { id: 42, pageURL: 'https://pixabay.com/photos/huerto-42/', webformatURL: 'https://cdn.test/w.jpg', largeImageURL: 'https://cdn.test/l.jpg', imageWidth: 1920, imageHeight: 1280, user: 'Leo', user_id: 7 };

describe('PixabayProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PIXABAY_API_KEY;
    reloadConfig();
  });

  it('without a key it is skipped (null), without calling the API', async () => {
    process.env.PIXABAY_API_KEY = '';
    reloadConfig();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await new PixabayProvider().searchOptions('huerto', 'landscape', 10)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps the hits and asks for horizontal photos with safesearch', async () => {
    process.env.PIXABAY_API_KEY = 'k';
    reloadConfig();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ hits: [hit] }), { status: 200, headers: { 'x-ratelimit-remaining': '99' } }));
    vi.stubGlobal('fetch', fetchMock);
    const [opt] = (await new PixabayProvider().searchOptions('huerto', 'landscape', 10))!;
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get('orientation')).toBe('horizontal');
    expect(url.searchParams.get('safesearch')).toBe('true');
    expect(opt).toMatchObject({ provider: 'pixabay', id: '42', downloadUrl: 'https://cdn.test/l.jpg', attribution: { authorName: 'Leo', authorUrl: 'https://pixabay.com/users/Leo-7/' } });
  });
});

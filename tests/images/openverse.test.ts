import { describe, expect, it } from 'vitest';
import { openverseCredit } from '../../src/images/openverse.provider.js';
import { creditLink } from '../../src/images/provider.js';

const img = {
  id: 'x', url: 'https://example.com/a.jpg', width: 2000, height: 1200, filetype: 'jpg', source: 'flickr',
  title: 'Laptop Code', creator: 'Matthew Henry', creator_url: 'https://example.com/u',
  license: 'by', license_version: '2.0', license_url: 'https://creativecommons.org/licenses/by/2.0/',
  foreign_landing_url: 'https://example.com/photo',
};

describe('images/openverse', () => {
  it('TASL attribution: title, author, source and linked license', () => {
    expect(openverseCredit(img)).toBe(
      '<a href="https://example.com/photo">&quot;Laptop Code&quot;</a> by <a href="https://example.com/u">Matthew Henry</a> via Openverse, <a href="https://creativecommons.org/licenses/by/2.0/">CC BY 2.0</a>',
    );
  });

  it('escapes title and author (anyone can write them) and never links javascript:', () => {
    const credit = openverseCredit({ ...img, title: '<img src=x onerror=alert(1)>', creator: 'a"b', creator_url: 'javascript:alert(1)' });
    expect(credit).not.toContain('<img');
    expect(credit).not.toContain('javascript:');
    expect(credit).toContain('&lt;img');
    expect(creditLink('x', 'data:text/html,hi')).toBe('x');
  });

  it('still cites the license without title or author', () => {
    expect(openverseCredit({ ...img, title: null, creator: null, license: 'cc0', license_version: '1.0' })).toMatch(/Image.*via Openverse.*CC0 1\.0/);
  });
});

describe('images: source order', () => {
  it('IMAGE_SOURCES_ORDER accepts known names without repeats', async () => {
    const { validateEnv } = await import('../../src/config.js');
    const base = { ...process.env };
    expect(validateEnv({ ...base, IMAGE_SOURCES_ORDER: 'openverse,unsplash' }).ok).toBe(true);
    expect(validateEnv({ ...base, IMAGE_SOURCES_ORDER: 'openverse,flickr' }).ok).toBe(false);
    expect(validateEnv({ ...base, IMAGE_SOURCES_ORDER: 'pexels,pexels' }).ok).toBe(false);
  });

  it('StockPhotoProvider tries sources in the configured order', async () => {
    const { StockPhotoProvider } = await import('../../src/images/stock.provider.js');
    const calls: string[] = [];
    const fake = (name: string, hit: boolean) => ({
      name,
      supports: () => true,
      acquire: async () => { calls.push(name); return hit ? ({ sourceUrl: name } as never) : null; },
    });
    let order = ['a', 'b'];
    const sources = { a: fake('a', false), b: fake('b', true) };
    const stock = new StockPhotoProvider(() => order.map((n) => sources[n as 'a' | 'b']));
    await stock.acquire({} as never, { postTitle: '' });
    order = ['b', 'a'];
    await stock.acquire({} as never, { postTitle: '' });
    expect(calls).toEqual(['a', 'b', 'b']);
  });
});

describe('images/openverse: authentication', () => {
  it('reads the remaining quota from any rate-limit model', async () => {
    const { remainingFrom } = await import('../../src/images/openverse.provider.js');
    expect(remainingFrom(new Headers({ 'x-ratelimit-available-anon_sustained': '198' }))).toBe(198);
    expect(remainingFrom(new Headers({ 'x-ratelimit-available-standard_sustained': '9000' }))).toBe(9000);
    expect(remainingFrom(new Headers({}))).toBeNull();
  });

  it('does not request a token without credentials (anonymous search)', async () => {
    const { openverseAuthHeaders } = await import('../../src/images/openverseAuth.js');
    const { reloadConfig } = await import('../../src/config.js');
    const saved = { id: process.env.OPENVERSE_CLIENT_ID, secret: process.env.OPENVERSE_CLIENT_SECRET };
    // Isolated from the real .env (which may hold credentials): no network in tests.
    process.env.OPENVERSE_CLIENT_ID = '';
    process.env.OPENVERSE_CLIENT_SECRET = '';
    reloadConfig();
    try {
      expect(await openverseAuthHeaders()).toEqual({});
    } finally {
      if (saved.id === undefined) delete process.env.OPENVERSE_CLIENT_ID; else process.env.OPENVERSE_CLIENT_ID = saved.id;
      if (saved.secret === undefined) delete process.env.OPENVERSE_CLIENT_SECRET; else process.env.OPENVERSE_CLIENT_SECRET = saved.secret;
      reloadConfig();
    }
  });

  it('a partial save leaves booleans alone (registering does not disable Openverse)', async () => {
    const { resolveUpdates } = await import('../../src/settings/envFile.js');
    expect(resolveUpdates({ OPENVERSE_CLIENT_ID: 'id', OPENVERSE_CLIENT_SECRET: 's' })).toEqual({ OPENVERSE_CLIENT_ID: 'id', OPENVERSE_CLIENT_SECRET: 's' });
  });
});

describe('images/openverse: errors', () => {
  it('shows the per-field errors Openverse returns at the root', async () => {
    const { detail } = await import('../../src/images/openverseAuth.js');
    expect(detail({ email: ['Enter a valid email address.'] })).toBe('email: Enter a valid email address.');
    expect(detail({ name: ['already exists.'], email: ['x'] })).toBe('nombre: already exists.; email: x');
    expect(detail({ detail: 'Throttled' })).toBe('Throttled');
  });
});

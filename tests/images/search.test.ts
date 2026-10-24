import { describe, expect, it, vi } from 'vitest';

const opt = (provider: string, id: string) => ({ provider, id, thumbUrl: '', downloadUrl: '', width: 2000, height: 1200, pageUrl: null, attribution: { provider, licenseNote: '', htmlCredit: '' } });
const make = (name: string) => ({ name, searchOptions: vi.fn(async (_q: string, _o: string, limit: number) => Array.from({ length: limit }, (_, i) => opt(name, String(i)))) });
const unsplash = make('unsplash');
const pixabay = make('pixabay');
vi.mock('../../src/images/registry.js', () => ({
  configuredSources: () => [unsplash, pixabay],
  stockSource: (name: string) => ({ unsplash, pixabay })[name as 'unsplash'] ?? null,
  resolveProvider: () => null,
}));

const { searchImageOptions } = await import('../../src/images/pipeline.js');

describe('searchImageOptions', () => {
  it('only asks the configured sources, without notes about the rest', async () => {
    const r = await searchImageOptions('huerto', 'landscape');
    expect(new Set(r.options.map((o) => o.provider))).toEqual(new Set(['unsplash', 'pixabay']));
    expect(r.notes).toEqual([]);
    expect(r.source).toBeUndefined();
  });

  it('forcing a source asks only that one, for more results', async () => {
    unsplash.searchOptions.mockClear();
    const r = await searchImageOptions('huerto', 'landscape', 'pixabay');
    expect(unsplash.searchOptions).not.toHaveBeenCalled();
    expect(r.options).toHaveLength(24);
    expect(r.source).toBe('pixabay');
  });
});

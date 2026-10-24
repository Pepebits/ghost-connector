import { afterEach, describe, expect, it } from 'vitest';
import { reloadConfig } from '../../src/config.js';
import { configuredSources, stockSources } from '../../src/images/registry.js';

describe('images/registry', () => {
  afterEach(() => {
    delete process.env.IMAGE_SOURCES_ORDER;
    delete process.env.PIXABAY_API_KEY;
    reloadConfig();
  });

  it('a source missing from a saved order goes last and is used once it has a key', () => {
    process.env.IMAGE_SOURCES_ORDER = 'openverse,unsplash,pexels';
    process.env.PIXABAY_API_KEY = 'k';
    reloadConfig();
    expect(stockSources().map((s) => s.name)).toEqual(['openverse', 'unsplash', 'pexels', 'pixabay', 'wikimedia']);
    expect(configuredSources().map((s) => s.name)).toContain('pixabay');
  });
});

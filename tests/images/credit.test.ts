import { describe, expect, it } from 'vitest';
import { formatCredit } from '../../src/images/provider.js';

describe('formatCredit', () => {
  const unsplash = { provider: 'unsplash' as const, authorName: 'Ana', authorUrl: 'https://u.test/ana', providerUrl: 'https://u.test', licenseNote: 'Unsplash License', htmlCredit: 'stored' };

  it('uses the post language, not the UI one', () => {
    expect(formatCredit(unsplash, 'es')).toBe('Foto de <a href="https://u.test/ana">Ana</a> en <a href="https://u.test/">Unsplash</a>');
    expect(formatCredit(unsplash, 'en')).toBe('Photo by <a href="https://u.test/ana">Ana</a> on <a href="https://u.test/">Unsplash</a>');
  });

  it('Pixabay credit says "Image", in the post language', () => {
    const px = { provider: 'pixabay' as const, authorName: 'Leo', authorUrl: 'https://p.test/leo', providerUrl: 'https://p.test/img', licenseNote: 'Pixabay Content License', htmlCredit: 'stored' };
    expect(formatCredit(px, 'es')).toBe('Imagen de <a href="https://p.test/leo">Leo</a> en <a href="https://p.test/img">Pixabay</a>');
    expect(formatCredit(px, 'en')).toBe('Image by <a href="https://p.test/leo">Leo</a> from <a href="https://p.test/img">Pixabay</a>');
  });

  it('rebuilds Openverse TASL credits', () => {
    const ov = { provider: 'openverse' as const, authorName: 'Bob', providerUrl: 'https://f.test/p', title: 'Cat', licenseNote: 'CC BY 2.0', licenseUrl: 'https://cc.test/by', htmlCredit: 'stored' };
    expect(formatCredit(ov, 'es')).toBe('<a href="https://f.test/p">&quot;Cat&quot;</a> de Bob vía Openverse, <a href="https://cc.test/by">CC BY 2.0</a>');
  });

  it('falls back to the stored credit for older plans', () => {
    expect(formatCredit({ provider: 'openverse', licenseNote: 'CC0', htmlCredit: 'stored' }, 'es')).toBe('stored');
  });
});

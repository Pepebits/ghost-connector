import { describe, expect, it } from 'vitest';
import { internalLinksBlock, rankRelated } from '../src/research/internalLinks.js';

const posts = [
  { title: 'Qué es un vehículo definido por software (SDV)', url: 'https://blog.test/sdv/', excerpt: 'Arquitectura centralizada del coche' },
  { title: 'Receta de tortilla de patatas', url: 'https://blog.test/tortilla/', excerpt: 'Huevos y patatas' },
  { title: 'Cómo funcionan las ECUs de un coche', url: 'https://blog.test/ecus/', excerpt: 'Unidades de control electrónico del vehículo' },
];

describe('research/internalLinks', () => {
  it('ranks the posts that share words with the draft, and drops unrelated ones', () => {
    const out = rankRelated(posts, { title: 'Arquitectura de vehículos: de múltiples ECUs al SDV', text: 'El coche moderno tiene decenas de ECUs' });
    expect(out.map((p) => p.url).sort()).toEqual(['https://blog.test/ecus/', 'https://blog.test/sdv/']);
  });

  it('never suggests the post itself', () => {
    expect(rankRelated(posts, { title: 'Cómo funcionan las ECUs de un coche', text: '', url: 'https://blog.test/ecus/' }).map((p) => p.url)).not.toContain('https://blog.test/ecus/');
  });

  it('the block lists title and exact URL, one line each', () => {
    expect(internalLinksBlock([{ title: 'A\nB', url: 'https://blog.test/a/', excerpt: '' }])).toContain('- A B — https://blog.test/a/');
    expect(internalLinksBlock([])).toBe('');
  });
});

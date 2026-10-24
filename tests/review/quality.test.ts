import { describe, expect, it } from 'vitest';
import { checkQuality } from '../../src/review/quality.js';

const body = (sections: number, wordsPerSection: number) =>
  ['Entradilla sobre la copia profunda en JavaScript y por que importa.', ...Array.from({ length: sections }, (_, i) => `## Seccion ${i + 1}\n\n${'palabra '.repeat(wordsPerSection)}`)].join('\n\n');

describe('review/quality', () => {
  it('un articulo correcto saca 100', () => {
    const r = checkQuality({
      title: 'Copia profunda en JavaScript',
      markdown: body(4, 250),
      metaTitle: 'Copia profunda en JavaScript: guia',
      metaDescription: 'x'.repeat(120),
      primaryKeyword: 'copia profunda',
      hasImage: true,
    });
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.score).toBe(100);
  });

  it('detecta los fallos tipicos', () => {
    const r = checkQuality({
      title: 'Otro titulo '.repeat(8),
      markdown: '# H1 en el cuerpo\n\nTexto corto [[PENDING: ¿dato?]]',
      metaTitle: 'x'.repeat(70),
      metaDescription: 'corta',
      primaryKeyword: 'copia profunda',
      hasImage: false,
    });
    const failed = r.checks.filter((c) => !c.ok).map((c) => c.id);
    expect(failed).toEqual(['length', 'sections', 'pending', 'title-length', 'keyword-title', 'keyword-intro', 'meta-title', 'meta-description', 'image']);
    expect(r.score).toBe(0);
  });

  it('avisa de un titulo de mas de 70 caracteres', () => {
    const long = 'El impacto del cambio de arquitectura de vehículos: de múltiples ECUs al SDV';
    expect(checkQuality({ title: long, markdown: 'x', hasImage: true }).checks.find((c) => c.id === 'title-length')?.ok).toBe(false);
    expect(checkQuality({ title: long.slice(0, 70), markdown: 'x', hasImage: true }).checks.find((c) => c.id === 'title-length')?.ok).toBe(true);
  });

  it('la keyword se compara sin acentos ni mayusculas', () => {
    const r = checkQuality({ title: 'Cómo hacer una COPIA PROFUNDA', markdown: 'x', primaryKeyword: 'copia profunda', hasImage: true });
    expect(r.checks.find((c) => c.id === 'keyword-title')?.ok).toBe(true);
  });
});

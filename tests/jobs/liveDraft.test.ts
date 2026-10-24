import { describe, expect, it } from 'vitest';
import { extractPartialStringField } from '../../src/jobs/liveDraft.js';

describe('extractPartialStringField', () => {
  it('devuelve null si el campo aun no ha empezado', () => {
    expect(extractPartialStringField('{"title":"Hola","mark', 'markdown')).toBeNull();
  });

  it('devuelve el valor cortado de un campo a medias, con escapes decodificados', () => {
    const partial = '{"title":"X","markdown":"## Uno\\n\\nTexto con \\"comillas\\" y \\u00f1 y mas';
    expect(extractPartialStringField(partial, 'markdown')).toBe('## Uno\n\nTexto con "comillas" y ñ y mas');
  });

  it('se para en la comilla de cierre del campo', () => {
    expect(extractPartialStringField('{"markdown":"fin","outline":["a"', 'markdown')).toBe('fin');
  });

  it('no rompe con un escape cortado al final', () => {
    expect(extractPartialStringField('{"markdown":"abc\\', 'markdown')).toBe('abc');
    expect(extractPartialStringField('{"markdown":"abc\\u00', 'markdown')).toBe('abc');
  });
});

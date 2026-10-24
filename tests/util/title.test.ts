import { describe, expect, it } from 'vitest';
import { capitalizeTitle } from '../../src/util/title.js';

describe('util/title', () => {
  it('capitalizes the first letter, also after ¿ or quotes', () => {
    expect(capitalizeTitle('cambio de arquitectura: de múltiples ECUs al SDV')).toBe('Cambio de arquitectura: de múltiples ECUs al SDV');
    expect(capitalizeTitle('¿qué es un SDV?')).toBe('¿Qué es un SDV?');
    expect(capitalizeTitle('«ética» en la IA')).toBe('«Ética» en la IA');
  });

  it('leaves brand names and already-correct titles alone', () => {
    expect(capitalizeTitle('iPhone 17: lo nuevo')).toBe('iPhone 17: lo nuevo');
    expect(capitalizeTitle('El coche definido por software')).toBe('El coche definido por software');
  });
});

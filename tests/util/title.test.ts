import { describe, expect, it } from 'vitest';
import { capitalizeTitle } from '../../src/util/title.js';

describe('util/title', () => {
  it('pone en mayuscula la primera letra, tambien tras ¿ o comillas', () => {
    expect(capitalizeTitle('cambio de arquitectura: de múltiples ECUs al SDV')).toBe('Cambio de arquitectura: de múltiples ECUs al SDV');
    expect(capitalizeTitle('¿qué es un SDV?')).toBe('¿Qué es un SDV?');
    expect(capitalizeTitle('«ética» en la IA')).toBe('«Ética» en la IA');
  });

  it('respeta marcas y titulos ya correctos', () => {
    expect(capitalizeTitle('iPhone 17: lo nuevo')).toBe('iPhone 17: lo nuevo');
    expect(capitalizeTitle('El coche definido por software')).toBe('El coche definido por software');
  });
});

import { describe, expect, it } from 'vitest';
import { countPending, extractPendingQuestions, findPendingMarkers } from '../../src/util/pending.js';

describe('util/pending', () => {
  it('extractPendingQuestions saca el texto de la pregunta, recortado', () => {
    const text = 'Hola [[PENDING: pregunta uno]] y [[PENDING:  pregunta dos  ]]';
    expect(extractPendingQuestions(text)).toEqual(['pregunta uno', 'pregunta dos']);
  });

  it('findPendingMarkers devuelve el marcador completo', () => {
    const text = 'x [[PENDING: y]] z';
    expect(findPendingMarkers(text)).toEqual(['[[PENDING: y]]']);
  });

  it('countPending cuenta correctamente, incluido el caso sin marcadores', () => {
    expect(countPending('sin nada')).toBe(0);
    expect(countPending('[[PENDING: a]] [[PENDING: b]]')).toBe(2);
  });

  it('sigue leyendo el nombre anterior del marcador ([[PENDIENTE:]])', () => {
    expect(extractPendingQuestions('a [[PENDIENTE: vieja]] b [[PENDING: nueva]]')).toEqual(['vieja', 'nueva']);
  });
});

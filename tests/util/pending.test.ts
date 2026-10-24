import { describe, expect, it } from 'vitest';
import { countPending, extractPendingQuestions, findPendingMarkers } from '../../src/util/pending.js';

describe('util/pending', () => {
  it('extractPendingQuestions returns the trimmed question text', () => {
    const text = 'Hola [[PENDING: pregunta uno]] y [[PENDING:  pregunta dos  ]]';
    expect(extractPendingQuestions(text)).toEqual(['pregunta uno', 'pregunta dos']);
  });

  it('findPendingMarkers returns the full marker', () => {
    const text = 'x [[PENDING: y]] z';
    expect(findPendingMarkers(text)).toEqual(['[[PENDING: y]]']);
  });

  it('countPending counts correctly, including when there are no markers', () => {
    expect(countPending('sin nada')).toBe(0);
    expect(countPending('[[PENDING: a]] [[PENDING: b]]')).toBe(2);
  });

  it('still reads the old marker name ([[PENDIENTE:]])', () => {
    expect(extractPendingQuestions('a [[PENDIENTE: vieja]] b [[PENDING: nueva]]')).toEqual(['vieja', 'nueva']);
  });
});

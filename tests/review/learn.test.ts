import { describe, expect, it } from 'vitest';
import { describeCategory, promptSuggestions } from '../../src/review/learn.js';

describe('review/learn', () => {
  it('solo sugiere con evidencia suficiente y rechazo alto', () => {
    const s = promptSuggestions([
      { category: 'modified:intro', total: 6, rejected: 5 },
      { category: 'added:heading', total: 4, rejected: 4 }, // few cases
      { category: 'modified:paragraph', total: 20, rejected: 5 }, // almost all accepted
    ]);
    expect(s.map((x) => x.category)).toEqual(['modified:intro']);
    expect(s[0]!.rule).toMatch(/entradilla/);
  });

  it('describe la categoria en lenguaje natural y cae a la regla por accion', () => {
    expect(describeCategory('removed:table')).toBe('removals of tables');
    expect(promptSuggestions([{ category: 'removed:table', total: 5, rejected: 5 }])[0]!.rule).toMatch(/No elimines/);
  });
});

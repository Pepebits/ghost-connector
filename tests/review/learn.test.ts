import { describe, expect, it } from 'vitest';
import { describeCategory, promptSuggestions } from '../../src/review/learn.js';

describe('review/learn', () => {
  it('only suggests with enough evidence and a high rejection rate', () => {
    const s = promptSuggestions([
      { category: 'modified:intro', total: 6, rejected: 5 },
      { category: 'added:heading', total: 4, rejected: 4 }, // few cases
      { category: 'modified:paragraph', total: 20, rejected: 5 }, // almost all accepted
    ]);
    expect(s.map((x) => x.category)).toEqual(['modified:intro']);
    expect(s[0]!.rule).toMatch(/entradilla/);
  });

  it('describes the category in natural language and falls back to the per-action rule', () => {
    expect(describeCategory('removed:table')).toBe('removals of tables');
    expect(promptSuggestions([{ category: 'removed:table', total: 5, rejected: 5 }])[0]!.rule).toMatch(/No elimines/);
  });
});

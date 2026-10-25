import { describe, expect, it } from 'vitest';
import { activeStaff, pickedAuthors } from '../../src/ghost/staff.js';

const staff = activeStaff([
  { id: 'b', name: 'Bea', slug: 'bea', status: 'active' },
  { id: 'a', name: 'Ana', slug: 'ana', status: 'warn-1' },
  { id: 'x', name: 'Xavi', slug: 'xavi', status: 'inactive' },
  { id: 'l', name: '', slug: 'luis', status: 'locked' },
]);

describe('Ghost authors', () => {
  it('lists only staff who can be credited, by name', () => {
    expect(staff).toEqual([{ id: 'a', name: 'Ana', slug: 'ana' }, { id: 'b', name: 'Bea', slug: 'bea' }]);
  });

  it('puts the primary first, drops unknown and repeated ids', () => {
    expect(pickedAuthors({ authors: ['a', 'b', 'x', 'a'], primary: 'b' }, staff)).toEqual(['b', 'a']);
    expect(pickedAuthors({ authors: 'a' }, staff)).toEqual(['a']);
    // A primary that isn't checked doesn't count: the first checked one is.
    expect(pickedAuthors({ authors: ['b', 'a'], primary: 'x' }, staff)).toEqual(['b', 'a']);
    expect(pickedAuthors({}, staff)).toEqual([]);
  });
});

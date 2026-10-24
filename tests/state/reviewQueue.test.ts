import { describe, expect, it } from 'vitest';
import type { PostStateKind, PostSummary } from '../../src/state/postState.js';
import { nextInQueue, reviewQueue } from '../../src/state/reviewQueue.js';

const s = (id: string, kind: PostStateKind, updatedAt = '2026-01-01'): PostSummary => ({
  id, kind, updatedAt, title: id, slug: id, url: '', featureImage: null, wordCount: 0, tags: [], aiProcessed: false, pendingCount: 0, issues: [], syncedAt: '',
});

describe('state/reviewQueue', () => {
  const all = [s('a', 'applied'), s('b', 'failed'), s('c', 'planned'), s('d', 'never-planned'), s('e', 'has-pending')];

  it('solo lo que necesita decision, por prioridad', () => {
    expect(reviewQueue(all).map((x) => x.id)).toEqual(['c', 'e', 'b']);
  });

  it('siguiente de la bandeja, dando la vuelta al final', () => {
    expect(nextInQueue(all, 'c')?.id).toBe('e');
    expect(nextInQueue(all, 'b')?.id).toBe('c');
    expect(nextInQueue(all, 'a')?.id).toBe('c');
    expect(nextInQueue([s('c', 'planned')], 'c')).toBeNull();
  });
});

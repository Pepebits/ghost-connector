import type { PostStateKind, PostSummary } from './postState.js';

/**
 * "To review" inbox: what needs an editor decision, by
 * priority. First, ready plans (they only need review and apply);
 * then, whatever is stuck. Applied and unplanned posts are excluded.
 */
const PRIORITY: Partial<Record<PostStateKind, number>> = {
  planned: 1,
  'has-pending': 2,
  'plan-stale': 3,
  failed: 4,
  blocked: 5,
};

export function reviewQueue(summaries: PostSummary[]): PostSummary[] {
  return summaries
    .filter((s) => PRIORITY[s.kind] !== undefined)
    .sort((a, b) => PRIORITY[a.kind]! - PRIORITY[b.kind]! || b.updatedAt.localeCompare(a.updatedAt));
}

/** Next post in the inbox after `currentId` (or the first if it is not in it); null if none left. */
export function nextInQueue(summaries: PostSummary[], currentId: string): PostSummary | null {
  const queue = reviewQueue(summaries).filter((s) => s.id !== currentId);
  if (queue.length === 0) return null;
  const all = reviewQueue(summaries);
  const idx = all.findIndex((s) => s.id === currentId);
  if (idx === -1) return queue[0]!;
  return all[idx + 1] ?? queue[0]!;
}

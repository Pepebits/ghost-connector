import { describe, expect, it } from 'vitest';
import type { PostSummary } from '../../src/state/postState.js';
import { usersSection } from '../../src/web/views/auth.js';
import { dashboardPage } from '../../src/web/views/dashboard.js';

const summary = (over: Partial<PostSummary>): PostSummary => ({
  id: 'p1', title: 'A post', slug: 'a-post', url: 'https://example.test/a-post/', updatedAt: '2026-10-25T00:00:00Z', featureImage: null,
  wordCount: 0, tags: [], aiProcessed: false, pendingCount: 0, kind: 'planned', issues: [], syncedAt: '2026-10-25T00:00:00Z', ...over,
});
const dash = (s: PostSummary[]) =>
  dashboardPage({ summaries: s, ghostUrl: 'https://example.test', draftFilter: 'status:draft', syncedAt: null, quotas: [], gone: [], cost: { totalUsd: 0, last24hUsd: 0, runCount: 0, totalTokensIn: 0, totalTokensOut: 0 } } as never);

describe('views', () => {
  it('the words column shows Ghost and the unapplied plan when they differ', () => {
    expect(dash([summary({ wordCount: 0, plannedWords: 1263 })])).toMatch(/0 <span aria-hidden="true">→<\/span>.*1263/s);
    const plain = dash([summary({ wordCount: 836 })]);
    expect(plain).toContain('>836</td>');
    expect(plain).not.toContain('→</span>');
  });

  it("each user's actions sit behind one gear menu, and admins can't touch the owner", () => {
    const users = [
      { id: 1, username: 'ana', role: 'owner' as const, totp: true, createdAt: '', sessions: 1, lastSeen: null },
      { id: 2, username: 'luis', role: 'editor' as const, totp: false, createdAt: '', sessions: 0, lastSeen: null },
    ];
    const asOwner = usersSection({ me: { id: 1, username: 'ana', role: 'owner' }, users, invites: [] });
    expect(asOwner.match(/<details class="user-menu[^"]*" data-menu>/g)).toHaveLength(1);
    expect(asOwner).toContain('Actions for luis');
    expect(asOwner).not.toContain('btn btn-ghost btn-sm text-err');
    const asAdmin = usersSection({ me: { id: 3, username: 'eva', role: 'admin' }, users, invites: [] });
    expect(asAdmin).not.toContain('Actions for ana');
  });
});

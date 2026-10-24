import { getConfig } from '../config.js';
import { toDraftSnapshot, type DraftSnapshot, type RawGhostPost } from '../types.js';
import { ghostLimiter } from '../util/limiter.js';
import { withRetry } from '../util/retry.js';
import { ghostApi } from './client.js';
import { draftsOnly } from './draftFilter.js';

interface BrowseOpts {
  filter?: string;
  limit?: number;
}

/** Lists drafts, paginating until `meta.pagination.pages` (or `limit`) is exhausted. Reads: retryable. */
export async function listDrafts(opts: BrowseOpts = {}): Promise<DraftSnapshot[]> {
  const cfg = getConfig();
  // Always drafts only, even if the configured filter doesn't include status:draft.
  const filter = draftsOnly(opts.filter ?? cfg.DRAFT_FILTER);
  const pageSize = 50;
  const results: DraftSnapshot[] = [];
  let page = 1;

  for (;;) {
    const batch = (await ghostLimiter(() =>
      withRetry(() =>
        ghostApi().posts.browse({
          filter,
          formats: 'html,lexical',
          include: 'tags,authors',
          limit: pageSize,
          page,
          order: 'updated_at DESC',
        }),
      ),
    )) as unknown as RawGhostPost[] & { meta?: { pagination?: { pages: number } } };

    for (const raw of batch) {
      results.push(toDraftSnapshot(raw));
      if (opts.limit && results.length >= opts.limit) return results;
    }

    const totalPages = batch.meta?.pagination?.pages ?? page;
    if (page >= totalPages || batch.length === 0) break;
    page += 1;
  }

  return results;
}

export async function readDraft(id: string): Promise<DraftSnapshot> {
  const raw = await readRawPost(id);
  return toDraftSnapshot(raw);
}

/** Read without requiring status:draft. Used by write-back to check `updated_at`/`status` before the PUT. */
export async function readRawPost(id: string): Promise<RawGhostPost> {
  return ghostLimiter(() =>
    withRetry(() => ghostApi().posts.read({ id }, { formats: 'html,lexical' })),
  ) as unknown as Promise<RawGhostPost>;
}

export interface CreateDraftInput {
  title: string;
  html: string;
  tags: string[];
}

/**
 * Creates a new draft from HTML. Used by scripts/seed-test-post.ts.
 * No retry: a POST isn't idempotent; retrying it after a timeout could
 * create a duplicate post.
 */
export async function createDraft(input: CreateDraftInput): Promise<DraftSnapshot> {
  const raw = (await ghostLimiter(() =>
    ghostApi().posts.add({ title: input.title, html: input.html, tags: input.tags, status: 'draft' }, { source: 'html' }),
  )) as unknown as RawGhostPost;
  return toDraftSnapshot(raw);
}

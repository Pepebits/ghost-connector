import { backfillInferredApplied, listPostsLive, plannedTitles, upsertPostLive } from '../db/repo.js';
import { listDrafts, readDraft } from '../ghost/posts.js';
import { AI_PROCESSED_TAG } from '../orchestrator/merge.js';
import { findLatestArtifact, findLatestArtifactsByPost } from '../review/store.js';
import type { DraftSnapshot, RunArtifact } from '../types.js';
import { extractPendingQuestions } from '../util/pending.js';
import type { PostIssue } from './issues.js';
import { t } from '../i18n/index.js';

export type PostStateKind =
  | 'never-planned' // draft in Ghost, with no local artifact nor processed tag
  | 'planned' // there is a current plan (updated_at matches), not applied yet
  | 'plan-stale' // there is a plan, but the post changed in Ghost since then: applying would conflict
  | 'applied' // applied with no open issues
  | 'applied-degraded' // applied but something in the last run had errors (SEO/image)
  | 'has-pending' // the LIVE content in Ghost still has [[PENDING:]]
  | 'blocked' // the last apply attempt aborted (sanity guard, pending markers, conflict)
  | 'failed'; // the writer failed or the last PUT failed

export interface PostStateLatestRun {
  runId: string;
  createdAt: string;
  status: RunArtifact['status'];
  costUsd: number;
  wordsBefore: number;
  wordsAfter: number;
  pendingCount: number;
  extraInstructions?: string;
}

export interface PostState {
  post: {
    id: string;
    title: string;
    slug: string;
    url: string;
    updatedAt: string;
    featureImage: string | null;
    wordCount: number;
    tags: string[];
    aiProcessed: boolean;
  };
  live: { pendingQuestions: string[] };
  latestRun: PostStateLatestRun | null;
  kind: PostStateKind;
  issues: PostIssue[];
  actions: { canPlan: boolean; canApply: boolean; canResolve: boolean };
  syncedAt: string;
}

function wordCount(html: string | null): number {
  return (html ?? '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
}

function deriveKind(live: DraftSnapshot, latestRun: RunArtifact | null, pendingLive: string[], aiProcessed: boolean): PostStateKind {
  if (!latestRun) return aiProcessed ? 'applied' : 'never-planned';
  // Apply undone: the post is back to what it was before planning.
  if (latestRun.restoredAt) return 'never-planned';

  if (latestRun.status === 'failed') return 'failed';
  if (latestRun.status === 'conflict' || latestRun.status === 'skipped') return 'blocked';
  if (latestRun.status === 'planned') {
    return live.updated_at !== latestRun.snapshot.updated_at ? 'plan-stale' : 'planned';
  }
  // status === 'applied'
  if (pendingLive.length > 0) return 'has-pending';
  if (latestRun.errors.length > 0) return 'applied-degraded';
  return 'applied';
}

function deriveIssues(live: DraftSnapshot, latestRun: RunArtifact | null, pendingLive: string[]): PostIssue[] {
  const issues: PostIssue[] = [];

  if (latestRun) {
    for (const e of latestRun.errors) {
      issues.push({ severity: 'warning', code: `agent-error-${e.stage}`, message: t('issues.agentError', { stage: e.stage, message: e.message }) });
    }
    if (latestRun.status === 'planned' && live.updated_at !== latestRun.snapshot.updated_at) {
      issues.push({
        severity: 'warning',
        code: 'plan-stale',
        message: t('issues.planStale'),
        suggestedAction: t('issues.planStaleAction'),
      });
    }
    if (latestRun.status === 'conflict' || latestRun.status === 'skipped' || latestRun.status === 'failed') {
      issues.push({
        severity: latestRun.status === 'failed' ? 'error' : 'warning',
        code: `apply-${latestRun.status}`,
        message: t('issues.applyStatus', { status: latestRun.status }),
        suggestedAction: t('issues.applyStatusAction'),
      });
    }
  }

  if (pendingLive.length > 0) {
    issues.push({
      severity: 'info',
      code: 'has-pending',
      message: t('issues.hasPending', { count: pendingLive.length }),
      suggestedAction: t('issues.hasPendingAction'),
    });
  }

  return issues;
}

export function computePostState(live: DraftSnapshot, latestRun: RunArtifact | null): PostState {
  const pendingLive = extractPendingQuestions(live.html ?? '');
  const tags = live.tags.map((t) => t.name);
  const aiProcessed = tags.some((t) => t.toLowerCase() === AI_PROCESSED_TAG.toLowerCase());
  const kind = deriveKind(live, latestRun, pendingLive, aiProcessed);
  const issues = deriveIssues(live, latestRun, pendingLive);

  // Backfill: if it is applied per the tag but we have NO local
  // artifact (applied before M9/M10, or .runs/ was lost), leave a
  // synthetic record instead of a silent gap.
  if (!latestRun && aiProcessed) {
    backfillInferredApplied(live.id, live.title);
  }

  upsertPostLive({
    post_id: live.id,
    title: live.title,
    slug: live.slug,
    url: live.url,
    updated_at: live.updated_at,
    feature_image: live.feature_image,
    pending_count: pendingLive.length,
    word_count: wordCount(live.html),
    tags_json: JSON.stringify(tags),
    ai_processed: aiProcessed ? 1 : 0,
    kind,
    issues_json: JSON.stringify(issues),
    synced_at: new Date().toISOString(),
  });

  return {
    post: {
      id: live.id,
      title: live.title,
      slug: live.slug,
      url: live.url,
      updatedAt: live.updated_at,
      featureImage: live.feature_image,
      wordCount: wordCount(live.html),
      tags,
      aiProcessed,
    },
    live: { pendingQuestions: pendingLive },
    latestRun:
      latestRun && latestRun.writer
        ? {
            runId: latestRun.runId,
            createdAt: latestRun.createdAt,
            status: latestRun.status,
            costUsd: latestRun.cost.usd,
            wordsBefore: wordCount(latestRun.snapshot.html),
            wordsAfter: wordCount(latestRun.writer.markdown),
            pendingCount: extractPendingQuestions(latestRun.writer.markdown).length,
            extraInstructions: latestRun.extraInstructions,
          }
        : null,
    kind,
    issues,
    actions: {
      canPlan: true,
      canApply: latestRun?.status === 'planned',
      canResolve: pendingLive.length > 0,
    },
    syncedAt: new Date().toISOString(),
  };
}

export interface PostSummary {
  id: string;
  title: string;
  slug: string;
  url: string;
  updatedAt: string;
  featureImage: string | null;
  wordCount: number;
  tags: string[];
  aiProcessed: boolean;
  pendingCount: number;
  kind: PostStateKind;
  issues: PostIssue[];
  syncedAt: string;
  /** Title proposed by the unapplied plan, when it differs from the one in Ghost. */
  plannedTitle?: string;
}

/**
 * Network-FREE read from the SQLite index (posts_live), populated by the
 * last `syncPostStates()`. Does not have the text of pending questions
 * (only the count) nor the detail of the last run -- that needs the
 * full JSON via review/store.ts. Meant for fast listing/filtering.
 */
export function readPostSummaries(opts: { kind?: PostStateKind } = {}): PostSummary[] {
  const planned = plannedTitles();
  return listPostsLive()
    .filter((r) => !opts.kind || r.kind === opts.kind)
    .map((r) => ({
      ...(planned.has(r.post_id) && planned.get(r.post_id) !== r.title ? { plannedTitle: planned.get(r.post_id)! } : {}),
      id: r.post_id,
      title: r.title,
      slug: r.slug,
      url: r.url,
      updatedAt: r.updated_at,
      featureImage: r.feature_image,
      wordCount: r.word_count,
      tags: JSON.parse(r.tags_json) as string[],
      aiProcessed: !!r.ai_processed,
      pendingCount: r.pending_count,
      kind: r.kind as PostStateKind,
      issues: JSON.parse(r.issues_json) as PostIssue[],
      syncedAt: r.synced_at,
    }));
}

/**
 * Re-reads Ghost (one or several posts) and matches each against its latest local
 * plan. Along the way it repopulates the index (posts_live) so readPostSummaries()
 * stays up to date. It is the only path that touches the network.
 */
export async function syncPostStates(opts: { filter?: string; postIds?: string[] } = {}): Promise<PostState[]> {
  if (opts.postIds && opts.postIds.length > 0) {
    return Promise.all(
      opts.postIds.map(async (id) => {
        const live = await readDraft(id);
        const latestRun = await findLatestArtifact(id);
        return computePostState(live, latestRun);
      }),
    );
  }

  const lives = await listDrafts({ filter: opts.filter });
  const latestByPost = await findLatestArtifactsByPost();
  return lives.map((live) => computePostState(live, latestByPost.get(live.id) ?? null));
}

/** State of a single post, always re-reading Ghost. */
export async function syncPostState(postId: string): Promise<PostState> {
  const live = await readDraft(postId);
  const latestRun = await findLatestArtifact(postId);
  return computePostState(live, latestRun);
}

import type { WriterMode } from '../agents/writer.agent.js';
import { randomUUID } from 'node:crypto';
import pLimit from 'p-limit';
import { getConfig } from '../config.js';
import { createJob, incrementJobDone, setJobState, setJobTotal, touchJob, type JobState } from '../db/jobs.js';
import { deletePostLive, listPostsLive, upsertPostGone } from '../db/repo.js';
import { listDrafts, readDraft, readRawPost } from '../ghost/posts.js';
import { assertBudget } from '../agents/budget.js';
import { processDraft } from '../orchestrator/pipeline.js';
import { applyArtifact } from '../orchestrator/writeback.js';
import { findLatestArtifact, findLatestArtifactsByPost, newRunId, saveArtifact } from '../review/store.js';
import { computePostState } from '../state/postState.js';
import { emitJobEvent } from './events.js';
import { extractPartialStringField, finishLiveDraft, setLiveDraft } from './liveDraft.js';

interface RunningJobHandle {
  cancelRequested: boolean;
}

// A single in-memory map for the CURRENT process: if the server restarts, it is
// lost (that is why `interruptOrphanedJobs()` marks orphaned "running" jobs on
// startup instead of trying to blindly resurrect them).
const running = new Map<string, RunningJobHandle>();

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface PlanJobParams {
  postIds: string[];
  extraInstructions?: string;
  mode?: WriterMode;
}

/** Enqueues and starts a `plan` job in the background. Returns the id immediately, does not wait for it to finish. */
export function enqueuePlanJob(params: PlanJobParams): string {
  const id = randomUUID();
  createJob({ id, type: 'plan', params, total: params.postIds.length });
  void runPlanJob(id, params);
  return id;
}

export function isJobRunning(jobId: string): boolean {
  return running.has(jobId);
}

/** Cooperative cancellation: does not interrupt an in-flight HTTP call, only prevents more posts from starting. */
export function cancelJob(jobId: string): boolean {
  const handle = running.get(jobId);
  if (!handle) return false;
  handle.cancelRequested = true;
  setJobState(jobId, 'cancelling');
  emitJobEvent(jobId, 'info', 'Cancellation requested: stops after the current post, the rest will not start.');
  return true;
}

async function runPlanJob(jobId: string, params: PlanJobParams): Promise<void> {
  const handle: RunningJobHandle = { cancelRequested: false };
  running.set(jobId, handle);
  setJobState(jobId, 'running');
  emitJobEvent(jobId, 'info', `Starting plan on ${params.postIds.length} post(s).`);

  const cfg = getConfig();
  const limit = pLimit(cfg.CONCURRENCY);
  const runId = newRunId();
  // Heartbeat: tells "working" apart from "stuck for hours" in the UI even with no new events.
  const heartbeat = setInterval(() => touchJob(jobId), 10_000);

  const tasks = params.postIds.map((postId) =>
    limit(async () => {
      if (handle.cancelRequested) {
        emitJobEvent(jobId, 'info', `Skipped ${postId} (cancellation in progress).`, { postId });
        return;
      }
      try {
        assertBudget();
      } catch (err) {
        emitJobEvent(jobId, 'warn', `Skipped ${postId}: ${errMsg(err)}`, { postId });
        incrementJobDone(jobId);
        return;
      }
      try {
        const draft = await readDraft(postId);
        emitJobEvent(jobId, 'info', `Procesando "${draft.title}"...`, { postId });
        // Each post persists its own artifact as soon as it finishes (same
        // as the CLI): if the process dies midway, what is done stays done.
        let lastPush = 0;
        const artifact = await processDraft(runId, draft, {
          extraInstructions: params.extraInstructions,
          mode: params.mode,
          onWriterPartial: (partial) => {
            // Throttle: parsing the partial JSON on every token adds nothing to a UI that polls every ~1s.
            const now = Date.now();
            if (now - lastPush < 300) return;
            lastPush = now;
            const markdown = extractPartialStringField(partial, 'markdown');
            if (markdown !== null) setLiveDraft(postId, jobId, markdown);
          },
        });
        await saveArtifact(artifact);
        emitJobEvent(
          jobId,
          artifact.status === 'failed' ? 'warn' : 'info',
          `"${draft.title}": ${artifact.status} ($${artifact.cost.usd.toFixed(5)}${artifact.cost.unpricedModels?.length ? ', no price for ' + artifact.cost.unpricedModels.join(', ') : ''})`,
          { postId, status: artifact.status },
        );
      } catch (err) {
        emitJobEvent(jobId, 'error', `Failed processing ${postId}: ${errMsg(err)}`, { postId });
      } finally {
        finishLiveDraft(postId);
        incrementJobDone(jobId);
      }
    }),
  );

  await Promise.all(tasks);
  clearInterval(heartbeat);

  const wasCancelled = handle.cancelRequested;
  running.delete(jobId);

  const finalState: JobState = wasCancelled ? 'cancelled' : 'done';
  setJobState(jobId, finalState, { resultJson: JSON.stringify({ runId }) });
  emitJobEvent(jobId, 'info', wasCancelled ? 'Job cancelled.' : `Job finished. Run: ${runId}`, { runId });
}

export interface ApplyJobParams {
  postIds: string[];
  allowPending?: boolean;
  forceSanity?: boolean;
  allowUnknownLinks?: boolean;
}

/**
 * Unlike plan, each post uses its OWN latest "planned" artifact
 * (not a shared runId): each one may have been planned at a
 * different time. Writes are serialized (pLimit(1)) -- there is no reason
 * to write two posts at once, and it avoids mixing updated_at guards.
 */
export function enqueueApplyJob(params: ApplyJobParams): string {
  const id = randomUUID();
  createJob({ id, type: 'apply', params, total: params.postIds.length });
  void runApplyJob(id, params);
  return id;
}

async function runApplyJob(jobId: string, params: ApplyJobParams): Promise<void> {
  const handle: RunningJobHandle = { cancelRequested: false };
  running.set(jobId, handle);
  setJobState(jobId, 'running');
  emitJobEvent(jobId, 'info', `Starting apply on ${params.postIds.length} post(s).`);

  const limit = pLimit(1);
  const heartbeat = setInterval(() => touchJob(jobId), 10_000);

  const tasks = params.postIds.map((postId) =>
    limit(async () => {
      if (handle.cancelRequested) {
        emitJobEvent(jobId, 'info', `Skipped ${postId} (cancellation in progress).`, { postId });
        return;
      }
      try {
        const artifact = await findLatestArtifact(postId);
        if (!artifact || artifact.status !== 'planned') {
          emitJobEvent(jobId, 'warn', `${postId}: no current ("planned") plan to apply.`, { postId });
          return;
        }
        const result = await applyArtifact(artifact, { allowPending: params.allowPending, forceSanity: params.forceSanity, allowUnknownLinks: params.allowUnknownLinks });
        emitJobEvent(
          jobId,
          result.status === 'applied' ? 'info' : 'warn',
          `"${artifact.postTitle}": ${result.status} (${result.reasonCode})`,
          { postId, ...result },
        );
      } catch (err) {
        emitJobEvent(jobId, 'error', `Failed applying ${postId}: ${errMsg(err)}`, { postId });
      } finally {
        incrementJobDone(jobId);
      }
    }),
  );

  await Promise.all(tasks);
  clearInterval(heartbeat);

  const wasCancelled = handle.cancelRequested;
  running.delete(jobId);
  setJobState(jobId, wasCancelled ? 'cancelled' : 'done');
  emitJobEvent(jobId, 'info', wasCancelled ? 'Job cancelled.' : 'Job finished.');
}

export interface SyncJobParams {
  filter?: string;
}

export function enqueueSyncJob(params: SyncJobParams): string {
  const id = randomUUID();
  createJob({ id, type: 'sync', params, total: 0 }); // the real total is only known after listing
  void runSyncJob(id, params);
  return id;
}

/**
 * Re-reads Ghost and updates posts_live for each draft. It also detects
 * posts that LEFT the filter since the last sync (published manually,
 * deleted, etc.): they do not vanish silently, they move to posts_gone.
 */
async function runSyncJob(jobId: string, params: SyncJobParams): Promise<void> {
  const handle: RunningJobHandle = { cancelRequested: false };
  running.set(jobId, handle);
  setJobState(jobId, 'running');
  emitJobEvent(jobId, 'info', 'Listing drafts in Ghost...');

  try {
    const previousIds = new Set(listPostsLive().map((r) => r.post_id));
    const lives = await listDrafts({ filter: params.filter });
    setJobTotal(jobId, lives.length);
    emitJobEvent(jobId, 'info', `${lives.length} draft(s) found. Syncing state...`);

    const latestByPost = await findLatestArtifactsByPost();
    const newIds = new Set<string>();

    for (const live of lives) {
      if (handle.cancelRequested) {
        emitJobEvent(jobId, 'info', 'Sync cancelled midway.');
        break;
      }
      newIds.add(live.id);
      const state = computePostState(live, latestByPost.get(live.id) ?? null);
      emitJobEvent(jobId, 'info', `"${live.title}": ${state.kind}`, { postId: live.id, kind: state.kind });
      incrementJobDone(jobId);
    }

    if (!handle.cancelRequested) {
      const missing = [...previousIds].filter((id) => !newIds.has(id));
      for (const postId of missing) {
        try {
          const raw = await readRawPost(postId);
          if (raw.status === 'draft') {
            // Still a real draft: it just does not match the
            // filter of THIS sync (e.g. if DRAFT_FILTER was changed to something
            // narrower). Not a "lost" post, just outside the
            // current view -- it is not marked as gone nor removed from posts_live,
            // so its state is not lost the next time the filter is widened.
            continue;
          }
          upsertPostGone({ post_id: postId, title: raw.title, last_status: raw.status, detected_at: new Date().toISOString() });
          deletePostLive(postId);
          emitJobEvent(jobId, 'warn', `"${raw.title}" left "draft" (status=${raw.status}). Moved to "out of scope".`, { postId });
        } catch {
          // the post may have been fully deleted in Ghost; left as is, not a reason to fail the sync
        }
      }
    }

    running.delete(jobId);
    setJobState(jobId, handle.cancelRequested ? 'cancelled' : 'done');
    emitJobEvent(jobId, 'info', handle.cancelRequested ? 'Sync cancelled.' : 'Sync finished.');
  } catch (err) {
    running.delete(jobId);
    setJobState(jobId, 'error', { error: errMsg(err) });
    emitJobEvent(jobId, 'error', `Sync failed: ${errMsg(err)}`);
  }
}

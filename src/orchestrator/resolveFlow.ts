import { resolvePending, type PendingQA } from '../agents/resolve.agent.js';
import { addUsage } from '../agents/costAdd.js';
import type { AgentUsage } from '../agents/runner.js';
import { recordResolveAttempt } from '../db/repo.js';
import { ghostApi } from '../ghost/client.js';
import { readRawPost } from '../ghost/posts.js';
import { acquireWriteLock } from '../util/lock.js';
import { markdownToHtml } from '../util/markdown.js';
import { extractPendingQuestions } from '../util/pending.js';
import { readSources, sourcesBlock } from '../research/sources.js';
import { saveArtifact } from '../review/store.js';
import type { RunArtifact } from '../types.js';
import { editPlannedArtifact } from './editPlan.js';
import { extractLinks } from '../review/links.js';

export interface PreviewResolveResult {
  title: string;
  questions: string[];
  markdown: string;
  html: string;
  unresolved: string[];
  changesMade: string[];
  usage: AgentUsage;
  /** updated_at read right before calling the agent; use it in commitResolve() for the conflict guard. */
  snapshotUpdatedAt: string;
}

/**
 * Reads the post LIVE from Ghost, extracts its [[PENDING:]] questions, and calls
 * the ResolverAgent with the given answers. Writes nothing to Ghost.
 * Used by both `resolve --dry-run` and the UI form.
 */
export async function previewResolve(postId: string, qas: PendingQA[]): Promise<PreviewResolveResult> {
  const fresh = await readRawPost(postId);
  const html = fresh.html ?? '';
  const questions = extractPendingQuestions(html);

  const sources = await readSources(qas.map((qa) => qa.answer).join('\n'));
  const { data, usage } = await resolvePending({ title: fresh.title, html, qas, sources: sourcesBlock(sources) || undefined });
  const newHtml = markdownToHtml(data.markdown);

  return {
    title: fresh.title,
    questions,
    markdown: data.markdown,
    html: newHtml,
    unresolved: data.unresolved,
    changesMade: data.changes_made,
    usage,
    snapshotUpdatedAt: fresh.updated_at,
  };
}

export type CommitResolveStatus = 'applied' | 'conflict' | 'not-draft' | 'failed';

export interface CommitResolveResult {
  status: CommitResolveStatus;
  message: string;
}

export interface CommitResolveCounts {
  answered: number;
  unresolved: number;
}

/**
 * Writes the already-resolved HTML (from previewResolve) to Ghost, with the same
 * updated_at conflict guard as the plan/apply write-back.
 * `counts` is only for the resolve_attempts record (local index).
 */
export async function commitResolve(
  postId: string,
  html: string,
  expectedUpdatedAt: string,
  counts: CommitResolveCounts = { answered: 0, unresolved: 0 },
): Promise<CommitResolveResult> {
  const fresh = await readRawPost(postId);
  if (fresh.status !== 'draft') {
    const outcome = { status: 'not-draft' as const, message: `The post is no longer a draft (status=${fresh.status}).` };
    recordResolveAttempt({ postId, ...counts, result: outcome.status, message: outcome.message });
    return outcome;
  }
  if (fresh.updated_at !== expectedUpdatedAt) {
    const outcome = {
      status: 'conflict' as const,
      message: `The post changed in Ghost while resolving (updated_at ${expectedUpdatedAt} -> ${fresh.updated_at}). Try again.`,
    };
    recordResolveAttempt({ postId, ...counts, result: outcome.status, message: outcome.message });
    return outcome;
  }

  let releaseLock: (() => void) | null = null;
  try {
    releaseLock = acquireWriteLock(`resolve:${postId}`);
  } catch (err) {
    const outcome = { status: 'failed' as const, message: err instanceof Error ? err.message : String(err) };
    recordResolveAttempt({ postId, ...counts, result: outcome.status, message: outcome.message });
    return outcome;
  }

  try {
    await ghostApi().posts.edit(
      { id: postId, html, updated_at: fresh.updated_at, status: 'draft' },
      { source: 'html', save_revision: true },
    );
  } catch (err) {
    const outcome = { status: 'failed' as const, message: err instanceof Error ? err.message : String(err) };
    recordResolveAttempt({ postId, ...counts, result: outcome.status, message: outcome.message });
    return outcome;
  } finally {
    releaseLock();
  }

  const outcome = { status: 'applied' as const, message: 'OK' };
  recordResolveAttempt({ postId, ...counts, result: outcome.status, message: outcome.message });
  return outcome;
}

export interface ResolvePlanResult {
  artifact: RunArtifact;
  unresolved: string[];
  changesMade: string[];
}

/**
 * Answers the [[PENDING:]] of a plan NOT YET APPLIED: the resolver
 * rewrites those parts of the plan's text and the plan is saved (as a
 * manual edit), without touching Ghost. If the answers include URLs, they're read
 * first. Then it's reviewed and applied like any plan.
 */
/** An already-given answer the editor changes (original question, new answer). */
export interface AnswerCorrection {
  question: string;
  answer: string;
}

export async function resolvePlan(artifact: RunArtifact, qas: PendingQA[], fixes: AnswerCorrection[] = []): Promise<ResolvePlanResult> {
  if (artifact.status !== 'planned' || !artifact.writer) throw new Error('Pending items can only be resolved on a current ("planned") plan.');
  const previous = new Map((artifact.answers ?? []).map((a) => [a.question, a.answer]));
  const corrections = fixes
    .filter((f) => f.answer.trim() && previous.has(f.question) && previous.get(f.question) !== f.answer.trim())
    .map((f) => ({ question: f.question, previous: previous.get(f.question)!, answer: f.answer.trim() }));
  const sources = await readSources([...qas.map((qa) => qa.answer), ...corrections.map((c) => c.answer)].join('\n'));
  const { data, usage } = await resolvePending({
    title: artifact.writer.title,
    language: artifact.writer.language,
    html: markdownToHtml(artifact.writer.markdown),
    qas,
    corrections,
    sources: sourcesBlock(sources) || undefined,
  });
  // History: the latest answer to each question, so it can be corrected in the next round.
  const at = new Date().toISOString();
  const answered = [...qas.filter((qa) => qa.answer.trim()), ...corrections].map((x) => ({ question: x.question, answer: x.answer.trim(), at }));
  const answers = [...(artifact.answers ?? []).filter((a) => !answered.some((n) => n.question === a.question)), ...answered];
  const edited = await editPlannedArtifact(artifact, { title: artifact.writer.title, markdown: data.markdown });
  // What the editor answers (and the pages it links) becomes a known source for the link check.
  const answerLinks = [...qas.map((qa) => qa.answer), ...corrections.map((c) => c.answer)].flatMap((t) => extractLinks(t));
  const newLinks = [...answerLinks, ...sources.flatMap((r) => (r.ok ? [r.url, ...r.links] : [r.url]))];
  const updated: RunArtifact = {
    ...edited,
    answers,
    ...(newLinks.length ? { allowedLinks: [...new Set([...(edited.allowedLinks ?? []), ...newLinks])] } : {}),
    ...(sources.length
      ? { sources: [...(edited.sources ?? []), ...sources.map((r) => ({ url: r.url, ok: r.ok, ...(r.ok ? {} : { note: r.text }), ...(r.suspicious ? { suspicious: true } : {}) }))] }
      : {}),
    cost: addUsage(edited.cost, usage, 'resolve'),
  };
  await saveArtifact(updated);
  return { artifact: updated, unresolved: data.unresolved, changesMade: data.changes_made };
}

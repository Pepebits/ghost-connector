import type { ApplyAttemptRow } from '../../db/repo.js';
import { renderDiff } from '../../review/diff.js';
import type { PostState } from '../../state/postState.js';
import type { RunArtifact } from '../../types.js';
import { uniquePendingQuestions } from '../../util/pending.js';
import { badge } from './badge.js';
import { formatTokens, formatUsd, formatRunCost } from './format.js';
import { t } from '../../i18n/index.js';
import { html, raw } from '../html.js';
import { layout } from './layout.js';
import { renderGhostPreview, renderWriterPreview } from './preview.js';
import { reviewTab } from './review.js';
import { imageTab } from './imageTab.js';
import type { ImageWork } from '../../orchestrator/imageChoice.js';
import { qualityPanelFor } from './quality.js';
import { sharePreview } from './sharePreview.js';
import { confirmDialog, flash, pageHeader, timeTag } from './ui.js';
import { canRestore } from '../../orchestrator/restore.js';
import { notesLabel, notesTab, presenceBanner, teamStrip, type PostTeam } from './team.js';

export interface DetailOpts {
  state: PostState;
  latestArtifact: RunArtifact | null;
  applyHistory: ApplyAttemptRow[];
  detectedMode: 'draft' | 'improve';
  imageOnly?: ImageWork | null;
  ghostAdminUrl: string;
  saved?: boolean;
  /** After completing a plan's pending items: how many were left unanswered. */
  resolved?: { unresolved: number };
  /** Back from "Fix with AI". */
  fixed?: boolean;
  /** Back from "Undo the last apply". */
  restored?: boolean;
  /** Assignment, notes and who else has it open. */
  team?: PostTeam;
}

// One key per detail tab (see palette.js)
const TAB_SHORTCUTS: Record<string, string> = { 'plan-preview': 'v', revisar: 'r', editar: 'e', planificar: 'p', historial: 'h' };

const NEXT = 'card my-4 flex flex-wrap items-center justify-between gap-4 border-l-4 px-4 py-3.5';

/** Label for a history code; if there's no translation, the code as-is. */
function codeLabel(group: 'result' | 'reason' | 'imageResult', code: string): string {
  const key = `post.history.${group}.${code}`;
  const label = t(key);
  return label === key ? code : label;
}

function words(markdown: string): number {
  return markdown.split(/\s+/).filter(Boolean).length;
}

/** An editable/applicable plan: the latest artifact, "planned" and with text. */
function currentPlan(opts: DetailOpts): RunArtifact | null {
  const a = opts.latestArtifact;
  return a && a.status === 'planned' && a.writer ? a : null;
}

function applyButton(postId: string, label = t('post.apply.button')): string {
  return html`<form method="post" action="/posts/${postId}/apply/precheck" class="inline" data-busy="${t('post.apply.busy')}">
    <button type="submit" class="btn">${label}</button>
  </form>`;
}

/** Button that leads to a tab. The main step in each case is primary; the rest, ghost. */
function tabLink(tab: string, label: string, primary = false): string {
  return html`<a href="#${tab}" class="${primary ? 'btn' : 'btn btn-ghost'}" data-tab-link="${tab}">${label}</a>`;
}

/**
 * The first thing shown: where the post stands and what the next
 * step is, with its button. Replaces having to go through every section
 * to guess what to do next.
 */
function nextStep(opts: DetailOpts): string {
  const { state } = opts;
  const plan = currentPlan(opts);
  const id = state.post.id;

  if (state.kind === 'plan-stale') {
    return html`<div class="${NEXT} border-l-warn">
      <div><strong>${t('post.next.staleTitle')}</strong> ${t('post.next.staleBody')}</div>
      <div class="flex flex-wrap gap-2">${raw(tabLink('planificar', t('post.next.replan'), true))}</div>
    </div>`;
  }
  if (plan) {
    const pending = uniquePendingQuestions(plan.writer!.markdown).length;
    if (pending > 0) {
      return html`<div class="${NEXT} border-l-warn">
        <div><strong>${t('post.next.questionsTitle', { count: pending })}</strong> ${t('post.next.questionsBody', { count: pending })}</div>
        <div class="flex flex-wrap gap-2">${raw(tabLink('pendientes', t('post.next.answer'), true))} ${raw(tabLink('revisar', t('post.next.reviewChanges')))}</div>
      </div>`;
    }
    return html`<div class="${NEXT} border-l-ok">
      <div><strong>${t('post.next.readyTitle')}</strong> ${t('post.next.readyBody')}${raw(imageUndecided(opts) ? t('post.next.imageMissing') : '')}</div>
      <div class="flex flex-wrap gap-2">${raw(tabLink('revisar', t('post.next.reviewChanges')))} ${raw(imageUndecided(opts) ? tabLink('imagen', t('post.next.chooseImage')) : '')} ${raw(tabLink('editar', t('post.next.editText')))} ${raw(applyButton(id))}</div>
    </div>`;
  }
  if (state.live.pendingQuestions.length > 0) {
    return html`<div class="${NEXT} border-l-warn">
      <div><strong>${t('post.next.liveTitle', { count: state.live.pendingQuestions.length })}</strong> ${t('post.next.liveBody', { count: state.live.pendingQuestions.length })}</div>
      <div class="flex flex-wrap gap-2">${raw(tabLink('pendientes', t('post.next.resolvePending'), true))}</div>
    </div>`;
  }
  if (state.kind === 'failed' || state.kind === 'blocked') {
    return html`<div class="${NEXT} border-l-err">
      <div><strong>${t('post.next.failedTitle')}</strong> ${t('post.next.failedBody')}</div>
      <div class="flex flex-wrap gap-2">${raw(tabLink('historial', t('post.next.viewHistory')))} ${raw(tabLink('planificar', t('post.next.plan'), true))}</div>
    </div>`;
  }
  if (state.kind === 'applied' || state.kind === 'applied-degraded') {
    return html`<div class="${NEXT} border-l-accent">
      <div><strong>${t('post.next.appliedTitle')}</strong> ${t('post.next.appliedBody')}</div>
      <div class="flex flex-wrap gap-2">
        <a class="btn btn-ghost" href="${opts.ghostAdminUrl}" target="_blank" rel="noopener noreferrer">${t('post.next.openInGhost')}</a>
        ${raw(tabLink('planificar', t('post.next.improveAgain')))}
      </div>
    </div>`;
  }
  return html`<div class="${NEXT} border-l-accent">
    <div><strong>${t('post.next.neverTitle')}</strong> ${t('post.next.neverBody')}</div>
    <div class="flex flex-wrap gap-2">${raw(tabLink('planificar', t('post.next.plan'), true))}</div>
  </div>`;
}

/** Whether the plan wants an image and the editor hasn't decided yet. */
function imageUndecided(opts: DetailOpts): boolean {
  const plan = currentPlan(opts);
  return !!plan && !opts.state.post.featureImage && !plan.imageChoice && !!plan.imagePlan && plan.imagePlan.strategy !== 'skip';
}

function imageLabel(opts: DetailOpts): string {
  return imageUndecided(opts) ? t('post.tabs.imagePending') : t('post.tabs.image');
}

function previewTab(opts: DetailOpts): string {
  const artifact = opts.latestArtifact;
  if (!artifact?.writer) {
    return html`<p class="text-muted">${t('post.preview.noPlan')}</p>
      <div class="article-preview"><p class="article-title">${opts.state.post.title}</p>${raw(renderGhostPreview(opts.latestArtifact?.snapshot.html ?? null) || html`<p class="text-muted">${t('post.preview.currentInGhost')}</p>`)}</div>`;
  }
  const isCurrent = artifact.status === 'planned';
  const edited = artifact.editedAt ? t('post.preview.edited', { time: timeTag(artifact.editedAt) }) : '';
  const status = isCurrent
    ? t('post.preview.statusCurrent', { time: timeTag(artifact.createdAt), edited })
    : t('post.preview.statusOld', { status: html`${artifact.status}`, time: timeTag(artifact.createdAt), edited });
  const newTitle = artifact.patch.title ?? artifact.writer.title ?? artifact.snapshot.title;
  const seo = artifact.seo
    ? html`<details class="side-section">
        <summary>${t('post.preview.seo')}</summary>
        <dl class="mt-2 grid gap-y-2 text-sm [&_dt]:text-xs [&_dt]:text-muted [&_dd]:m-0">
          <dt>${t('post.preview.metaTitle')}</dt><dd>${artifact.seo.meta_title}</dd>
          <dt>${t('post.preview.metaDescription')}</dt><dd>${artifact.seo.meta_description}</dd>
          <dt>${t('post.preview.excerpt')}</dt><dd>${artifact.seo.custom_excerpt}</dd>
          <dt>${t('post.preview.tags')}</dt><dd>${artifact.seo.tags.join(', ')}</dd>
        </dl>
      </details>`
    : '';
  const changes =
    artifact.writer.changes_made.length > 0
      ? html`<details class="side-section"><summary>${t('post.preview.changes', { count: artifact.writer.changes_made.length })}</summary>
          <ul class="mt-2 list-disc pl-5 text-sm [&_li]:my-1.5">${raw(artifact.writer.changes_made.map((c) => html`<li>${c}</li>`).join(''))}</ul>
        </details>`
      : '';
  const sourceList = artifact.sources?.length
    ? html`<details class="side-section"><summary>${t('post.preview.sources', { ok: artifact.sources.filter((x) => x.ok).length, total: artifact.sources.length })}</summary>
        <ul class="mt-2 grid gap-2 text-sm [overflow-wrap:anywhere]">${raw(artifact.sources.map((x) => html`<li><a href="${x.url}" target="_blank" rel="noopener noreferrer">${x.url}</a> ${raw(x.suspicious ? html`<span class="text-warn">${t('post.preview.sourceSuspicious')}</span>` : x.ok ? html`<span class="text-ok">${t('post.preview.sourceOk')}</span>` : html`<span class="text-err">${t('post.preview.sourceFailed', { note: x.note ?? '' })}</span>`)}</li>`).join(''))}</ul>
      </details>`
    : '';
  const quality = artifact.status === 'planned' ? qualityPanelFor(artifact, true) : '';
  return html`
    <div class="preview-layout">
    <div class="min-w-0">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <p class="!m-0 text-sm text-muted">${raw(status)}</p>
      <div class="flex gap-1.5" role="group" aria-label="${t('post.preview.viewAria')}">
        <button type="button" class="btn btn-ghost btn-sm is-active" data-view="new">${t('post.preview.viewNew')}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-view="both">${t('post.preview.viewBoth')}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-view="original">${t('post.preview.viewOriginal')}</button>
      </div>
    </div>
    <div class="preview-grid" data-view-target="new">
      <div class="preview-new">
        <h3 class="mt-0 text-muted font-medium">${t('post.preview.newHeading', { count: words(artifact.writer.markdown) })}</h3>
        <div class="article-preview article-preview-full"><p class="article-title">${newTitle}</p>${raw(renderWriterPreview(artifact.writer.markdown))}</div>
      </div>
      <div class="preview-original">
        <h3 class="mt-0 text-muted font-medium">${t('post.preview.originalHeading')}</h3>
        <div class="article-preview article-preview-full article-before"><p class="article-title">${artifact.snapshot.title}</p>${raw(renderGhostPreview(artifact.snapshot.html) || html`<p class="text-muted">${t('post.preview.empty')}</p>`)}</div>
      </div>
    </div>
    </div>
    ${raw(
      quality || changes || sourceList || seo
        ? html`<section class="preview-side" aria-label="${t('post.preview.sideAria')}">
            ${raw(quality)}
            ${raw(artifact.status === 'planned' ? sharePreview(artifact) : '')}
            ${raw(changes || sourceList || seo ? html`<div class="card divide-y divide-line">${raw(changes)}${raw(sourceList)}${raw(seo)}</div>` : '')}
          </section>`
        : '',
    )}
    </div>`;
}

/** The plan's title when it differs from Ghost's: it's the one applying will set. */
function plannedTitleLine(opts: DetailOpts): string {
  const plan = opts.latestArtifact;
  const title = plan?.status === 'planned' ? plan.writer?.title : undefined;
  if (!title || title === opts.state.post.title) return '';
  return html`<span class="block text-accent">${t('post.header.plannedTitle', { title })}</span>`;
}

function editTab(opts: DetailOpts): string {
  const plan = currentPlan(opts);
  if (!plan) {
    const ghost = html`<a href="${opts.ghostAdminUrl}" target="_blank" rel="noopener noreferrer">Ghost</a>`;
    return html`<p class="text-muted">${raw(t('post.edit.notEditable', { ghost }))}</p>`;
  }
  const writer = plan.writer!;
  const title = plan.patch.title ?? writer.title ?? plan.snapshot.title;
  const seoFields = plan.seo
    ? html`<details class="card mb-2.5 px-3.5 py-2.5">
        <summary>${t('post.edit.seoFields')}</summary>
        <label>${t('post.edit.metaTitle')} <input type="text" name="meta_title" maxlength="60" value="${plan.seo.meta_title}" /></label>
        <label>${t('post.edit.metaDescription')} <textarea name="meta_description" maxlength="155" rows="2">${plan.seo.meta_description}</textarea></label>
        <label>${t('post.edit.excerpt')} <textarea name="custom_excerpt" maxlength="300" rows="3">${plan.seo.custom_excerpt}</textarea></label>
      </details>`
    : '';
  return html`
    <form method="post" action="/posts/${plan.postId}/plan/edit" class="[&_label]:mb-3 [&_label]:block [&_label]:text-sm [&_label]:text-muted [&_input[type=text]]:mt-1 [&_input[type=text]]:w-full [&_textarea]:mt-1 [&_textarea]:w-full" data-edit-form>
      <input type="hidden" name="runId" value="${plan.runId}" />
      <input type="hidden" data-q-keyword value="${plan.seo?.primary_keyword ?? ''}" />
      <input type="hidden" data-q-image value="${plan.snapshot.feature_image || plan.uploadedImage || plan.imagePlan ? '1' : ''}" />
      <div class="breakout">
        <label>${t('post.edit.title')} <input type="text" name="title" required value="${title}" /></label>
        ${raw(seoFields)}
      </div>
      <div class="breakout grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div class="flex flex-col">
          <h3 class="mt-0">Markdown <span class="text-muted" data-edit-status aria-live="polite"></span></h3>
          <textarea name="markdown" aria-label="${t('post.edit.markdownAria')}" class="min-h-[70vh] flex-1 font-mono text-[0.85rem]" required spellcheck="true" data-markdown-input>${writer.markdown}</textarea>
        </div>
        <div>
          <h3 class="mt-0">${t('post.edit.previewHeading')}</h3>
          <div class="mb-3" data-edit-quality>${raw(qualityPanelFor(plan))}</div>
          <div class="article-preview !max-h-[60vh]" data-edit-preview>${raw(renderWriterPreview(writer.markdown))}</div>
        </div>
      </div>
      <div class="sticky bottom-0 z-10 mt-4">
        <div class="breakout flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-bg py-3">
          <button type="submit" class="btn">${t('post.edit.save')}</button>
          <span class="text-muted">${t('post.edit.saveHint')}</span>
        </div>
      </div>
    </form>`;
}

function planTab(opts: DetailOpts): string {
  const { state } = opts;
  const detected = opts.detectedMode === 'improve' ? t('post.plan.detectedImprove') : t('post.plan.detectedDraft');
  const instructions = state.latestRun?.extraInstructions ?? '';
  const promote = instructions
    ? html`<p class="text-muted">${raw(t('post.plan.promote', { link: html`<a href="/settings/prompts/writer.system?append=${encodeURIComponent(instructions)}">${t('post.plan.promoteLink')}</a>` }))}</p>`
    : '';
  const replaceWarning = currentPlan(opts) ? html`<p class="text-muted">${t('post.plan.replaceWarning')}</p>` : '';
  return html`
    <form method="post" action="/posts/${state.post.id}/plan" data-busy="${t('post.plan.busy')}" class="[&_textarea]:mb-2 [&_textarea]:mt-1 [&_textarea]:block [&_textarea]:min-h-16 [&_textarea]:w-full">
      <fieldset class="mb-4 rounded-md border border-line px-4 py-3 [&_label]:block [&_label]:cursor-pointer [&_label]:py-1">
        <legend class="px-1.5 text-sm text-muted">${t('post.plan.legend')}</legend>
        <label><input type="radio" name="mode" value="auto" checked /> <strong>${t('post.plan.auto')}</strong> <span class="text-muted">${t('post.plan.autoHint', { mode: detected })}</span></label>
        <label><input type="radio" name="mode" value="draft" /> <strong>${t('post.plan.draft')}</strong> <span class="text-muted">${t('post.plan.draftHint')}</span></label>
        <label><input type="radio" name="mode" value="improve" /> <strong>${t('post.plan.improve')}</strong> <span class="text-muted">${t('post.plan.improveHint')}</span></label>
      </fieldset>
      <label>${t('post.plan.instructions')}
        <textarea name="instructions" placeholder="${t('post.plan.placeholder')}">${instructions}</textarea>
      </label>
      ${raw(replaceWarning)}
      <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="submit" class="btn">${t('post.plan.submit')}</button>
        <span class="text-sm text-muted">${t('post.plan.hint')}</span>
      </div>
    </form>
    ${raw(promote)}`;
}

/**
 * One question per card, in a single column: number, the question as label
 * (above the field), a full-width textarea that grows while typing and
 * each one's status. Inspired by Primer (GitHub) forms and
 * long questionnaires: visible progress and numbering to show
 * how much is left.
 */
/** "¿quieres…" -> "¿Quieres…" (the model sometimes writes them lowercase). */
function capitalize(q: string): string {
  return q.replace(/^([¿¡"«]*)(\p{Ll})/u, (_, p: string, c: string) => p + c.toUpperCase());
}

function pendingFields(questions: string[]): string {
  const items = questions
    .map(
      (q, i) => html`
      <li class="card p-4 sm:p-5" data-pending-item>
        <div class="flex items-start gap-3">
          <span class="pending-num" aria-hidden="true">${i + 1}</span>
          <div class="min-w-0 flex-1">
            <label for="answer_${i}" class="block font-medium leading-snug text-fg">${capitalize(q)}</label>
            <textarea id="answer_${i}" name="answer_${i}" rows="3" class="mt-3 block w-full min-h-24" placeholder="${t('post.pending.answerPlaceholder')}" data-autogrow></textarea>
            <p class="mt-2 text-sm text-muted" data-pending-state aria-live="polite">${t('post.pending.unanswered')}</p>
          </div>
        </div>
      </li>`,
    )
    .join('\n');
  return html`
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-muted" data-pending-progress aria-live="polite">${raw(t('post.pending.progress', { answered: '<strong class="text-fg">0</strong>', total: questions.length }))}</p>
      <div class="h-1.5 w-40 overflow-hidden rounded-full bg-line" aria-hidden="true"><div class="h-full w-0 rounded-full bg-accent transition-[width]" data-pending-bar></div></div>
    </div>
    <ol class="m-0 grid list-none gap-3 p-0" data-pending-list data-total="${questions.length}">${raw(items)}</ol>`;
}

/** Answers already merged into the plan, editable: changing one redoes that part of the text. */
function answeredFields(answers: NonNullable<RunArtifact['answers']>): string {
  if (answers.length === 0) return '';
  const items = answers
    .map(
      (a, i) => html`
      <li class="card p-4">
        <label for="fix_${i}" class="block text-sm font-medium leading-snug text-muted">${capitalize(a.question)}</label>
        <textarea id="fix_${i}" name="fix_${i}" rows="2" class="mt-2 block w-full" data-autogrow>${a.answer}</textarea>
      </li>`,
    )
    .join('\n');
  return html`
    <details class="mt-6">
      <summary class="cursor-pointer font-medium">${t('post.pending.answeredSummary', { count: answers.length })}</summary>
      <p class="mt-2 text-sm text-muted">${t('post.pending.answeredHint')}</p>
      <ol class="m-0 mt-3 grid list-none gap-3 p-0">${raw(items)}</ol>
    </details>`;
}

/** Questions of the unapplied plan (resolved in the plan) or, if none, those in the text already in Ghost. */
function pendingQuestions(opts: DetailOpts): { questions: string[]; onPlan: boolean } {
  const plan = currentPlan(opts);
  if (plan) return { questions: uniquePendingQuestions(plan.writer!.markdown), onPlan: true };
  return { questions: [...new Set(opts.state.live.pendingQuestions)], onPlan: false };
}

function pendingTab(opts: DetailOpts): string {
  const { questions, onPlan } = pendingQuestions(opts);
  const answers = onPlan ? (currentPlan(opts)!.answers ?? []) : [];
  if (questions.length === 0 && answers.length === 0) return '';
  const id = opts.state.post.id;
  if (onPlan) {
    return html`
      <div class="max-w-3xl">
        <p class="mb-4 text-muted">${t('post.pending.planIntro')}</p>
        <form method="post" action="/posts/${id}/plan/resolve" data-guard data-busy="${t('post.pending.busyPlan')}">
          <input type="hidden" name="runId" value="${currentPlan(opts)!.runId}">
          ${raw(questions.length ? pendingFields(questions) : html`<p class="card mb-0 p-4 text-ok">${t('post.pending.noneLeft')}</p>`)}
          ${raw(answeredFields(answers))}
          <div class="mt-5 flex flex-wrap items-center gap-3">
            <button type="submit" class="btn">${questions.length ? t('post.pending.submitAnswers') : t('post.pending.submitFixes')}</button>
            <span class="text-sm text-muted">${t('post.pending.askAgain')}</span>
          </div>
        </form>
      </div>`;
  }
  return html`
    <div class="max-w-3xl">
      <p class="mb-4 text-muted">${t('post.pending.liveIntro')}</p>
      <form method="post" action="/posts/${id}/resolve/preview" data-guard data-busy="${t('post.pending.busyPreview')}">
        ${raw(pendingFields(questions))}
        <div class="mt-5"><button type="submit" class="btn">${t('post.pending.preview')}</button></div>
      </form>
    </div>`;
}

function historyRow(a: ApplyAttemptRow): string {
  const provenance = a.provenance === 'inferred' ? html`<span class="italic text-warn">${t('post.history.inferred')}</span>` : t('post.history.recorded');
  return html`
    <tr>
      <td>${raw(timeTag(a.at))}${a.actor ? raw(html`<span class="block text-xs text-muted">${t('auth.by', { name: a.actor })}</span>`) : ''}</td>
      <td>${codeLabel('result', a.result)}</td>
      <td title="${a.reason_code}">${codeLabel('reason', a.reason_code)}</td>
      <td>${codeLabel('imageResult', a.image_result)}</td>
      <td>${raw(provenance)}</td>
      <td>${a.message}</td>
    </tr>`;
}

/** "Undo the last apply": only while the post is as the apply left it. */
function restoreBlock(opts: DetailOpts): string {
  const plan = opts.latestArtifact;
  if (!canRestore(plan)) return '';
  return html`<h3 class="section-heading mt-6">${t('post.restore.heading')}</h3>
    <p class="text-muted">${t('post.restore.hint')}</p>
    <button type="button" class="btn btn-ghost" data-open-dialog="restore-dialog">${t('post.restore.button')}</button>
    ${raw(
      confirmDialog({
        id: 'restore-dialog',
        title: t('post.restore.dialogTitle'),
        body: t('post.restore.dialogBody'),
        confirmLabel: t('post.restore.button'),
        danger: true,
        action: `/posts/${plan.postId}/restore`,
        busy: t('post.restore.busy'),
      }),
    )}`;
}

function historyTab(opts: DetailOpts): string {
  const { state, latestArtifact, applyHistory } = opts;
  const issues =
    state.issues.length > 0
      ? state.issues
          .map((issue) => {
            const action = issue.suggestedAction ? html`<div class="issue-action">→ ${issue.suggestedAction}</div>` : '';
            return html`<div class="issue issue-${issue.severity}"><div class="issue-message">${issue.message}</div>${raw(action)}</div>`;
          })
          .join('\n')
      : html`<p class="text-muted">${t('post.history.noIssues')}</p>`;
  const historyRows = applyHistory.map(historyRow).join('\n');
  const history = historyRows
    ? html`<div class="overflow-x-auto"><table class="data-table">
        <thead><tr><th>${t('post.history.cols.date')}</th><th>${t('post.history.cols.result')}</th><th>${t('post.history.cols.reason')}</th><th>${t('post.history.cols.image')}</th><th>${t('post.history.cols.origin')}</th><th>${t('post.history.cols.message')}</th></tr></thead>
        <tbody>${raw(historyRows)}</tbody>
      </table></div>`
    : html`<p class="text-muted">${t('post.history.noApplies')}</p>`;
  const imageRetry =
    !state.post.featureImage && state.latestRun
      ? html`<h3 class="section-heading mt-6">${t('post.history.imageHeading')}</h3>
        <p class="text-muted">${t('post.history.imageRetryHint')}</p>
        <form method="post" action="/posts/${state.post.id}/image/retry" data-busy="${t('post.history.imageRetryBusy')}"><button type="submit" class="btn btn-ghost">${t('post.history.imageRetry')}</button></form>`
      : '';
  const diff = latestArtifact
    ? html`<details><summary>${t('post.history.diff')}</summary><pre class="card mt-2 max-h-[70vh] overflow-y-auto whitespace-pre-wrap break-words p-4 text-[0.85rem]">${renderDiff(latestArtifact)}</pre></details>`
    : '';
  return html`
    <h3 class="section-heading">${t('post.history.issues')}</h3>
    ${raw(issues)}
    ${raw(imageRetry)}
    ${raw(restoreBlock(opts))}
    <h3 class="section-heading mt-6">${t('post.history.attempts')}</h3>
    ${raw(history)}
    ${raw(diff)}`;
}

export function detailPage(opts: DetailOpts): string {
  const { state, latestArtifact } = opts;
  const costLine = latestArtifact
    ? html` · ${t('post.header.lastPlanCost', { cost: formatRunCost(latestArtifact.cost), input: formatTokens(latestArtifact.cost.inputTokens), output: formatTokens(latestArtifact.cost.outputTokens) })}`
    : '';
  const resolvedNote = opts.resolved
    ? flash(`${t('post.flash.resolved')} ${opts.resolved.unresolved > 0 ? t('post.flash.resolvedLeft', { count: opts.resolved.unresolved }) : t('post.flash.resolvedReview')}`)
    : '';
  const savedNote = opts.resolved ? resolvedNote : opts.restored ? flash(t('post.flash.restored')) : opts.fixed ? flash(t('post.flash.fixed')) : opts.saved ? flash(t('post.flash.saved')) : '';
  const pending = pendingTab(opts);
  const pendingCount = pendingQuestions(opts).questions.length;
  const pendingLabel = pendingCount > 0 ? t('post.tabs.pending', { count: pendingCount }) : t('post.tabs.answers');
  const issueCount = state.issues.length > 0 ? html` <span class="badge badge-warn ml-1">${state.issues.length}</span>` : '';

  const tabs: Array<{ id: string; label: string; body: string }> = [
    { id: 'plan-preview', label: t('post.tabs.preview'), body: previewTab(opts) },
    ...(currentPlan(opts) ? [{ id: 'revisar', label: t('post.tabs.review'), body: reviewTab(currentPlan(opts)) }] : []),
    ...(currentPlan(opts)
      ? [{ id: 'imagen', label: imageLabel(opts), body: imageTab(currentPlan(opts)!, state.post.featureImage) }]
      : opts.imageOnly
        ? [{ id: 'imagen', label: t('post.tabs.image'), body: imageTab(opts.imageOnly, state.post.featureImage) }]
        : []),
    { id: 'editar', label: t('post.tabs.edit'), body: editTab(opts) },
    { id: 'planificar', label: t('post.tabs.plan'), body: planTab(opts) },
    ...(pending ? [{ id: 'pendientes', label: pendingLabel, body: pending }] : []),
    ...(opts.team ? [{ id: 'notas', label: notesLabel(opts.team), body: notesTab(state.post.id, opts.team) }] : []),
    { id: 'historial', label: t('post.tabs.history'), body: historyTab(opts) },
  ];
  const tabNav = tabs
    .map((tab) => html`<a href="#${tab.id}" class="tab" data-tab-link="${tab.id}" data-palette="${t('post.goTo', { label: tab.label })}" ${TAB_SHORTCUTS[tab.id] ? raw(html`data-shortcut="${TAB_SHORTCUTS[tab.id]!}"`) : ''}>${tab.label}${raw(tab.id === 'historial' ? issueCount : '')}</a>`)
    .join('');
  const tabPanels = tabs.map((tab) => html`<section id="${tab.id}" class="tab-panel" data-tab-panel aria-labelledby="${tab.id}-title"><h2 id="${tab.id}-title" class="sr-only">${tab.label}</h2>${raw(tab.body)}</section>`).join('\n');

  const body = html`
    ${raw(
      pageHeader({
        back: { href: '/', label: t('post.header.back') },
        title: state.post.title,
        badge: badge(state.kind),
        meta: html`<a href="${state.post.url}" target="_blank" rel="noopener noreferrer">${t('post.header.siteView')}</a> ·
          <a href="${opts.ghostAdminUrl}" target="_blank" rel="noopener noreferrer">${t('post.header.editInGhost')}</a> ·
          <span>${t('post.header.words', { count: state.post.wordCount })} · ${raw(t('post.header.updated', { time: timeTag(state.post.updatedAt) }))}${raw(costLine)}</span>${raw(plannedTitleLine(opts))}`,
        actions: html`<a href="/posts/${state.post.id}/next" class="btn btn-ghost btn-sm" data-palette="${t('post.header.nextPalette')}" data-shortcut="n">${t('post.header.next')} &rarr;</a>`,
      }),
    )}
    ${raw(opts.team ? teamStrip(state.post.id, opts.team) : '')}
    <div data-presence="${state.post.id}" aria-live="polite">${raw(presenceBanner(opts.team?.others ?? []))}</div>
    ${raw(savedNote)}
    ${raw(nextStep(opts))}
    <nav class="mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="${t('post.header.sectionsAria')}">${raw(tabNav)}</nav>
    ${raw(tabPanels)}
    <script src="/detail.js" defer data-cfasync="false"></script>
  `;

  return layout({ title: state.post.title, bodyHtml: body, section: 'dashboard' });
}

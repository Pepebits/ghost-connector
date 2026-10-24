import { categorizedChanges, diffWords, hunkAction, markdownFingerprint, planHunks, type Block, type Hunk } from '../../review/blocks.js';
import type { RunArtifact } from '../../types.js';
import { t } from '../../i18n/index.js';
import { html, raw } from '../html.js';
import { renderWriterPreview } from './preview.js';

const ACTION_TONE = { modified: 'badge-info', added: 'badge-ok', removed: 'badge-err' } as const;

function renderBlocks(blocks: Block[]): string {
  return renderWriterPreview(blocks.map((b) => b.markdown).join('\n\n'));
}

/** A rewritten paragraph: word diff over the Markdown (reads better than two full versions). */
function wordDiff(before: Block, after: Block): string {
  return diffWords(before.markdown, after.markdown)
    .map((o) =>
      o.op === 'same'
        ? html`${o.text}`
        : o.op === 'add'
          ? html`<ins class="rounded-sm bg-ok-soft text-ok no-underline">${o.text}</ins>`
          : html`<del class="rounded-sm bg-err-soft text-err">${o.text}</del>`,
    )
    .join('');
}

function changeCard(h: Extract<Hunk, { type: 'change' }>, index: number, category: string): string {
  const action = hunkAction(h);
  const oneToOne = h.before.length === 1 && h.after.length === 1;
  const body = oneToOne
    ? html`<div class="whitespace-pre-wrap break-words font-mono text-[0.85rem] leading-relaxed">${raw(wordDiff(h.before[0]!, h.after[0]!))}</div>
        <details class="mt-2 text-sm"><summary class="text-muted">${t('review.viewRendered')}</summary>
          <div class="mt-2 grid gap-3 lg:grid-cols-2">
            <div class="article-preview article-before">${raw(renderBlocks(h.before))}</div>
            <div class="article-preview">${raw(renderBlocks(h.after))}</div>
          </div>
        </details>`
    : action === 'added'
      ? html`<div class="article-preview border-ok/50">${raw(renderBlocks(h.after))}</div>`
      : action === 'removed'
        ? html`<div class="article-preview border-err/50 article-before">${raw(renderBlocks(h.before))}</div>`
        : html`<div class="grid gap-3 lg:grid-cols-2">
            <div><div class="mb-1 text-xs text-muted">${t('review.original')}</div><div class="article-preview article-before">${raw(renderBlocks(h.before))}</div></div>
            <div><div class="mb-1 text-xs text-muted">${t('review.new')}</div><div class="article-preview">${raw(renderBlocks(h.after))}</div></div>
          </div>`;

  const keepNewLabel = t(`review.keepNew.${action}`);
  const keepOldLabel = t(`review.keepOld.${action}`);
  return html`
    <fieldset class="card mb-3 p-3.5" data-hunk data-category="${category}">
      <legend class="sr-only">${t('review.changeN', { n: index + 1 })}</legend>
      <div class="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <span class="badge ${ACTION_TONE[action]}">${t(`review.action.${action}`)}</span>
        <div class="flex gap-3 text-sm">
          <label class="flex items-center gap-1.5"><input type="radio" name="d_${index}" value="new" checked /> ${keepNewLabel}</label>
          <label class="flex items-center gap-1.5"><input type="radio" name="d_${index}" value="old" /> ${keepOldLabel}</label>
        </div>
      </div>
      ${raw(body)}
    </fieldset>`;
}

/** Body of the post detail "Review" tab. */
export function reviewTab(plan: RunArtifact | null): string {
  if (!plan?.writer) return html`<p class="text-muted">${t('review.noPlan')}</p>`;
  const hunks = planHunks(plan.snapshot.html, plan.writer.markdown);
  const changes = categorizedChanges(hunks);
  if (changes.length === 0) return html`<p class="text-muted">${t('review.noChanges')}</p>`;

  let k = 0;
  const items = hunks
    .map((h) => {
      if (h.type === 'equal') {
        return html`<p class="my-2 text-center text-xs text-muted">${t('review.unchanged', { count: h.blocks.length })}</p>`;
      }
      const i = k++;
      return changeCard(h, i, changes[i]!.category);
    })
    .join('\n');

  return html`
    <form method="post" action="/posts/${plan.postId}/plan/review" data-review-form data-guard>
      <input type="hidden" name="runId" value="${plan.runId}" />
      <input type="hidden" name="fp" value="${markdownFingerprint(plan.writer.markdown)}" />
      <input type="hidden" name="count" value="${changes.length}" />
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <span>${raw(t('review.intro', { count: changes.length }))}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-review-all="new">${t('review.acceptAll')}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-review-all="old">${t('review.rejectAll')}</button>
      </div>
      ${raw(items)}
      <div class="sticky bottom-0 z-10 mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-bg py-3">
        <button type="submit" class="btn">${t('review.save')}</button>
        <span class="text-sm text-muted" data-review-summary aria-live="polite"></span>
      </div>
    </form>`;
}

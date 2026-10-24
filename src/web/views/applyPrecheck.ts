import type { ApplyPrecheck } from '../../orchestrator/writeback.js';
import type { RunArtifact } from '../../types.js';
import { t } from '../../i18n/index.js';
import { html, raw } from '../html.js';
import { layout } from './layout.js';
import { pageHeader, timeTag } from './ui.js';

export function applyPrecheckPage(opts: { artifact: RunArtifact; precheck: ApplyPrecheck }): string {
  const { artifact, precheck } = opts;
  const cards: string[] = [];

  if (precheck.conflict) {
    cards.push(
      html`<div class="issue issue-error">
        <div class="issue-message">${raw(t('apply.conflict', { actual: timeTag(precheck.conflict.actualUpdatedAt), planned: timeTag(precheck.conflict.plannedUpdatedAt) }))}</div>
        <div class="issue-action">→ ${t('apply.conflictAction')}</div>
      </div>`,
    );
  }
  if (precheck.notDraft) {
    cards.push(html`<div class="issue issue-error"><div class="issue-message">${t('apply.notDraft')}</div></div>`);
  }
  if (precheck.pending.length > 0) {
    cards.push(
      html`<div class="issue issue-warning">
        <div class="issue-message">${t('apply.pending', { count: precheck.pending.length })}</div>
      </div>`,
    );
  }
  if (precheck.unknownLinks.length > 0) {
    cards.push(
      html`<div class="issue issue-warning">
        <div class="issue-message">${t('apply.unknownLinks', { count: precheck.unknownLinks.length })}</div>
        <ul class="mt-1.5 break-all text-sm">${raw(precheck.unknownLinks.map((l) => html`<li><code>${l}</code></li>`).join(''))}</ul>
      </div>`,
    );
  }
  if (precheck.image === 'not-chosen') {
    cards.push(
      html`<div class="issue issue-warning">
        <div class="issue-message">${raw(t('apply.noImage'))}</div>
        <div class="issue-action">→ ${raw(t('apply.chooseImage', { link: html`<a href="/posts/${artifact.postId}#imagen">${t('apply.chooseImageLink')}</a>` }))}</div>
      </div>`,
    );
  } else if (precheck.image === 'remove') {
    cards.push(
      html`<div class="issue issue-warning">
        <div class="issue-message">${t('apply.imageRemove')} <a href="/posts/${artifact.postId}#imagen">${t('apply.changeImage')}</a></div>
      </div>`,
    );
  } else if ((precheck.image === 'chosen' || precheck.image === 'replace') && artifact.imageChoice?.kind === 'option') {
    cards.push(
      html`<div class="issue issue-info flex items-center gap-3">
        <img src="/posts/${artifact.postId}/image/chosen?v=${encodeURIComponent(artifact.imageChoice.localFile)}" alt="" class="h-14 w-24 shrink-0 rounded object-cover">
        <div class="issue-message">${t(precheck.image === 'replace' ? 'apply.imageReplace' : 'apply.imageChosen', { provider: artifact.imageChoice.option.provider })} <a href="/posts/${artifact.postId}#imagen">${t('apply.changeImage')}</a></div>
      </div>`,
    );
  }
  if (precheck.sanity && !precheck.sanity.ok) {
    const sn = precheck.sanity;
    cards.push(
      html`<div class="issue issue-warning">
        <div class="issue-message">${raw(t('apply.sanity', { after: sn.wordsAfter, before: sn.wordsBefore, ratio: sn.ratio.toFixed(1), min: sn.min, max: sn.max }))}</div>
      </div>`,
    );
  }

  const cardsBlock = cards.length > 0 ? cards.join('\n') : html`<p class="text-muted">${t('apply.allGood')}</p>`;

  const blocking = precheck.conflict !== null || precheck.notDraft;

  const pendingCheckbox =
    precheck.pending.length > 0
      ? html`<label class="mb-2 flex items-center gap-2 text-muted"><input type="checkbox" name="allowPending" /> ${t('apply.allowPending', { count: precheck.pending.length })}</label>`
      : '';
  const linksCheckbox =
    precheck.unknownLinks.length > 0
      ? html`<label class="mb-2 flex items-center gap-2 text-muted"><input type="checkbox" name="allowLinks" /> ${t('apply.allowLinks', { count: precheck.unknownLinks.length })}</label>`
      : '';
  const sanityCheckbox =
    precheck.sanity && !precheck.sanity.ok
      ? html`<label class="mb-2 flex items-center gap-2 text-muted"><input type="checkbox" name="forceSanity" /> ${t('apply.forceSanity')}</label>`
      : '';

  const form = !blocking
    ? html`
      <form method="post" action="/posts/${artifact.postId}/apply/confirm" data-busy="${t('apply.busy')}">
        <input type="hidden" name="runId" value="${artifact.runId}" />
        ${raw(pendingCheckbox)}
        ${raw(linksCheckbox)}
        ${raw(sanityCheckbox)}
        <label class="mb-2 flex items-center gap-2 text-muted"><input type="checkbox" name="confirmed" required /> ${t('apply.confirmed')}</label>
        <button type="submit" class="btn">${t('apply.submit')}</button>
        <p class="mt-2 text-sm text-muted">${t('apply.hint')}</p>
      </form>`
    : html`<p class="text-muted">${t('apply.blocked')}</p>`;

  const body = html`
    ${raw(pageHeader({ back: { href: `/posts/${artifact.postId}`, label: artifact.postTitle }, title: t('apply.title'), meta: html`${t('apply.meta', { title: artifact.postTitle })}` }))}
    ${raw(cardsBlock)}
    ${raw(form)}
  `;

  return layout({ title: t('apply.title'), bodyHtml: body, section: 'dashboard' });
}

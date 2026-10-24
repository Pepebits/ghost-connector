import { chosenCaption, IMAGE_ONLY_RUN, postLanguage, type ImageWork } from '../../orchestrator/imageChoice.js';
import { t } from '../../i18n/index.js';
import { html, raw } from '../html.js';
import { configuredSources } from '../../images/registry.js';

const PROVIDER_LABEL: Record<string, string> = { unsplash: 'Unsplash', pixabay: 'Pixabay', pexels: 'Pexels', openverse: 'Openverse', wikimedia: 'Wikimedia Commons' };

function hidden(plan: ImageWork): string {
  return html`<input type="hidden" name="runId" value="${plan.runId}">`;
}

function chosenBlock(plan: ImageWork, hasCurrent = false): string {
  const choice = plan.imageChoice;
  if (choice?.kind === 'none') {
    return html`<div class="card mb-5 flex flex-wrap items-center justify-between gap-3 p-4">
      <p class="m-0"><strong>${t('image.noneTitle')}</strong> ${t('image.noneBody')}</p>
    </div>`;
  }
  if (choice?.kind !== 'option' && plan.runId === IMAGE_ONLY_RUN) return '';
  if (choice?.kind !== 'option') {
    return html`<div class="card mb-5 border-l-4 border-l-warn p-4">
      <p class="m-0"><strong>${t('image.notChosenTitle')}</strong> ${t('image.notChosenBody')}</p>
    </div>`;
  }
  const src = `/posts/${plan.postId}/image/chosen?v=${encodeURIComponent(choice.localFile)}`;
  return html`
    <div class="card mb-6 grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <figure class="m-0">
        <img src="${src}" alt="${choice.alt}" class="aspect-[16/9] w-full rounded-md bg-panel-2 object-cover">
        <figcaption class="mt-2 text-sm text-muted">${t('image.downloaded')} · ${PROVIDER_LABEL[choice.option.provider] ?? choice.option.provider}${choice.option.width ? html` · ${choice.option.width}×${choice.option.height}` : ''}</figcaption>
      </figure>
      <form method="post" action="/posts/${plan.postId}/image/text" class="grid content-start gap-4">
        ${raw(hidden(plan))}
        <div>
          <label for="img-alt" class="block font-medium">${t('image.alt')}</label>
          <p id="img-alt-hint" class="mt-0.5 text-sm text-muted">${t('image.altHint')}</p>
          <input id="img-alt" name="alt" maxlength="191" value="${choice.alt}" aria-describedby="img-alt-hint" class="mt-2 block w-full">
        </div>
        <div>
          <label for="img-caption" class="block font-medium">${t('image.caption')} <span class="font-normal text-muted">${t('image.optional')}</span></label>
          <p id="img-caption-hint" class="mt-0.5 text-sm text-muted">${t('image.captionHint')}</p>
          <textarea id="img-caption" name="caption" rows="2" maxlength="300" aria-describedby="img-caption-hint" class="mt-2 block w-full" data-autogrow>${choice.captionText}</textarea>
          <p class="mt-2 text-sm text-muted">${t('image.resultPreview')} <span class="text-fg">${raw(chosenCaption(choice, postLanguage(plan)))}</span></p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="submit" class="btn">${t('image.save')}</button>
          <button type="submit" class="btn btn-ghost" formaction="/posts/${plan.postId}/image/keep">${hasCurrent ? t('image.cancelReplace') : t('image.cancelChoice')}</button>
          ${plan.runId === IMAGE_ONLY_RUN || hasCurrent ? '' : raw(html`<button type="submit" class="btn btn-ghost" formaction="/posts/${plan.postId}/image/none">${t('image.applyWithout')}</button>`)}
        </div>
      </form>
    </div>`;
}

/** Empty search: the brand ghost floats looking left and right, as if searching. */
function ghostEmpty(title: string, body: string): string {
  return html`<div class="ghost-empty card flex flex-col items-center gap-3 px-4 py-10 text-center" role="status">
    <svg class="ghost-empty-sprite" viewBox="-18 0 58 45" width="72" height="56" shape-rendering="crispEdges" aria-hidden="true" focusable="false">
      <rect class="ghost-empty-bit" x="-16" y="32" width="10" height="10" fill="#ff3e3e"/>
      <g class="ghost-empty-body">
        <path fill="var(--gc-ghost-body)" d="M10 0H30V5H35V10H40V45H30V40H25V45H15V40H10V45H0V10H5V5H10Z"/>
        <g class="ghost-empty-eyes" fill="var(--gc-ghost-eyes)"><rect x="5" y="15" width="10" height="10"/><rect x="25" y="15" width="10" height="10"/></g>
      </g>
    </svg>
    <p class="!m-0 font-medium">${title}</p>
    <p class="!m-0 max-w-md text-sm text-muted">${body}</p>
  </div>`;
}

function optionsGrid(plan: ImageWork): string {
  const found = plan.imageOptions;
  if (!found) return html`<p class="text-muted">${t('image.searchFirst')}</p>`;
  const chosenId = plan.imageChoice?.kind === 'option' ? `${plan.imageChoice.option.provider}:${plan.imageChoice.option.id}` : null;
  const notes = found.notes.length ? html`<p class="mt-2 text-sm text-muted">${found.notes.join(' · ')}</p>` : '';
  if (found.options.length === 0) return html`${raw(ghostEmpty(t('image.emptyTitle', { query: found.query }), t('image.emptyBody')))}${raw(notes)}`;
  const cells = found.options
    .map((o, i) => {
      const isChosen = chosenId === `${o.provider}:${o.id}`;
      const who = o.attribution.authorName ? `${o.attribution.authorName} · ` : '';
      return html`<li>
        <button type="submit" name="index" value="${i}" class="image-option${isChosen ? ' is-chosen' : ''}" aria-pressed="${isChosen ? 'true' : 'false'}" aria-label="${t('image.useBy', { author: o.attribution.authorName ?? t('image.unknownAuthor'), provider: PROVIDER_LABEL[o.provider] ?? o.provider })}">
          <img src="${o.thumbUrl}" alt="" loading="lazy" referrerpolicy="no-referrer" class="aspect-[3/2] w-full object-cover">
          <span class="flex items-center justify-between gap-2 px-2.5 py-2 text-left text-xs text-muted">
            <span class="truncate">${who}${PROVIDER_LABEL[o.provider] ?? o.provider}</span>
            ${raw(isChosen ? html`<span class="font-medium text-accent">${t('image.chosen')}</span>` : '')}
          </span>
        </button>
      </li>`;
    })
    .join('');
  return html`
    <form method="post" action="/posts/${plan.postId}/image/choose" data-busy="${t('image.busyDownload')}">
      ${raw(hidden(plan))}
      <ul class="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-4">${raw(cells)}</ul>
    </form>
    ${raw(notes)}`;
}

/** The image the post already has in Ghost: keep it, replace it or remove it (all take effect on apply). */
function currentBlock(plan: ImageWork, url: string): string {
  const choice = plan.imageChoice?.kind;
  const action = (path: string, label: string) =>
    html`<form method="post" action="/posts/${plan.postId}/image/${path}">${raw(hidden(plan))}<button type="submit" class="btn btn-ghost">${label}</button></form>`;
  const state =
    choice === 'remove'
      ? html`<p class="!mt-0 font-medium text-warn">${t('image.current.willRemove')}</p>${raw(action('keep', t('image.current.keep')))}`
      : choice === 'option'
        ? html`<p class="!mt-0 font-medium text-accent">${t('image.current.willReplace')}</p>${raw(action('keep', t('image.current.keep')))}`
        : html`<p class="!mt-0">${t('image.current.kept')}</p>${raw(action('remove', t('image.current.remove')))}`;
  return html`<div class="card mb-6 grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
    <figure class="m-0">
      <img src="${url}" alt="" referrerpolicy="no-referrer" class="aspect-[16/9] w-full rounded-md bg-panel-2 object-cover ${choice === 'remove' ? 'opacity-40' : ''}">
      <figcaption class="mt-2 text-sm text-muted">${t('image.current.caption')}</figcaption>
    </figure>
    <div class="grid content-start gap-3">
      ${raw(state)}
      <p class="!mb-0 text-sm text-muted">${t('image.current.storageNote')}</p>
    </div>
  </div>`;
}

/** Image-only work: says the text stays as is and, once there's a choice, applies it on its own. */
function imageOnlyBar(plan: ImageWork): string {
  if (plan.runId !== IMAGE_ONLY_RUN) return '';
  const kind = plan.imageChoice?.kind;
  if (kind !== 'option' && kind !== 'remove') return html`<p class="mb-4 text-muted">${t('image.only.intro')}</p>`;
  return html`<div class="card mb-6 flex flex-wrap items-center justify-between gap-3 border-l-4 border-l-accent px-4 py-3.5">
    <p class="m-0 text-sm text-muted">${t('image.only.note')}</p>
    <form method="post" action="/posts/${plan.postId}/image/apply" data-busy="${t('image.only.busy')}">
      <button type="submit" class="btn">${kind === 'remove' ? t('image.only.applyRemove') : t('image.only.apply')}</button>
    </form>
  </div>`;
}

/** Detail "Image" tab: choose the featured image (with a plan, applied with it; without one, on its own). */
export function imageTab(plan: ImageWork, existingFeatureImage: string | null): string {
  const query = plan.imageOptions?.query ?? plan.imagePlan?.unsplash_query ?? plan.postTitle;
  const offerNone = plan.runId !== IMAGE_ONLY_RUN;
  if (existingFeatureImage) {
    return html`
      ${raw(imageOnlyBar(plan))}
      ${raw(currentBlock(plan, existingFeatureImage))}
      <h3 class="section-heading">${t('image.current.replaceTitle')}</h3>
      ${raw(plan.imageChoice?.kind === 'option' ? chosenBlock(plan, true) : '')}
      ${raw(searchForm(plan, query, false))}
      <p class="mb-3 text-sm text-muted">${t('image.clickHint')}</p>
      ${raw(optionsGrid(plan))}`;
  }
  return html`
    ${raw(imageOnlyBar(plan))}
    ${raw(chosenBlock(plan))}
    ${raw(searchForm(plan, query, offerNone))}
    <p class="mb-3 text-sm text-muted">${t('image.clickHint')}</p>
    ${raw(optionsGrid(plan))}`;
}

/** "All, in your order" or a single source (only those configured). */
function sourceSelect(plan: ImageWork): string {
  const sources = configuredSources();
  if (sources.length < 2) return '';
  const current = plan.imageOptions?.source ?? '';
  const options = sources
    .map((s) => html`<option value="${s.name}" ${s.name === current ? raw('selected') : ''}>${PROVIDER_LABEL[s.name] ?? s.name}</option>`)
    .join('');
  return html`<div>
    <label for="img-source" class="block font-medium">${t('image.sourceLabel')}</label>
    <select id="img-source" name="source" class="mt-2 w-full sm:w-auto">
      <option value="">${t('image.sourceAll')}</option>
      ${raw(options)}
    </select>
  </div>`;
}

function searchForm(plan: ImageWork, query: string, offerNone: boolean): string {
  return html`
    <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <form method="post" action="/posts/${plan.postId}/image/search" class="flex min-w-0 flex-1 flex-wrap items-end gap-2" data-busy="${t('image.busySearch')}">
        ${raw(hidden(plan))}
        <div class="min-w-48 flex-1">
          <label for="img-q" class="block font-medium">${t('image.searchLabel')}</label>
          <input id="img-q" name="q" value="${query}" class="mt-2 block w-full" placeholder="${t('image.placeholder')}">
        </div>
        ${raw(sourceSelect(plan))}
        <button type="submit" class="${plan.imageChoice?.kind === 'option' ? 'btn btn-ghost' : 'btn'}">${t('image.search')}</button>
      </form>
      ${offerNone ? raw(html`<form method="post" action="/posts/${plan.postId}/image/none">${raw(hidden(plan))}<button type="submit" class="btn btn-ghost">${t('image.applyWithout')}</button></form>`) : ''}
    </div>`;
}

import { ideaId, type IdeaHistory, type LowCtrWithPost, type OpportunityWithPost, type SavedIdeas, type SearchScanned } from '../../orchestrator/ideas.js';
import { bareUrl, type SnippetPlan } from '../../orchestrator/snippet.js';
import { followUpLine } from './snippet.js';
import { currentLocale, t } from '../../i18n/index.js';
import { html, raw } from '../html.js';
import { layout } from './layout.js';
import { emptyState, pageHeader, timeTag } from './ui.js';

export interface IdeasOpts {
  gscConfigured: boolean;
  opportunities: OpportunityWithPost[] | null;
  gscError?: string;
  search?: { at: string; scanned: SearchScanned; lowCtr: LowCtrWithPost[] } | null;
  ideas: SavedIdeas | null;
  history?: IdeaHistory;
  /** Saved title/description proposals, by bareUrl() of the page. */
  snippets?: Map<string, SnippetPlan>;
  generated?: boolean;
}

const newPostHref = (title: string, topic: string, idea?: string) => `/posts/new?${new URLSearchParams({ title, topic, ...(idea ? { idea } : {}) }).toString()}`;
const pct = (n: number) => `${(n * 100).toLocaleString(currentLocale(), { maximumFractionDigits: 1 })} %`;
const num = (n: number) => n.toLocaleString(currentLocale());

function scannedLine(scanned: SearchScanned | null | undefined): string {
  if (!scanned) return '';
  const parts = (['google', 'bing'] as const)
    .filter((e) => scanned[e] !== null)
    .map((e) => t(`ideas.gsc.scanned.${e}`, { count: scanned[e]! }));
  return parts.length ? t('ideas.gsc.scanned.line', { parts: parts.join(', ') }) : '';
}

function searchSection(o: IdeasOpts): string {
  const refresh = o.gscConfigured
    ? html`<form method="post" action="/ideas/refresh" data-busy="${t('ideas.gsc.refreshing')}" class="shrink-0">
        <button type="submit" class="btn btn-ghost btn-sm">${t('ideas.gsc.refresh')}</button>
      </form>`
    : '';
  const updated = o.search ? raw(` ${t('ideas.gsc.updatedAt', { time: timeTag(o.search.at) })}`) : '';
  const heading = html`<div class="mb-4 flex flex-wrap items-start justify-between gap-3 sm:flex-nowrap">
      <div class="min-w-0 flex-1">
        <h2 id="gsc-title" class="section-heading !mb-1">${t('ideas.gsc.title')}</h2>
        <p class="!m-0 text-sm text-muted">${t('ideas.gsc.intro')}${updated}</p>
      </div>
      ${raw(refresh)}
    </div>`;
  if (!o.gscConfigured) {
    return html`<section class="card mb-6 p-4 sm:p-5" aria-labelledby="gsc-title">${raw(heading)}${raw(emptyState({ title: t('ideas.gsc.notConfigured'), body: t('ideas.gsc.notConfiguredBody'), action: { href: '/settings#g-gsc', label: t('ideas.gsc.configure') } }))}</section>`;
  }
  if (o.gscError) {
    return html`<section class="card mb-6 p-4 sm:p-5" aria-labelledby="gsc-title">${raw(heading)}<p class="text-err" role="alert">${t('ideas.gsc.error', { error: o.gscError })}</p></section>`;
  }
  const list = o.opportunities ?? [];
  const rows = list
    .map(
      (op) => html`<tr>
        <td class="font-medium">${op.query}</td>
        <td class="text-right tabular-nums">${num(op.impressions)}</td>
        <td class="text-right tabular-nums">${num(op.clicks)}</td>
        <td class="text-right tabular-nums">${op.position.toFixed(1)}</td>
        <td class="whitespace-nowrap">${raw(op.sources.map((src) => html`<span class="badge badge-neutral">${t(`ideas.gsc.${src}`)}</span>`).join(' '))}</td>
        <td class="text-sm">${!op.page ? raw(html`<span class="text-muted">${t('ideas.gsc.onlyBing')}</span>`) : op.postTitle ? raw(html`<a href="${op.page}" target="_blank" rel="noopener noreferrer">${op.postTitle}</a><span class="block text-xs text-muted">${t('ideas.gsc.improveHint')}</span>`) : raw(html`<span class="text-muted [overflow-wrap:anywhere]">${op.page}</span>`)}</td>
        <td class="text-right"><a class="btn btn-ghost btn-sm whitespace-nowrap" href="${newPostHref(op.query.charAt(0).toUpperCase() + op.query.slice(1), t('ideas.gsc.topicFromQuery', { query: op.query }))}">${t('ideas.write')}</a></td>
      </tr>`,
    )
    .join('');
  return html`<section class="card mb-6 p-4 sm:p-5" aria-labelledby="gsc-title">
    ${raw(heading)}
    ${raw(
      list.length === 0
        ? emptyState({ title: t('ideas.gsc.none'), body: [scannedLine(o.search?.scanned), t('ideas.gsc.noneBody')].filter(Boolean).join(' ') })
        : html`<div class="overflow-x-auto"><table class="data-table">
            <thead><tr><th>${t('ideas.gsc.cols.query')}</th><th class="text-right">${t('ideas.gsc.cols.impressions')}</th><th class="text-right">${t('ideas.gsc.cols.clicks')}</th><th class="text-right">${t('ideas.gsc.cols.position')}</th><th>${t('ideas.gsc.cols.source')}</th><th>${t('ideas.gsc.cols.page')}</th><th><span class="sr-only">${t('ideas.gsc.cols.action')}</span></th></tr></thead>
            <tbody>${raw(rows)}</tbody>
          </table></div>`,
    )}
    <p class="!mb-0 mt-3 text-xs text-muted">${t('ideas.gsc.footnote')}</p>
  </section>`;
}

function ideaCard(i: SavedIdeas['ideas'][number], used: IdeaHistory['used'][number] | undefined): string {
  const id = ideaId(i.title);
  const action = used
    ? html`<span class="badge badge-ok">${t('ideas.ai.used')}</span> <a class="text-sm" href="/posts/${used.postId}">${t('ideas.ai.openDraft')}</a>`
    : html`<a class="btn btn-sm" href="${newPostHref(i.title, i.topic, id)}">${t('ideas.ai.create')}</a>
        <form method="post" action="/ideas/${id}/dismiss" class="inline"><button type="submit" class="btn btn-ghost btn-sm" aria-label="${t('ideas.ai.dismissLabel', { title: i.title })}">${t('ideas.ai.dismiss')}</button></form>`;
  return html`<li class="card flex flex-col gap-2 p-4">
    <h3 class="m-0 text-base">${i.title}</h3>
    <p class="m-0 text-sm">${i.topic}</p>
    <p class="m-0 text-sm text-muted">${i.why}</p>
    ${i.query ? raw(html`<p class="m-0 text-xs"><span class="badge badge-info">${t('ideas.ai.fromSearch')}</span> ${i.query}</p>`) : ''}
    ${i.related.length ? raw(html`<p class="m-0 text-xs text-muted">${t('ideas.ai.related', { posts: i.related.join(' · ') })}</p>`) : ''}
    <div class="mt-auto flex flex-wrap items-center gap-2 pt-2">${raw(action)}</div>
  </li>`;
}

function ideasSection(o: IdeasOpts): string {
  const saved = o.ideas;
  const history = o.history ?? { dismissed: [], used: [] };
  const dismissedIds = new Set(history.dismissed.map((d) => d.id));
  const usedById = new Map(history.used.map((u) => [u.id, u]));
  const all = saved?.ideas ?? [];
  const visible = all.filter((i) => !dismissedIds.has(ideaId(i.title)));
  const hidden = all.filter((i) => dismissedIds.has(ideaId(i.title)));
  const cards = visible.map((i) => ideaCard(i, usedById.get(ideaId(i.title)))).join('');
  const dismissedList = hidden.length
    ? html`<details class="mt-4 text-sm">
        <summary class="cursor-pointer text-muted">${t('ideas.ai.dismissedCount', { count: hidden.length })}</summary>
        <ul class="mt-2 grid gap-1 pl-4">${raw(
          hidden
            .map((i) => html`<li class="flex flex-wrap items-center gap-2"><span>${i.title}</span><form method="post" action="/ideas/${ideaId(i.title)}/restore" class="inline"><button type="submit" class="btn btn-ghost btn-sm">${t('ideas.ai.restore')}</button></form></li>`)
            .join(''),
        )}</ul>
        <p class="mt-2 text-xs text-muted">${t('ideas.ai.dismissedHint')}</p>
      </details>`
    : '';
  const grid = visible.length
    ? html`<ul class="m-0 grid list-none gap-4 p-0 md:grid-cols-2 xl:grid-cols-3">${raw(cards)}</ul>`
    : html`<div class="card p-4">${raw(emptyState({ title: saved ? t('ideas.ai.allDismissed') : t('ideas.ai.empty'), body: t('ideas.ai.emptyBody') }))}</div>`;
  return html`<section class="mb-6" aria-labelledby="ai-ideas-title">
    <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id="ai-ideas-title" class="section-heading !mb-1">${t('ideas.ai.title')}</h2>
        <p class="!m-0 text-sm text-muted">${t(o.gscConfigured ? 'ideas.ai.introGsc' : 'ideas.ai.intro')}${saved ? raw(` · ${t('ideas.ai.generatedAt', { time: timeTag(saved.at) })}`) : ''}</p>
      </div>
      <form method="post" action="/ideas/generate" data-busy="${t('ideas.ai.busy')}">
        <button type="submit" class="btn">${saved ? t('ideas.ai.again') : t('ideas.ai.generate')}</button>
      </form>
    </div>
    ${raw(grid)}
    ${raw(dismissedList)}
  </section>`;
}

function snippetAction(r: LowCtrWithPost, saved: SnippetPlan | undefined): string {
  if (saved) {
    return html`<a class="btn btn-ghost btn-sm whitespace-nowrap" href="/ideas/snippet/${saved.postId}">${saved.applied ? t('ideas.ctr.applied') : t('ideas.ctr.view')}</a>`;
  }
  return html`<form method="post" action="/ideas/snippet" data-busy="${t('snippet.busy')}">
    <input type="hidden" name="page" value="${r.page}">
    <input type="hidden" name="query" value="${r.query}">
    <input type="hidden" name="position" value="${String(r.position)}">
    <input type="hidden" name="ctr" value="${String(r.ctr)}">
    <button type="submit" class="btn btn-ghost btn-sm whitespace-nowrap">${t('ideas.ctr.suggest')}</button>
  </form>`;
}

function appliedList(o: IdeasOpts): string {
  const applied = [...(o.snippets?.values() ?? [])].filter((p) => p.applied).sort((a, b) => b.applied!.at.localeCompare(a.applied!.at));
  if (!applied.length) return '';
  return html`<h3 class="mb-2 mt-5 text-sm font-semibold">${t('ideas.ctr.appliedTitle')}</h3>
    <ul class="m-0 grid list-none gap-2 p-0">${raw(
      applied
        .map((p) => html`<li class="text-sm"><a href="/ideas/snippet/${p.postId}" class="font-medium">${p.title}</a> <span class="text-muted">«${p.query}»</span><br>${raw(followUpLine(p))}</li>`)
        .join(''),
    )}</ul>`;
}

function lowCtrSection(o: IdeasOpts): string {
  const list = o.search?.lowCtr ?? [];
  if (!o.gscConfigured || o.gscError || !o.search || o.search.scanned.google === null) return '';
  const rows = list
    .map(
      (r) => html`<tr>
        <td class="font-medium">${r.query}</td>
        <td class="text-right tabular-nums">${num(r.impressions)}</td>
        <td class="text-right tabular-nums">${r.position.toFixed(1)}</td>
        <td class="text-right tabular-nums whitespace-nowrap">${pct(r.ctr)} <span class="text-xs text-muted">/ ${pct(r.expectedCtr)}</span></td>
        <td class="text-sm"><a href="${r.page}" target="_blank" rel="noopener noreferrer" class="[overflow-wrap:anywhere]">${r.postTitle ?? r.page}</a></td>
        <td class="text-right">${raw(snippetAction(r, o.snippets?.get(bareUrl(r.page))))}</td>
      </tr>`,
    )
    .join('');
  return html`<section class="card mb-6 p-4 sm:p-5" aria-labelledby="ctr-title">
    <h2 id="ctr-title" class="section-heading !mb-1">${t('ideas.ctr.title')}</h2>
    <p class="!mt-0 mb-4 text-sm text-muted">${t('ideas.ctr.intro')}</p>
    ${raw(
      list.length === 0
        ? emptyState({ title: t('ideas.ctr.none'), body: t('ideas.ctr.noneBody') })
        : html`<div class="overflow-x-auto"><table class="data-table">
            <thead><tr><th>${t('ideas.gsc.cols.query')}</th><th class="text-right">${t('ideas.gsc.cols.impressions')}</th><th class="text-right">${t('ideas.gsc.cols.position')}</th><th class="text-right">${t('ideas.ctr.cols.ctr')}</th><th>${t('ideas.gsc.cols.page')}</th><th><span class="sr-only">${t('ideas.gsc.cols.action')}</span></th></tr></thead>
            <tbody>${raw(rows)}</tbody>
          </table></div>`,
    )}
    ${raw(appliedList(o))}
    <p class="!mb-0 mt-3 text-xs text-muted">${t('ideas.ctr.footnote')}</p>
  </section>`;
}

export function ideasPage(o: IdeasOpts): string {
  const body = html`
    ${raw(pageHeader({ title: t('ideas.title'), meta: t('ideas.meta') }))}
    ${raw(ideasSection(o))}
    ${raw(searchSection(o))}
    ${raw(lowCtrSection(o))}`;
  return layout({ title: t('ideas.title'), bodyHtml: body, section: 'ideas' });
}

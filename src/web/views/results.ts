import { currentLocale, t } from '../../i18n/index.js';
import { change, type Metrics, type PostResult, type ResultsCache } from '../../research/results.js';
import { html, raw } from '../html.js';
import { layout } from './layout.js';
import { chip, emptyState, flash, pageHeader, timeTag } from './ui.js';

export type ResultsScope = 'panel' | 'all';
export type ResultsSort = 'clicks' | 'change' | 'impressions';

const num = (n: number) => Math.round(n).toLocaleString();
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const ctr = (m: Metrics) => (m.impressions ? m.clicks / m.impressions : 0);
/** "25 sept" from "2026-09-25", in the interface language. */
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(currentLocale(), { day: 'numeric', month: 'short', timeZone: 'UTC' });
const periodText = (c: ResultsCache) => t('results.period', { from: shortDay(c.current.start), to: shortDay(c.current.end), pfrom: shortDay(c.previous.start), pto: shortDay(c.previous.end) });

/** Position: the change in places ("+0.3" = further down, worse), not a percentage. */
function positionDelta(now: number, before: number): string {
  const d = now - before;
  if (Math.abs(d) < 0.05) return html`<span class="text-xs text-muted">=</span>`;
  return html`<span class="text-xs font-medium ${d < 0 ? 'text-ok' : 'text-err'}">${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}</span>`;
}

/** "▲ 35%" / "▼ 12%" / "new". */
function delta(now: number, before: number): string {
  if (!now && !before) return '';
  if (!before) return html`<span class="text-xs font-medium text-ok">${t('results.new')}</span>`;
  const c = change(now, before)!;
  if (Math.abs(c) < 0.005) return html`<span class="text-xs text-muted">=</span>`;
  return html`<span class="text-xs font-medium ${c > 0 ? 'text-ok' : 'text-err'}"><span aria-hidden="true">${c > 0 ? '▲' : '▼'}</span> ${Math.round(Math.abs(c) * 100)}%</span>`;
}

/** Clicks per week as a small line, with a mark where the panel changed the post. */
export function sparkline(r: PostResult, o: { width?: number; height?: number; fluid?: boolean } = {}): string {
  const w = o.width ?? 120;
  const h = o.height ?? 30;
  const values = r.weekly.map((x) => x.clicks);
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const y = (v: number) => (h - 3 - (v / max) * (h - 6)).toFixed(1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${y(v)}`).join(' ');
  const first = Date.parse(`${r.weekly[0]?.start ?? ''}T00:00:00Z`);
  const marks = r.appliedAt
    .map((at) => Math.floor((Date.parse(at) - first) / (7 * 86400_000)))
    .filter((i) => i >= 0 && i < values.length)
    .map((i) => html`<line x1="${(i * step).toFixed(1)}" x2="${(i * step).toFixed(1)}" y1="0" y2="${h}" class="stroke-warn" stroke-width="1.5" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"><title>${t('results.appliedMark')}</title></line>`)
    .join('');
  return html`<svg viewBox="0 0 ${w} ${h}" ${raw(o.fluid ? 'preserveAspectRatio="none" class="h-28 w-full overflow-visible"' : `width="${w}" height="${h}" class="overflow-visible"`)} role="img" aria-label="${t('results.trendAlt', { values: values.join(', ') })}">
    ${raw(marks)}<polyline points="${points}" fill="none" class="stroke-accent" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"></polyline>
  </svg>`;
}

function kpi(label: string, value: string, d: string): string {
  return html`<div class="card p-4"><p class="m-0 text-xs font-medium uppercase tracking-wide text-muted">${label}</p>
    <p class="m-0 mt-1 flex flex-wrap items-baseline gap-2"><span class="text-2xl font-semibold tabular-nums">${value}</span>${raw(d)}</p></div>`;
}

function totals(posts: PostResult[]) {
  const sum = (pick: (p: PostResult) => Metrics) =>
    posts.reduce((a, p) => {
      const m = pick(p);
      return { clicks: a.clicks + m.clicks, impressions: a.impressions + m.impressions, posSum: a.posSum + m.position * m.impressions };
    }, { clicks: 0, impressions: 0, posSum: 0 });
  const c = sum((p) => p.current);
  const p = sum((x) => x.previous);
  return {
    current: { clicks: c.clicks, impressions: c.impressions, position: c.impressions ? c.posSum / c.impressions : 0 },
    previous: { clicks: p.clicks, impressions: p.impressions, position: p.impressions ? p.posSum / p.impressions : 0 },
  };
}

function sorted(posts: PostResult[], sort: ResultsSort): PostResult[] {
  const by = {
    clicks: (a: PostResult, b: PostResult) => b.current.clicks - a.current.clicks || b.current.impressions - a.current.impressions,
    impressions: (a: PostResult, b: PostResult) => b.current.impressions - a.current.impressions,
    // Biggest movers first, either way (absolute change in clicks).
    change: (a: PostResult, b: PostResult) => Math.abs(b.current.clicks - b.previous.clicks) - Math.abs(a.current.clicks - a.previous.clicks),
  }[sort];
  return [...posts].sort(by);
}

function row(r: PostResult): string {
  const touched = r.appliedAt.length > 0;
  return html`<tr>
    <td class="min-w-56">
      <a href="/results/${r.postId}" class="font-medium">${r.title}</a>
      <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        ${r.publishedAt ? raw(t('results.published', { time: timeTag(r.publishedAt) })) : ''}
        <a href="${r.url}" target="_blank" rel="noopener noreferrer">${t('results.view')}<span class="sr-only"> (${t('common.footer.newTab')})</span></a>
        ${touched ? raw(html`<span class="badge badge-info">${t('results.touched')}</span>`) : ''}
      </div>
    </td>
    <td class="whitespace-nowrap text-right tabular-nums">${num(r.current.clicks)}<div>${raw(delta(r.current.clicks, r.previous.clicks))}</div></td>
    <td class="whitespace-nowrap text-right tabular-nums max-sm:hidden">${num(r.current.impressions)}<div>${raw(delta(r.current.impressions, r.previous.impressions))}</div></td>
    <td class="whitespace-nowrap text-right tabular-nums max-md:hidden">${r.current.impressions ? pct(ctr(r.current)) : '—'}</td>
    <td class="whitespace-nowrap text-right tabular-nums max-md:hidden">${r.current.impressions ? r.current.position.toFixed(1) : '—'}<div>${raw(r.current.impressions && r.previous.impressions ? positionDelta(r.current.position, r.previous.position) : '')}</div></td>
    <td class="max-sm:hidden">${raw(sparkline(r))}</td>
  </tr>`;
}

export interface ResultsPageOpts {
  configured: boolean;
  cache: ResultsCache | null;
  scope?: ResultsScope;
  sort?: ResultsSort;
  error?: string;
}

export function resultsPage(o: ResultsPageOpts): string {
  const refresh = html`<form method="post" action="/results/refresh" data-busy="${t('results.refreshing')}"><button type="submit" class="btn">${t('results.refresh')}</button></form>`;
  const c = o.cache;
  const sourceLabel = c ? t(`results.sources.${c.sources.length > 1 ? 'both' : (c.sources[0] ?? 'google')}`) : '';
  const meta = c
    ? html`${sourceLabel} · ${periodText(c)} · ${raw(t('results.updated', { time: timeTag(c.at) }))}`
    : t('results.intro');
  const header = pageHeader({ title: t('results.title'), meta, actions: o.configured ? refresh : '' });

  if (!o.configured) {
    return layout({ title: t('results.title'), section: 'results', bodyHtml: header + emptyState({ title: t('results.notConfigured'), body: t('results.notConfiguredBody'), action: { href: '/settings#g-gsc', label: t('results.configure') } }) });
  }
  if (!c) {
    return layout({ title: t('results.title'), section: 'results', bodyHtml: header + (o.error ? flash(o.error, 'err') : '') + emptyState({ title: t('results.empty'), body: t('results.emptyBody') }) });
  }

  const panelPosts = c.posts.filter((p) => p.appliedAt.length);
  const scope: ResultsScope = o.scope ?? (panelPosts.length ? 'panel' : 'all');
  const sort: ResultsSort = o.sort ?? 'clicks';
  const posts = scope === 'panel' ? panelPosts : c.posts;
  const tot = totals(posts);
  const href = (s: ResultsScope, so: ResultsSort) => `/results?scope=${s}&sort=${so}`;

  const kpis = html`<div class="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    ${raw(kpi(t('results.kpi.clicks'), num(tot.current.clicks), delta(tot.current.clicks, tot.previous.clicks)))}
    ${raw(kpi(t('results.kpi.impressions'), num(tot.current.impressions), delta(tot.current.impressions, tot.previous.impressions)))}
    ${raw(kpi(t('results.kpi.ctr'), tot.current.impressions ? pct(ctr(tot.current)) : '—', tot.current.impressions && tot.previous.impressions ? delta(ctr(tot.current), ctr(tot.previous)) : ''))}
    ${raw(kpi(t('results.kpi.position'), tot.current.impressions ? tot.current.position.toFixed(1) : '—', tot.current.impressions && tot.previous.impressions ? positionDelta(tot.current.position, tot.previous.position) : ''))}
  </div>`;

  const filters = html`<div class="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
    <nav class="flex flex-wrap items-center gap-2" aria-label="${t('results.scope.label')}">
      ${raw(chip(t('results.scope.panel'), href('panel', sort), scope === 'panel', panelPosts.length))}
      ${raw(chip(t('results.scope.all'), href('all', sort), scope === 'all', c.posts.length))}
    </nav>
    <nav class="flex flex-wrap items-center gap-2" aria-label="${t('results.sort.label')}">
      <span class="text-sm text-muted">${t('results.sort.label')}:</span>
      ${raw((['clicks', 'change', 'impressions'] as const).map((so) => chip(t(`results.sort.${so}`), href(scope, so), sort === so)).join(''))}
    </nav>
  </div>`;

  const table = posts.length
    ? html`<div class="overflow-x-auto"><table class="data-table">
        <thead><tr>
          <th scope="col">${t('results.cols.post')}</th>
          <th scope="col" class="text-right">${t('results.cols.clicks')}</th>
          <th scope="col" class="text-right max-sm:hidden">${t('results.cols.impressions')}</th>
          <th scope="col" class="text-right max-md:hidden">${t('results.cols.ctr')}</th>
          <th scope="col" class="text-right max-md:hidden">${t('results.cols.position')}</th>
          <th scope="col" class="max-sm:hidden">${t('results.cols.trend')}</th>
        </tr></thead>
        <tbody>${raw(sorted(posts, sort).map(row).join(''))}</tbody>
      </table></div>`
    : scope === 'panel'
      ? emptyState({ title: t('results.panelEmpty'), body: t('results.panelEmptyBody'), action: { href: href('all', sort), label: t('results.scope.all') } })
      : emptyState({ title: t('results.noPosts') });

  const notes = [
    c.unpublished ? t('results.unpublished', { count: c.unpublished }) : '',
    t('results.lag'),
    c.sources.includes('google') ? '' : t('results.queriesGoogleOnly'),
  ].filter(Boolean);

  const body = html`${raw(header)}${raw(o.error ? flash(o.error, 'err') : '')}${raw(kpis)}${raw(filters)}${raw(table)}
    <ul class="mt-6 list-none p-0 text-xs text-muted">${raw(notes.map((n) => html`<li class="mt-1">${n}</li>`).join(''))}</ul>`;
  return layout({ title: t('results.title'), section: 'results', bodyHtml: body });
}

/** One published post: its numbers, the trend with the panel's changes marked, and its top queries. */
export function postResultsPage(r: PostResult, cache: ResultsCache): string {
  const queries = r.queries.length
    ? html`<ul class="m-0 list-none p-0">${raw(r.queries.map((q) => html`<li class="flex justify-between gap-3 border-b border-line py-2 text-sm last:border-b-0"><span>${q.query}</span><span class="whitespace-nowrap text-xs text-muted tabular-nums">${t('results.post.queryLine', { clicks: num(q.clicks), impressions: num(q.impressions), position: q.position.toFixed(1) })}</span></li>`).join(''))}</ul>`
    : html`<p class="m-0 text-sm text-muted">${cache.sources.includes('google') ? t('results.post.noQueries') : t('results.queriesGoogleOnly')}</p>`;
  const changes = r.appliedAt.length
    ? html`<p class="m-0 mt-2 text-xs text-muted"><span class="mr-1 inline-block h-3 border-l-2 border-dashed border-warn align-middle" aria-hidden="true"></span>${t('results.post.changes', { dates: r.appliedAt.map((d) => shortDay(d.slice(0, 10))).join(', ') })}</p>`
    : '';
  const body = html`
    ${raw(pageHeader({
      back: { href: '/results', label: t('results.title') },
      title: r.title,
      meta: html`${r.publishedAt ? raw(t('results.published', { time: timeTag(r.publishedAt) })) : ''} · <a href="${r.url}" target="_blank" rel="noopener noreferrer">${t('results.view')}<span class="sr-only"> (${t('common.footer.newTab')})</span></a> · ${periodText(cache)}`,
    }))}
    <div class="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      ${raw(kpi(t('results.kpi.clicks'), num(r.current.clicks), delta(r.current.clicks, r.previous.clicks)))}
      ${raw(kpi(t('results.kpi.impressions'), num(r.current.impressions), delta(r.current.impressions, r.previous.impressions)))}
      ${raw(kpi(t('results.kpi.ctr'), r.current.impressions ? pct(ctr(r.current)) : '—', r.current.impressions && r.previous.impressions ? delta(ctr(r.current), ctr(r.previous)) : ''))}
      ${raw(kpi(t('results.kpi.position'), r.current.impressions ? r.current.position.toFixed(1) : '—', r.current.impressions && r.previous.impressions ? positionDelta(r.current.position, r.previous.position) : ''))}
    </div>
    <div class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section class="card min-w-0 p-4 sm:p-5" aria-labelledby="trend-h">
        <h2 id="trend-h" class="section-heading !mb-3">${t('results.post.trend')}</h2>
        <div class="w-full">${raw(sparkline(r, { width: 640, height: 120, fluid: true }))}</div>
        <p class="m-0 mt-2 flex justify-between text-xs text-muted"><span>${shortDay(r.weekly[0]?.start ?? cache.current.start)}</span><span>${shortDay(r.weekly.at(-1)?.start ?? cache.current.end)}</span></p>
        ${raw(changes)}
      </section>
      <section class="card min-w-0 p-4 sm:p-5" aria-labelledby="queries-h">
        <h2 id="queries-h" class="section-heading !mb-3">${t('results.post.queries')}</h2>
        ${raw(queries)}
      </section>
    </div>`;
  return layout({ title: r.title, section: 'results', bodyHtml: body });
}

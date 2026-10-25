import { t } from '../../i18n/index.js';
import type { UsageReport, UserUsage } from '../../agents/usage.js';
import { html, raw } from '../html.js';
import { formatTokens } from './format.js';
import { layout } from './layout.js';
import { chip, emptyState, pageHeader, timeTag } from './ui.js';

export const COST_PERIODS = [7, 30, 90] as const;

const usd = (n: number) => `$${n < 10 ? n.toFixed(n && n < 0.01 ? 4 : 2) : n.toFixed(0)}`;

function delta(now: number, before: number): string {
  if (!before) return '';
  const c = (now - before) / before;
  if (Math.abs(c) < 0.005) return html`<span class="text-xs text-muted">=</span>`;
  // More spend is not "good": up is shown as a warning colour, not green.
  return html`<span class="text-xs font-medium ${c > 0 ? 'text-warn' : 'text-muted'}"><span aria-hidden="true">${c > 0 ? '▲' : '▼'}</span> ${Math.round(Math.abs(c) * 100)}%</span>`;
}

function kpi(label: string, value: string, extra = ''): string {
  return html`<div class="card p-4"><p class="m-0 text-xs font-medium uppercase tracking-wide text-muted">${label}</p>
    <p class="m-0 mt-1 flex flex-wrap items-baseline gap-2"><span class="text-2xl font-semibold tabular-nums">${value}</span>${raw(extra)}</p></div>`;
}

/** Daily spend as bars. */
function bars(values: number[], label: string): string {
  const w = 120;
  const h = 28;
  const max = Math.max(...values, 0);
  const bw = w / values.length;
  const rects = values
    .map((v, i) => {
      const bh = max ? Math.max(v ? 1.5 : 0, (v / max) * h) : 0;
      return html`<rect x="${(i * bw + bw * 0.15).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${bh.toFixed(1)}" rx="1" class="fill-accent"></rect>`;
    })
    .join('');
  return html`<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${label}">${raw(rects)}</svg>`;
}

const name = (u: { actor: string | null }) => u.actor ?? t('costs.automatic');

function breakdown(title: string, rows: Array<{ label: string; usd: number; tokens: number }>, total: number): string {
  return html`<div class="min-w-0"><h3 class="m-0 mb-1 text-xs font-semibold uppercase tracking-wide text-muted">${title}</h3>
    <ul class="m-0 list-none p-0">${raw(
      rows
        .map((r) => {
          const pct = total ? (r.usd / total) * 100 : 0;
          return html`<li class="py-1"><div class="flex justify-between gap-3 text-sm"><span class="truncate">${r.label}</span><span class="whitespace-nowrap tabular-nums text-muted">${usd(r.usd)} · ${formatTokens(r.tokens)} tok</span></div>
            <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2" aria-hidden="true"><div class="h-full rounded-full bg-accent" style="width:${pct.toFixed(1)}%"></div></div></li>`;
        })
        .join(''),
    )}</ul></div>`;
}

function userRow(u: UserUsage, i: number, total: number, cap: number, spent24h: number | null): string {
  const share = total ? (u.usd / total) * 100 : 0;
  const capInfo = cap && u.actor ? html`<div class="text-xs ${spent24h !== null && spent24h >= cap ? 'font-semibold text-err' : 'text-muted'}">${t('costs.cap24h', { spent: usd(spent24h ?? 0), limit: usd(cap) })}</div>` : '';
  const detailId = `cost-user-${i}`;
  return html`<tr>
    <td class="min-w-44">
      <button type="button" class="flex items-center gap-2 text-left" aria-expanded="false" aria-controls="${detailId}" data-toggle-row>
        <span class="avatar h-7 w-7 shrink-0 text-xs" aria-hidden="true">${u.actor ? u.actor.slice(0, 1).toUpperCase() : '⚙'}</span>
        <span><span class="font-medium ${u.actor ? '' : 'italic'}">${name(u)}</span> <span class="text-xs text-muted" aria-hidden="true" data-toggle-icon>▸</span>${raw(capInfo)}</span>
      </button>
    </td>
    <td class="whitespace-nowrap text-right tabular-nums"><strong>${usd(u.usd)}</strong><div>${raw(delta(u.usd, u.previousUsd))}</div></td>
    <td class="whitespace-nowrap text-right tabular-nums max-sm:hidden">${formatTokens(u.tokensIn)} / ${formatTokens(u.tokensOut)}</td>
    <td class="whitespace-nowrap text-right tabular-nums max-md:hidden">${u.calls}</td>
    <td class="min-w-24 max-md:hidden"><div class="flex items-center gap-2"><div class="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2" aria-hidden="true"><div class="h-full rounded-full bg-accent" style="width:${share.toFixed(1)}%"></div></div><span class="text-xs tabular-nums text-muted">${Math.round(share)}%</span></div></td>
    <td class="max-sm:hidden">${raw(bars(u.daily, t('costs.dailyAlt', { name: name(u) })))}</td>
  </tr>
  <tr id="${detailId}" hidden><td colspan="6" class="bg-panel-2/40">
    <div class="grid gap-6 py-2 sm:grid-cols-2">
      ${raw(breakdown(t('costs.byAgent'), u.byAgent.map((a) => ({ label: t(`settings.cost.agents.${a.agent}`), usd: a.usd, tokens: a.tokens })), u.usd))}
      ${raw(breakdown(t('costs.byModel'), u.byModel.map((m) => ({ label: m.model, usd: m.usd, tokens: m.tokens })), u.usd))}
    </div>
    ${u.unpriced ? raw(html`<p class="m-0 mt-2 text-xs text-muted">${t('costs.unpriced', { count: u.unpriced })}</p>`) : ''}
  </td></tr>`;
}

export interface CostsPageOpts {
  report: UsageReport;
  /** AI_USER_DAILY_BUDGET_USD (0 = none) and each user's last 24 h. */
  userCap: number;
  spent24h: Map<string, number>;
  /** Overall daily cap (0 = none). */
  dailyCap: number;
}

export function costsPage(o: CostsPageOpts): string {
  const r = o.report;
  const header = pageHeader({ back: { href: '/settings#s-cost', label: t('settings.title') }, title: t('costs.title'), meta: t('costs.intro') });
  const periods = html`<nav class="mb-4 flex flex-wrap items-center gap-2" aria-label="${t('costs.period')}">${raw(COST_PERIODS.map((d) => chip(t('costs.days', { count: d }), `/settings/costs?days=${d}`, r.days === d)).join(''))}</nav>`;
  if (!r.firstAt) {
    return layout({ title: t('costs.title'), section: 'settings', bodyHtml: header + emptyState({ title: t('costs.empty'), body: t('costs.emptyBody') }) });
  }
  const perDay = r.total.usd / r.days;
  const caps = [
    o.dailyCap ? t('costs.capOverall', { limit: usd(o.dailyCap) }) : t('costs.capOverallNone'),
    o.userCap ? t('costs.capUser', { limit: usd(o.userCap) }) : t('costs.capUserNone'),
  ];
  const kpis = html`<div class="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    ${raw(kpi(t('costs.kpi.spend'), usd(r.total.usd), delta(r.total.usd, r.total.previousUsd)))}
    ${raw(kpi(t('costs.kpi.tokens'), `${formatTokens(r.total.tokensIn)} / ${formatTokens(r.total.tokensOut)}`, html`<span class="text-xs text-muted">${t('costs.inOut')}</span>`))}
    ${raw(kpi(t('costs.kpi.calls'), String(r.total.calls)))}
    ${raw(kpi(t('costs.kpi.month'), usd(perDay * 30), html`<span class="text-xs text-muted">${t('costs.perDay', { value: usd(perDay) })}</span>`))}
  </div>`;
  const users = r.users.length
    ? html`<section class="mb-8" aria-labelledby="costs-users-h">
        <h2 id="costs-users-h" class="section-heading">${t('costs.users')}</h2>
        <div class="overflow-x-auto"><table class="data-table">
          <thead><tr>
            <th scope="col">${t('costs.cols.user')}</th>
            <th scope="col" class="text-right">${t('costs.cols.spend')}</th>
            <th scope="col" class="text-right max-sm:hidden">${t('costs.cols.tokens')}</th>
            <th scope="col" class="text-right max-md:hidden">${t('costs.cols.calls')}</th>
            <th scope="col" class="max-md:hidden">${t('costs.cols.share')}</th>
            <th scope="col" class="max-sm:hidden">${t('costs.cols.daily')}</th>
          </tr></thead>
          <tbody>${raw(r.users.map((u, i) => userRow(u, i, r.total.usd, o.userCap, u.actor ? (o.spent24h.get(u.actor.toLowerCase()) ?? 0) : null)).join(''))}</tbody>
        </table></div>
        <p class="m-0 mt-2 text-xs text-muted">${t('costs.expand')}</p>
      </section>`
    : emptyState({ title: t('costs.noneInPeriod') });
  const posts = r.topPosts.length
    ? html`<section aria-labelledby="costs-posts-h">
        <h2 id="costs-posts-h" class="section-heading">${t('costs.posts')}</h2>
        <div class="overflow-x-auto"><table class="data-table">
          <thead><tr><th scope="col">${t('costs.cols.post')}</th><th scope="col" class="text-right">${t('costs.cols.spend')}</th><th scope="col" class="text-right max-sm:hidden">${t('costs.cols.tokensTotal')}</th><th scope="col">${t('costs.cols.by')}</th></tr></thead>
          <tbody>${raw(
            r.topPosts
              .map((p) => html`<tr><td><a href="/posts/${p.postId}">${p.title ?? p.postId}</a></td><td class="whitespace-nowrap text-right tabular-nums">${usd(p.usd)}</td><td class="whitespace-nowrap text-right tabular-nums max-sm:hidden">${formatTokens(p.tokens)}</td><td class="text-sm">${p.actors.length ? p.actors.join(', ') : raw(html`<span class="italic text-muted">${t('costs.automatic')}</span>`)}</td></tr>`)
              .join(''),
          )}</tbody>
        </table></div>
      </section>`
    : '';
  const body = html`${raw(header)}${raw(periods)}${raw(kpis)}${raw(users)}${raw(posts)}
    <ul class="mt-6 list-none p-0 text-xs text-muted">
      <li class="mt-1">${caps.join(' · ')}</li>
      <li class="mt-1">${raw(t('costs.since', { time: timeTag(r.firstAt) }))}</li>
    </ul>`;
  return layout({ title: t('costs.title'), section: 'settings', bodyHtml: body });
}

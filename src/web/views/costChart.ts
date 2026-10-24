import type { DailyCost } from '../../db/repo.js';
import { currentLocale, t } from '../../i18n/index.js';
import { html, raw } from '../html.js';
import { formatUsd } from './format.js';

function dayLabel(day: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  return new Intl.DateTimeFormat(currentLocale(), { ...opts, timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

/**
 * Spend per day as bars (plain HTML/CSS, no chart library). The bars are
 * decorative for screen readers: the same numbers go in an sr-only table.
 * The daily cap, if set, is drawn as a dashed line.
 */
export function costChart(days: DailyCost[], budgetLimit: number | null): string {
  if (days.length === 0) return '';
  const total = days.reduce((sum, d) => sum + d.usd, 0);
  const peak = days.reduce((a, b) => (b.usd > a.usd ? b : a));
  if (total === 0) {
    return html`<p class="mb-3 text-sm text-muted">${t('settings.cost.chart.empty', { count: days.length })}</p>`;
  }
  const scale = Math.max(peak.usd, budgetLimit ?? 0);
  // Each day is a full-height column, so hover works over the whole slot and
  // not just the bar. The tooltip is pure CSS (instant, no native title delay).
  const cols = days
    .map((d, i) => {
      const pct = d.usd > 0 ? Math.max(2, (d.usd / scale) * 100) : 1;
      const align = i < 4 ? 'left-0' : i > days.length - 5 ? 'right-0' : 'left-1/2 -translate-x-1/2';
      return html`<div class="chart-col group relative flex h-full flex-1 items-end justify-center min-w-0 rounded-sm hover:bg-line/40">
        <div class="w-[70%] rounded-t-sm ${d.usd > 0 ? 'bg-accent group-hover:brightness-125' : 'bg-line'}" style="height:${pct.toFixed(2)}%"></div>
        <div class="pointer-events-none invisible absolute bottom-full ${align} z-20 mb-1 whitespace-nowrap rounded border border-line bg-bg px-2 py-1 text-xs shadow group-hover:visible">
          <span class="font-medium">${dayLabel(d.day)}</span> · <span class="tabular-nums">${formatUsd(d.usd)}</span> · ${t('settings.cost.runs', { count: d.runs })}
        </div>
      </div>`;
    })
    .join('');
  const cap =
    budgetLimit
      ? html`<div class="pointer-events-none absolute inset-x-0 border-t border-dashed border-warn" style="bottom:${((budgetLimit / scale) * 100).toFixed(2)}%"></div>`
      : '';
  const rows = days
    .filter((d) => d.runs > 0)
    .map((d) => html`<tr><td>${dayLabel(d.day, { day: 'numeric', month: 'long' })}</td><td>${formatUsd(d.usd)}</td><td>${d.runs}</td></tr>`)
    .join('');

  return html`<figure class="mb-4 mt-0">
    <figcaption class="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
      <span class="font-medium">${t('settings.cost.chart.title', { count: days.length })}</span>
      <span class="text-muted tabular-nums">${t('settings.cost.chart.summary', { total: formatUsd(total), peak: formatUsd(peak.usd), day: dayLabel(peak.day) })}</span>
    </figcaption>
    <div class="relative flex h-24 w-full items-end" aria-hidden="true">${raw(cols)}${raw(cap)}</div>
    <div class="mt-1 flex justify-between text-xs text-muted" aria-hidden="true">
      <span>${dayLabel(days[0]!.day)}</span>
      ${budgetLimit ? raw(html`<span class="text-warn">${t('settings.cost.chart.cap', { limit: formatUsd(budgetLimit) })}</span>`) : ''}
      <span>${t('settings.cost.chart.today')}</span>
    </div>
    <table class="sr-only">
      <caption>${t('settings.cost.chart.title', { count: days.length })}</caption>
      <thead><tr><th scope="col">${t('settings.cost.chart.colDay')}</th><th scope="col">${t('settings.cost.chart.colCost')}</th><th scope="col">${t('settings.cost.chart.colRuns')}</th></tr></thead>
      <tbody>${raw(rows)}</tbody>
    </table>
  </figure>`;
}

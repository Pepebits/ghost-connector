import { checkQuality, qualityInputFromPlan, type QualityReport } from '../../review/quality.js';
import type { RunArtifact } from '../../types.js';

export { qualityInputFromPlan };
import { fixableProblems } from '../../orchestrator/fixQuality.js';
import { html, raw } from '../html.js';
import { t } from '../../i18n/index.js';

function scoreTone(score: number): string {
  return score >= 80 ? 'text-ok' : score >= 50 ? 'text-warn' : 'text-err';
}

/** Side panel with the score and the list of checks (✓ / ⚠). */
export function qualityPanel(report: QualityReport, action = ''): string {
  const items = report.checks
    .map(
      (c) => html`<li class="flex gap-2 py-1">
        <span aria-hidden="true" class="${c.ok ? 'text-ok' : 'text-warn'}">${c.ok ? '✓' : '⚠'}</span>
        <span><span class="sr-only">${c.ok ? t('quality.ok') : t('quality.review')}</span><strong class="font-medium">${t(`quality.checks.${c.id}`)}</strong><br /><span class="text-xs text-muted">${t(`quality.details.${c.detailKey}`, c.vars)}</span></span>
      </li>`,
    )
    .join('');
  return html`<div class="card p-3.5">
    <div class="flex items-baseline justify-between">
      <h3 class="m-0 text-sm">${t('quality.title')}</h3>
      <span class="text-2xl font-bold tabular-nums ${scoreTone(report.score)}">${report.score}<span class="text-sm font-normal text-muted">/100</span></span>
    </div>
    <ul class="mt-2 text-sm">${raw(items)}</ul>
    ${raw(action)}
  </div>`;
}

/** With `withFix`, a "Fix with AI" button when some warning can be fixed in the text. */
export function qualityPanelFor(plan: RunArtifact, withFix = false): string {
  const fixable = withFix ? fixableProblems(plan).length : 0;
  const action = fixable
    ? html`<form method="post" action="/posts/${plan.postId}/plan/fix" class="mt-3 border-t border-line pt-3" data-busy="${t('quality.fixBusy')}">
        <input type="hidden" name="runId" value="${plan.runId}">
        <button type="submit" class="btn btn-sm w-full">${t('quality.fix', { count: fixable })}</button>
        <p class="!mb-0 mt-1.5 text-xs text-muted">${t('quality.fixHint')}</p>
      </form>`
    : '';
  return qualityPanel(checkQuality(qualityInputFromPlan(plan)), action);
}

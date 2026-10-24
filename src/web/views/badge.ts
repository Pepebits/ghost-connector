import type { JobState } from '../../db/jobs.js';
import type { PostStateKind } from '../../state/postState.js';
import { t } from '../../i18n/index.js';
import { html } from '../html.js';

const KINDS: PostStateKind[] = ['never-planned', 'planned', 'plan-stale', 'applied', 'applied-degraded', 'has-pending', 'blocked', 'failed'];

export function kindLabel(kind: PostStateKind): string {
  return t(`badge.kind.${kind}`);
}

/** Labels translated on read (the language can change at runtime). */
export const KIND_LABELS = Object.defineProperties(
  {},
  Object.fromEntries(KINDS.map((k) => [k, { get: () => kindLabel(k), enumerable: true }])),
) as Readonly<Record<PostStateKind, string>>;

type Tone = 'neutral' | 'info' | 'ok' | 'warn' | 'err';

const KIND_TONES: Record<PostStateKind, Tone> = {
  'never-planned': 'neutral',
  planned: 'info',
  'plan-stale': 'warn',
  applied: 'ok',
  'applied-degraded': 'warn',
  'has-pending': 'info',
  blocked: 'err',
  failed: 'err',
};

export function badge(kind: PostStateKind): string {
  return html`<span class="badge badge-${KIND_TONES[kind]}">${KIND_LABELS[kind]}</span>`;
}

const JOB_STATE_TONES: Record<JobState, Tone> = {
  queued: 'neutral',
  running: 'info',
  cancelling: 'warn',
  cancelled: 'neutral',
  done: 'ok',
  error: 'err',
  interrupted: 'err',
};

export function jobStateBadge(state: JobState): string {
  return html`<span class="badge badge-${JOB_STATE_TONES[state]}">${t(`badge.jobState.${state}`)}</span>`;
}

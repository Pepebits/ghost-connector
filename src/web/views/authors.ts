import { t } from '../../i18n/index.js';
import type { StaffMember } from '../../ghost/staff.js';
import { html, raw } from '../html.js';

/**
 * Picks one or more Ghost authors: a checkbox per person and a radio for the
 * primary one (Ghost shows the first author as the post's byline).
 */
export function authorPicker(o: { id: string; staff: StaffMember[]; selected: string[]; legend?: string; hint?: string }): string {
  const primary = o.selected[0];
  const rows = o.staff
    .map((s) => {
      const on = o.selected.includes(s.id);
      return html`<li class="flex items-center justify-between gap-3 py-1.5">
        <label class="flex min-w-0 items-center gap-2"><input type="checkbox" name="authors" value="${s.id}" ${on ? raw('checked') : ''} data-author-check><span class="truncate">${s.name}</span></label>
        <label class="flex shrink-0 items-center gap-1.5 text-xs text-muted"><input type="radio" name="primary" value="${s.id}" ${s.id === primary ? raw('checked') : ''} ${on ? '' : raw('disabled')} data-author-primary><span>${t('authors.primary')}<span class="sr-only">: ${s.name}</span></span></label>
      </li>`;
    })
    .join('');
  return html`<fieldset id="${o.id}" class="m-0 min-w-0 border-0 p-0" data-author-picker>
    <legend class="font-medium">${o.legend ?? t('authors.legend')}</legend>
    ${o.hint ? raw(html`<p class="m-0 mt-1 text-sm text-muted">${o.hint}</p>`) : ''}
    <ul class="m-0 mt-2 max-h-64 list-none divide-y divide-line overflow-y-auto rounded-md border border-line px-3 py-0">${raw(rows)}</ul>
  </fieldset>`;
}

/** "Ana (principal), Luis" from ids, with unknown ids (deactivated staff) kept as such. */
export function authorNames(ids: string[], staff: StaffMember[]): string {
  const name = new Map(staff.map((s) => [s.id, s.name]));
  return ids.map((id) => name.get(id) ?? t('authors.unknown')).join(', ');
}

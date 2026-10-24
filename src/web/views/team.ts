import { t } from '../../i18n/index.js';
import type { Assignment, PostNote } from '../../team/store.js';
import { html, raw } from '../html.js';
import { confirmDialog, timeTag } from './ui.js';

export interface PostTeam {
  me: { username: string; admin: boolean };
  /** Every panel user (the assignment picker only shows with more than one). */
  users: string[];
  assignee: Assignment | null;
  notes: PostNote[];
  others: string[];
  plannedBy: { by: string | null; at: string } | null;
}

const names = (list: string[]) => list.join(', ');

/** "Ana also has this post open" (refreshed by detail.js every minute). */
export function presenceBanner(others: string[]): string {
  if (!others.length) return '';
  return html`<div class="flash flash-warn" role="status"><strong>${t('post.team.presence', { count: others.length, names: names(others) })}</strong> ${t('post.team.presenceHint')}</div>`;
}

/** Assignment picker + who launched the latest plan, under the header. */
export function teamStrip(postId: string, team: PostTeam): string {
  const planned = team.plannedBy?.by ? raw(t('post.team.plannedBy', { name: team.plannedBy.by, time: timeTag(team.plannedBy.at) })) : '';
  if (team.users.length < 2) return planned ? html`<p class="mb-3 text-sm text-muted">${planned}</p>` : '';
  const current = team.assignee?.username.toLowerCase();
  const options = [
    html`<option value="">${t('post.team.nobody')}</option>`,
    ...team.users.map((u) => html`<option value="${u}" ${u.toLowerCase() === current ? raw('selected') : ''}>${u.toLowerCase() === team.me.username.toLowerCase() ? t('post.team.me', { name: u }) : u}</option>`),
  ].join('');
  return html`<div class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
    <form method="post" action="/posts/${postId}/assign" class="m-0 flex flex-wrap items-center gap-2">
      <label for="assignee" class="font-medium">${t('post.team.assignee')}</label>
      <select id="assignee" name="username">${raw(options)}</select>
      <button type="submit" class="btn btn-ghost">${t('post.team.save')}</button>
    </form>
    ${planned ? raw(html`<span class="text-muted">${planned}</span>`) : ''}
  </div>`;
}

export function notesTab(postId: string, team: PostTeam): string {
  const items = team.notes
    .map((n) => {
      const mine = n.author?.toLowerCase() === team.me.username.toLowerCase();
      const canDelete = mine || team.me.admin;
      return html`<li class="border-b border-line py-3 last:border-b-0">
        <div class="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span><strong>${n.author ?? t('post.team.notes.unknown')}</strong> <span class="text-xs text-muted">${raw(timeTag(n.at))}</span></span>
          ${canDelete ? raw(html`<button type="button" class="btn btn-ghost btn-sm" data-open-dialog="note-del-${n.id}">${t('post.team.notes.delete')}</button>${raw(confirmDialog({ id: `note-del-${n.id}`, title: t('post.team.notes.deleteConfirm'), confirmLabel: t('post.team.notes.delete'), danger: true, action: `/posts/${postId}/notes/${n.id}/delete` }))}`) : ''}
        </div>
        <p class="!mb-0 mt-1 whitespace-pre-wrap break-words text-sm">${n.text}</p>
      </li>`;
    })
    .join('');
  return html`<div class="max-w-3xl">
    <p class="text-sm text-muted">${t('post.team.notes.intro')}</p>
    ${raw(team.notes.length ? html`<ul class="card m-0 mb-4 list-none px-4 py-1">${raw(items)}</ul>` : html`<p class="text-sm">${t('post.team.notes.empty')}</p>`)}
    <form method="post" action="/posts/${postId}/notes" class="grid gap-2">
      <label for="note-text" class="font-medium">${t('post.team.notes.label')}</label>
      <textarea id="note-text" name="text" rows="3" maxlength="2000" required class="block w-full"></textarea>
      <div><button type="submit" class="btn btn-sm">${t('post.team.notes.add')}</button></div>
    </form>
  </div>`;
}

export function notesLabel(team: PostTeam): string {
  return team.notes.length ? t('post.team.notes.tabCount', { count: team.notes.length }) : t('post.team.notes.tab');
}

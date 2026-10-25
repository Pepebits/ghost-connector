import { escapeHtml, html, raw } from '../html.js';
import { t } from '../../i18n/index.js';
import { layout } from './layout.js';
import { flash, pageHeader } from './ui.js';

export interface NewPostValues {
  title?: string;
  topic?: string;
  sources?: string;
  instructions?: string;
  /** Id of the idea (/ideas) it comes from: marked as used once the draft exists. */
  idea?: string;
}

function field(opts: { id: string; label: string; optional?: boolean; hint: string; control: string }): string {
  return html`<div>
    <label for="${opts.id}" class="block font-medium">${opts.label}${raw(opts.optional ? html` <span class="font-normal text-muted">${t('newPost.optional')}</span>` : '')}</label>
    <p id="${opts.id}-hint" class="mt-0.5 text-sm text-muted">${opts.hint}</p>
    ${raw(opts.control)}
  </div>`;
}

/** "New post" page: creates an empty draft in Ghost from a topic and plans it. */
export function newPostPage(opts: { values?: NewPostValues; error?: string; ghostUrl: string } ): string {
  const v = opts.values ?? {};
  const error = opts.error
    ? flash(opts.error, 'err')
    : '';
  const body = html`
    ${raw(pageHeader({ back: { href: '/', label: t('dashboard.title') }, title: t('newPost.title'), meta: t('newPost.intro') }))}
    ${raw(error)}
    <div class="grid gap-8 lg:grid-cols-[minmax(0,48rem)_minmax(0,1fr)]">
      <form method="post" action="/posts/new" class="grid content-start gap-6" data-guard data-busy="${t('newPost.busy')}">
        ${raw(v.idea ? html`<input type="hidden" name="idea" value="${v.idea}">` : '')}
        ${raw(
          field({
            id: 'np-topic',
            label: t('newPost.topic.label'),
            hint: t('newPost.topic.hint'),
            control: html`<textarea id="np-topic" name="topic" required rows="3" aria-describedby="np-topic-hint" class="mt-2 block w-full" data-autogrow placeholder="${t('newPost.topic.placeholder')}">${v.topic ?? ''}</textarea>`,
          }),
        )}
        ${raw(
          field({
            id: 'np-title',
            label: t('newPost.postTitle.label'),
            optional: true,
            hint: t('newPost.postTitle.hint'),
            control: html`<input id="np-title" name="title" maxlength="255" value="${v.title ?? ''}" aria-describedby="np-title-hint" class="mt-2 block w-full">`,
          }),
        )}
        ${raw(
          field({
            id: 'np-sources',
            label: t('newPost.sources.label'),
            optional: true,
            hint: t('newPost.sources.hint'),
            control: html`<textarea id="np-sources" name="sources" rows="4" aria-describedby="np-sources-hint" class="mt-2 block w-full" data-autogrow data-url-count placeholder="https://github.com/pepebits">${v.sources ?? ''}</textarea>
              <p class="mt-2 text-sm text-muted" data-url-count-out aria-live="polite"></p>`,
          }),
        )}
        ${raw(
          field({
            id: 'np-instructions',
            label: t('newPost.instructions.label'),
            optional: true,
            hint: t('newPost.instructions.hint'),
            control: html`<textarea id="np-instructions" name="instructions" rows="3" aria-describedby="np-instructions-hint" class="mt-2 block w-full" data-autogrow>${v.instructions ?? ''}</textarea>`,
          }),
        )}
        <div class="flex flex-wrap items-center gap-3">
          <button type="submit" class="btn">${t('newPost.submit')}</button>
          <a href="/" class="btn btn-ghost">${t('common.actions.cancel')}</a>
        </div>
      </form>
      <aside class="card h-fit p-5 text-sm" aria-labelledby="np-steps">
        <h2 id="np-steps" class="mb-3 text-base font-semibold">${t('newPost.steps.title')}</h2>
        <ol class="m-0 grid list-decimal gap-2.5 pl-5 text-muted marker:text-fg">
          <li>${raw(t('newPost.steps.create', { url: escapeHtml(opts.ghostUrl) }))}</li>
          <li>${t('newPost.steps.read')}</li>
          <li>${t('newPost.steps.write')}</li>
          <li>${raw(t('newPost.steps.review'))}</li>
        </ol>
        <p class="mb-0 mt-4 text-muted">${t('newPost.steps.note')}</p>
      </aside>
    </div>
    <script src="/detail.js" defer data-cfasync="false"></script>`;
  return layout({ title: t('newPost.title'), bodyHtml: body, section: 'dashboard' });
}

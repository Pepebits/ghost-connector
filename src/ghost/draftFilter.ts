/**
 * The drafts filter is Ghost NQL. So that a badly written filter (or one without
 * `status:draft`) never returns published posts, every listing wraps it
 * in `status:draft+(...)`. The modes are only a UI aid.
 */
export type DraftFilterMode = 'all' | 'tag' | 'not-tag' | 'custom';

const TAG_SLUG = /^[a-z0-9][a-z0-9-]*$/;

export function draftsOnly(filter: string): string {
  const f = filter.trim();
  if (!f || f === 'status:draft') return 'status:draft';
  return `status:draft+(${f})`;
}

/** Recognizes the filters the selector generates; anything else is "advanced". */
export function parseDraftFilter(filter: string): { mode: DraftFilterMode; tag: string } {
  const f = filter.trim();
  if (f === '' || f === 'status:draft') return { mode: 'all', tag: '' };
  const m = /^status:draft\+tag:(-?)([a-z0-9][a-z0-9-]*)$/.exec(f);
  if (m) return { mode: m[1] ? 'not-tag' : 'tag', tag: m[2]! };
  return { mode: 'custom', tag: '' };
}

export function buildDraftFilter(mode: DraftFilterMode, tag: string, custom = ''): string {
  const slug = tag.trim().toLowerCase();
  if (mode === 'all') return 'status:draft';
  if ((mode === 'tag' || mode === 'not-tag') && TAG_SLUG.test(slug)) return `status:draft+tag:${mode === 'not-tag' ? '-' : ''}${slug}`;
  return custom.trim() || 'status:draft';
}

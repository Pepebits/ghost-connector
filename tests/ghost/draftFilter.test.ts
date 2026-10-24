import { describe, expect, it } from 'vitest';
import { buildDraftFilter, draftsOnly, parseDraftFilter } from '../../src/ghost/draftFilter.js';

describe('ghost/draftFilter', () => {
  it('any filter is limited to drafts (never published)', () => {
    expect(draftsOnly('status:draft')).toBe('status:draft');
    expect(draftsOnly('')).toBe('status:draft');
    expect(draftsOnly('tag:news')).toBe('status:draft+(tag:news)');
    expect(draftsOnly('status:published')).toBe('status:draft+(status:published)');
    expect(draftsOnly('status:draft,status:published')).toBe('status:draft+(status:draft,status:published)');
  });

  it('recognizes the picker filters and treats the rest as advanced', () => {
    expect(parseDraftFilter('status:draft')).toEqual({ mode: 'all', tag: '' });
    expect(parseDraftFilter('status:draft+tag:hash-connector-test')).toEqual({ mode: 'tag', tag: 'hash-connector-test' });
    expect(parseDraftFilter('status:draft+tag:-hash-old')).toEqual({ mode: 'not-tag', tag: 'hash-old' });
    expect(parseDraftFilter('status:draft+tag:[a,b]').mode).toBe('custom');
  });

  it('builds the NQL and drops invalid slugs', () => {
    expect(buildDraftFilter('tag', 'Revisar')).toBe('status:draft+tag:revisar');
    expect(buildDraftFilter('not-tag', 'hash-old')).toBe('status:draft+tag:-hash-old');
    expect(buildDraftFilter('tag', 'a,b')).toBe('status:draft');
    expect(buildDraftFilter('custom', '', 'tag:[a,b]')).toBe('tag:[a,b]');
  });
});

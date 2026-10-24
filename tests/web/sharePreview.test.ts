import { describe, expect, it } from 'vitest';
import type { RunArtifact } from '../../src/types.js';
import { sharePreview } from '../../src/web/views/sharePreview.js';

const plan = (patch: Partial<RunArtifact['patch']>, feature: string | null = null) =>
  ({
    postId: 'p', status: 'planned', imageChoice: undefined,
    patch: { status: 'draft', ...patch },
    snapshot: { title: 'Viejo', slug: 'viejo', url: 'https://blog.test/p/uuid/', meta_title: null, meta_description: null, og_title: null, og_description: null, custom_excerpt: null, feature_image: feature },
  }) as unknown as RunArtifact;

describe('sharePreview', () => {
  it('shows what applying would set, escaped, with the site host and the new slug', () => {
    const out = sharePreview(plan({ title: 'Nuevo <b>', slug: 'nuevo', meta_title: 'Meta <i>', meta_description: 'Desc' }));
    expect(out).toContain('blog.test › nuevo');
    expect(out).toContain('Meta &lt;i&gt;');
    expect(out).not.toContain('<i>');
    expect(out).toMatch(/Sin imagen|No image/);
  });

  it('cuts long titles like Google does (about 60 characters)', () => {
    const out = sharePreview(plan({ meta_title: 'x'.repeat(80) }, 'https://blog.test/a.jpg'));
    expect(out).toContain(`${'x'.repeat(59)}…`);
    expect(out).toContain('src="https://blog.test/a.jpg"');
  });
});

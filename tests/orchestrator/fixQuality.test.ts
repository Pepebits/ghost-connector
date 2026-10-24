import { describe, expect, it, vi } from 'vitest';
import type { RunArtifact } from '../../src/types.js';

const calls: Array<{ problems: string[]; markdown: string }> = [];
const longText = Array.from({ length: 4 }, (_, i) => `## Sección ${i + 1}\n\n${'palabra '.repeat(240)}`).join('\n\n');
vi.mock('../../src/agents/fix.agent.js', () => ({
  fixQuality: vi.fn(async (input: { problems: string[]; markdown: string }) => {
    calls.push(input);
    return {
      data: { title: 'Huerto urbano en el balcón', markdown: `${longText}\n\n[[PENDING: ¿cuántas macetas?]]`, meta_title: 'Huerto urbano', meta_description: 'x'.repeat(100), changes_made: ['Amplía el texto'] },
      usage: { inputTokens: 10, outputTokens: 5, cacheHitTokens: 0, cacheMissTokens: 10, model: 'm', usd: 0.002 },
    };
  }),
}));

const { fixPlanQuality, fixableProblems } = await import('../../src/orchestrator/fixQuality.js');
const { findLatestArtifact } = await import('../../src/review/store.js');

function plan(): RunArtifact {
  return {
    runId: 'run-fix-1', postId: 'post-fix-1', postTitle: 'Post', createdAt: '2026-01-01T00:00:00.000Z',
    snapshot: {
      id: 'post-fix-1', uuid: 'u', slug: 's', title: 'Post', html: '', lexical: null, custom_excerpt: null, feature_image: 'https://img.test/a.jpg', feature_image_alt: null,
      feature_image_caption: null, meta_title: null, meta_description: null, og_title: null, og_description: null, twitter_title: null,
      twitter_description: null, tags: [], authors: [], status: 'draft', updated_at: '2026-01-01T00:00:00.000Z', created_at: '2026-01-01T00:00:00.000Z', url: 'https://example.test/s/',
    },
    writer: { title: 'Post', markdown: '# Titulo\n\nTexto corto.\n\n[[PENDING: ¿cuántas macetas?]]', outline: [], summary: '', language: 'es', changes_made: [], confidence: 'high' },
    seo: null, imagePlan: null, uploadedImage: null, patch: { status: 'draft' },
    cost: { inputTokens: 0, outputTokens: 0, usd: 0 }, errors: [], status: 'planned',
  };
}

describe('orchestrator/fixQuality', () => {
  it('only sends the AI what is fixable in the text (no pending markers or image)', () => {
    const problems = fixableProblems(plan());
    expect(problems.map((p) => p.split(':')[0])).toEqual(['Length', 'Structure']);
  });

  it('fixes the plan text, saves it and adds the cost', async () => {
    const { artifact } = await fixPlanQuality(plan());
    expect(calls[0]!.markdown).toContain('Texto corto.');
    expect(artifact.writer!.title).toBe('Huerto urbano en el balcón');
    expect(artifact.cost.usd).toBeCloseTo(0.002);
    expect(fixableProblems(artifact)).toEqual([]);
    expect((await findLatestArtifact('post-fix-1'))?.writer?.markdown).toContain('## Sección 1');
  });
});

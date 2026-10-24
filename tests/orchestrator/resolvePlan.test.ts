import { describe, expect, it, vi } from 'vitest';
import type { RunArtifact } from '../../src/types.js';

const calls: unknown[] = [];
vi.mock('../../src/agents/resolve.agent.js', () => ({
  resolvePending: vi.fn(async (input: unknown) => {
    calls.push(input);
    return {
      data: { markdown: 'Lucía fundó la empresa en Valencia.\n\n[[PENDING: dices que el equipo es pequeño, ¿cuántas personas son?]]', unresolved: [], changes_made: [] },
      usage: { inputTokens: 10, outputTokens: 5, cacheHitTokens: 0, cacheMissTokens: 10, model: 'm', usd: 0.001 },
    };
  }),
}));

const { resolvePlan } = await import('../../src/orchestrator/resolveFlow.js');
const { findLatestArtifact } = await import('../../src/review/store.js');

function plan(answers?: RunArtifact['answers']): RunArtifact {
  return {
    runId: 'run-res-1', postId: 'post-res-1', postTitle: 'Post', createdAt: '2026-01-01T00:00:00.000Z',
    snapshot: {
      id: 'post-res-1', uuid: 'u', slug: 's', title: 'Post', html: '', lexical: null, custom_excerpt: null, feature_image: null, feature_image_alt: null,
      feature_image_caption: null, meta_title: null, meta_description: null, og_title: null, og_description: null, twitter_title: null,
      twitter_description: null, tags: [], authors: [], status: 'draft', updated_at: '2026-01-01T00:00:00.000Z', created_at: '2026-01-01T00:00:00.000Z', url: 'https://example.test/s/',
    },
    writer: { title: 'Post', markdown: 'Intro.\n\n[[PENDING: ¿cómo empezó Lucía?]]', outline: [], summary: '', language: 'es', changes_made: [], confidence: 'high' },
    seo: null, imagePlan: null, uploadedImage: null, patch: { status: 'draft' },
    cost: { inputTokens: 0, outputTokens: 0, usd: 0 }, errors: [], status: 'planned', answers,
  };
}

describe('orchestrator/resolvePlan', () => {
  it('saves the answer, adds the cost and keeps the follow-up question', async () => {
    await resolvePlan(plan(), [{ question: '¿cómo empezó Lucía?', answer: 'Fundó la empresa en Valencia; el equipo es pequeño' }]);
    const saved = await findLatestArtifact('post-res-1');
    expect(saved?.answers).toEqual([expect.objectContaining({ question: '¿cómo empezó Lucía?', answer: 'Fundó la empresa en Valencia; el equipo es pequeño' })]);
    expect(saved?.writer?.markdown).toContain('¿cuántas personas son?');
    expect(saved?.cost.inputTokens).toBe(10);
  });

  it('corrections reach the resolver with the previous answer and replace the saved one', async () => {
    calls.length = 0;
    const p = plan([{ question: '¿cómo empezó Lucía?', answer: 'En Valencia', at: '2026-01-01T00:00:00.000Z' }]);
    await resolvePlan(p, [], [{ question: '¿cómo empezó Lucía?', answer: 'En Alicante' }]);
    expect(calls[0]).toMatchObject({ corrections: [{ question: '¿cómo empezó Lucía?', previous: 'En Valencia', answer: 'En Alicante' }] });
    expect((await findLatestArtifact('post-res-1'))?.answers?.[0]?.answer).toBe('En Alicante');
  });

  it('an unchanged correction is not sent', async () => {
    calls.length = 0;
    await resolvePlan(plan([{ question: 'q', answer: 'igual', at: '' }]), [], [{ question: 'q', answer: 'igual' }]);
    expect(calls[0]).toMatchObject({ corrections: [] });
  });
});

import { describe, expect, it } from 'vitest';
import { addUsage } from '../../src/agents/costAdd.js';
import { getCostByAgent, upsertArtifactIndex } from '../../src/db/repo.js';
import type { RunArtifact } from '../../src/types.js';

const art = (runId: string, cost: RunArtifact['cost']) =>
  ({ runId, postId: `p-${runId}`, postTitle: 'T', createdAt: '2026-01-01T00:00:00.000Z', status: 'planned', snapshot: { html: '' }, writer: null, seo: null, imagePlan: null, errors: [], cost }) as unknown as RunArtifact;

describe('cost per agent', () => {
  it('addUsage sums into the total and into its agent', () => {
    const c = addUsage({ inputTokens: 1, outputTokens: 1, usd: 0.01, byAgent: { writer: 0.01 } }, { inputTokens: 2, outputTokens: 3, cacheHitTokens: 0, cacheMissTokens: 2, model: 'm', usd: 0.002 }, 'fix');
    expect(c).toMatchObject({ inputTokens: 3, outputTokens: 4, byAgent: { writer: 0.01, fix: 0.002 } });
    expect(c.usd).toBeCloseTo(0.012);
  });

  it('adds up per agent, with older plans (and their pre-breakdown spend) as "unknown"', () => {
    upsertArtifactIndex(art('ca-1', { inputTokens: 0, outputTokens: 0, usd: 0.03, byAgent: { writer: 0.02, seo: 0.01 } }));
    upsertArtifactIndex(art('ca-2', { inputTokens: 0, outputTokens: 0, usd: 0.05 }));
    upsertArtifactIndex(art('ca-3', { inputTokens: 0, outputTokens: 0, usd: 0.04, byAgent: { fix: 0.01 } }));
    const by = Object.fromEntries(getCostByAgent().map((r) => [r.agent, r.usd]));
    expect(by.writer).toBeCloseTo(0.02);
    expect(by.fix).toBeCloseTo(0.01);
    expect(by.unknown).toBeGreaterThanOrEqual(0.08 - 1e-9);
  });
});

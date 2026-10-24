import { describe, expect, it } from 'vitest';
import { computePostState } from '../../src/state/postState.js';
import type { DraftSnapshot, RunArtifact, WriterOutput } from '../../src/types.js';

function makeDraft(overrides: Partial<DraftSnapshot> = {}): DraftSnapshot {
  return {
    id: 'post-1',
    uuid: 'uuid-1',
    slug: 'post-1',
    title: 'Titulo de prueba',
    html: '<p>hola mundo</p>',
    lexical: null,
    custom_excerpt: null,
    feature_image: null,
    feature_image_alt: null,
    feature_image_caption: null,
    meta_title: null,
    meta_description: null,
    og_title: null,
    og_description: null,
    twitter_title: null,
    twitter_description: null,
    tags: [],
    authors: [],
    status: 'draft',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    url: 'https://example.test/post-1/',
    ...overrides,
  };
}

function makeWriter(markdown = 'a'.repeat(250)): WriterOutput {
  return { title: 'x', markdown, outline: [], summary: '', language: 'es', changes_made: [], confidence: 'high' };
}

function makeArtifact(overrides: Partial<RunArtifact> = {}): RunArtifact {
  return {
    runId: 'run-1',
    postId: 'post-1',
    postTitle: 'Titulo de prueba',
    createdAt: '2026-01-01T00:00:00.000Z',
    snapshot: makeDraft(),
    writer: null,
    seo: null,
    imagePlan: null,
    uploadedImage: null,
    patch: { status: 'draft' },
    cost: { inputTokens: 0, outputTokens: 0, usd: 0 },
    errors: [],
    status: 'planned',
    ...overrides,
  };
}

describe('state/postState computePostState', () => {
  it('never-planned: no local artifact and no #ai-processed tag', () => {
    const state = computePostState(makeDraft(), null);
    expect(state.kind).toBe('never-planned');
  });

  it('applied (inferred from the tag): no artifact, but has #ai-processed', () => {
    const draft = makeDraft({ tags: [{ id: 't1', name: '#ai-processed', slug: 'hash-ai-processed' }] });
    const state = computePostState(draft, null);
    expect(state.kind).toBe('applied');
  });

  it('planned: there is a current plan (updated_at matches the snapshot)', () => {
    const draft = makeDraft();
    const artifact = makeArtifact({ snapshot: draft, writer: makeWriter(), status: 'planned' });
    const state = computePostState(draft, artifact);
    expect(state.kind).toBe('planned');
    expect(state.actions.canApply).toBe(true);
  });

  it('plan-stale: the post changed in Ghost since the plan was generated', () => {
    const planSnapshot = makeDraft();
    const liveDraft = makeDraft({ updated_at: '2026-02-01T00:00:00.000Z' });
    const artifact = makeArtifact({ snapshot: planSnapshot, writer: makeWriter(), status: 'planned' });
    const state = computePostState(liveDraft, artifact);
    expect(state.kind).toBe('plan-stale');
  });

  it('has-pending: applied but the LIVE content still has [[PENDING:]]', () => {
    const draft = makeDraft({ html: '<p>[[PENDING: falta algo]]</p>' });
    const artifact = makeArtifact({ snapshot: draft, writer: makeWriter(), status: 'applied' });
    const state = computePostState(draft, artifact);
    expect(state.kind).toBe('has-pending');
    expect(state.live.pendingQuestions).toEqual(['falta algo']);
    expect(state.actions.canResolve).toBe(true);
  });

  it('blocked: the last apply attempt ended in conflict', () => {
    const draft = makeDraft();
    const artifact = makeArtifact({ snapshot: draft, writer: makeWriter(), status: 'conflict' });
    const state = computePostState(draft, artifact);
    expect(state.kind).toBe('blocked');
  });

  it('failed: the writer failed (no WriterOutput)', () => {
    const draft = makeDraft();
    const artifact = makeArtifact({ snapshot: draft, writer: null, status: 'failed' });
    const state = computePostState(draft, artifact);
    expect(state.kind).toBe('failed');
  });

  it('applied-degraded: applied, no live pending markers, but the last run had errors', () => {
    const draft = makeDraft();
    const artifact = makeArtifact({
      snapshot: draft,
      writer: makeWriter(),
      status: 'applied',
      errors: [{ stage: 'seo', message: 'fallo de ejemplo' }],
    });
    const state = computePostState(draft, artifact);
    expect(state.kind).toBe('applied-degraded');
    expect(state.issues.some((i) => i.code === 'agent-error-seo')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { buildUserPrompt } from '../../src/agents/ideas.agent.js';

describe('agents/ideas prompt', () => {
  it('incluye extractos solo de los posts recientes, en una linea y recortados', () => {
    const posts = Array.from({ length: 62 }, (_, i) => ({ title: `Post ${i}`, excerpt: `Linea\nsegunda ${'x'.repeat(300)}` }));
    const text = buildUserPrompt({ posts, queries: [], drafts: ['Borrador A'], avoid: ['Idea vieja'] });
    expect(text).toContain('- Post 0 — Linea segunda x');
    expect(text).toContain('- Post 61\n');
    expect(text).not.toMatch(/x{200}/);
    expect(text).toContain('BORRADORES EN CURSO');
    expect(text).toContain('- Idea vieja');
  });
});

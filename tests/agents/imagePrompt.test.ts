import { describe, expect, it, vi } from 'vitest';

const runAgent = vi.fn(async (opts: { user: string }) => ({ data: opts.user, usage: {} }));
vi.mock('../../src/agents/runner.js', () => ({ runAgent }));

describe('image agent prompt', () => {
  it('tells the agent the post language, so the alt text is written in it', async () => {
    const { planImage } = await import('../../src/agents/image.agent.js');
    const base = { title: 'Accessible forms', summary: 's', existingFeatureImage: null, tags: [] };
    expect(String((await planImage({ ...base, language: 'en' })).data)).toMatch(/^IDIOMA DEL POST: .*alt_text en inglés/);
    expect(String((await planImage({ ...base, language: 'es' })).data)).toMatch(/^IDIOMA DEL POST: .*alt_text en español/);
  });
});

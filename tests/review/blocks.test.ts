import { describe, expect, it } from 'vitest';
import { applyDecisions, changeCount, diffBlocks, diffWords, htmlToMarkdown, planHunks, splitBlocks } from '../../src/review/blocks.js';

describe('review/blocks', () => {
  const before = splitBlocks('## Intro\n\nPrimer parrafo.\n\nSegundo parrafo.\n\n```js\nconst a = 1;\n```');
  const after = splitBlocks('## Intro\n\nPrimer parrafo **mejorado**.\n\nSegundo parrafo.\n\nParrafo nuevo.\n\n```js\nconst a = 1;\n```');

  it('splits into top-level blocks with their type', () => {
    expect(before.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'paragraph', 'code']);
  });

  it('groups differences into hunks and leaves unchanged parts as is', () => {
    const hunks = diffBlocks(before, after);
    expect(hunks.map((h) => h.type)).toEqual(['equal', 'change', 'equal', 'change', 'equal']);
    expect(changeCount(hunks)).toBe(2);
  });

  it('ignores formatting-only changes when comparing', () => {
    const hunks = diffBlocks(splitBlocks('Hola   mundo.'), splitBlocks('**Hola** mundo.'));
    expect(hunks.map((h) => h.type)).toEqual(['equal']);
  });

  it('accepting all reproduces the writer output; rejecting all, the original', () => {
    const hunks = diffBlocks(before, after);
    expect(applyDecisions(hunks, [true, true])).toBe(after.map((b) => b.markdown).join('\n\n'));
    expect(applyDecisions(hunks, [false, false])).toBe(before.map((b) => b.markdown).join('\n\n'));
  });

  it('merges per-hunk decisions', () => {
    const hunks = diffBlocks(before, after);
    const md = applyDecisions(hunks, [false, true]);
    expect(md).toContain('Primer parrafo.');
    expect(md).not.toContain('mejorado');
    expect(md).toContain('Parrafo nuevo.');
  });

  it('converts Ghost HTML to comparable Markdown', () => {
    expect(htmlToMarkdown('<h2>Titulo</h2><p>Texto con <strong>negrita</strong>.</p>')).toBe('## Titulo\n\nTexto con **negrita**.');
    const hunks = planHunks('<h2>Titulo</h2><p>Texto.</p>', '## Titulo\n\nTexto.\n\nNuevo.');
    expect(changeCount(hunks)).toBe(1);
  });

  it('word diff marks only what changed', () => {
    const ops = diffWords('el gato negro', 'el perro negro');
    expect(ops.filter((o) => o.op !== 'same').map((o) => `${o.op}:${o.text}`)).toEqual(['del:gato', 'add:perro']);
  });
});

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getConfig } from '../src/config.js';
import { dismissIdea, ideaId, loadIdeaHistory, markIdeaUsed, restoreIdea } from '../src/orchestrator/ideas.js';

describe('idea history', () => {
  it('dismisses, restores and marks as used by stable id', () => {
    const dir = getConfig().DATA_DIR;
    mkdirSync(dir, { recursive: true });
    const ideas = [{ title: 'Riego por goteo casero', topic: 't', why: 'w', related: [], query: '' }];
    writeFileSync(join(dir, 'ideas.json'), JSON.stringify({ at: '', ideas, withSearchConsole: false }));
    const id = ideaId('riego por goteo casero ');
    expect(id).toBe(ideaId('Riego por goteo casero'));
    expect(dismissIdea('nope')).toBe(false);
    expect(dismissIdea(id)).toBe(true);
    expect(loadIdeaHistory().dismissed.map((d) => d.title)).toEqual(['Riego por goteo casero']);
    restoreIdea(id);
    expect(loadIdeaHistory().dismissed).toEqual([]);
    markIdeaUsed(id, 'post-1');
    expect(loadIdeaHistory().used).toMatchObject([{ id, postId: 'post-1' }]);
  });
});

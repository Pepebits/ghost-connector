import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ImageOption } from '../../src/images/provider.js';
import type { RunArtifact } from '../../src/types.js';

const download = vi.fn(async (o: ImageOption) => ({ buffer: Buffer.from('jpg'), contentType: 'image/jpeg', filename: `${o.id}.jpg`, sourceUrl: o.downloadUrl, attribution: o.attribution }));
vi.mock('../../src/images/registry.js', () => ({ stockSource: () => ({ download }), stockSources: () => [] }));

const { choosePlanImage, chosenCaption, editPlanImageText, localImagePath, skipPlanImage } = await import('../../src/orchestrator/imageChoice.js');
const { findLatestArtifact } = await import('../../src/review/store.js');

const option: ImageOption = {
  provider: 'unsplash', id: 'abc', thumbUrl: 'https://img.test/s.jpg', downloadUrl: 'https://img.test/l.jpg', width: 2000, height: 1200, pageUrl: null,
  attribution: { provider: 'unsplash', authorName: 'Ana', licenseNote: 'Unsplash License', htmlCredit: 'Foto de <a href="https://u.test">Ana</a> en Unsplash' },
};

function plan(): RunArtifact {
  return {
    runId: 'run-img-1', postId: 'post-img-1', postTitle: 'Post', createdAt: '', status: 'planned',
    snapshot: { id: 'post-img-1', slug: 's', title: 'Post', html: '', tags: [], updated_at: '' } as unknown as RunArtifact['snapshot'],
    writer: { title: 'Post', markdown: 'x', outline: [], summary: '', language: 'es', changes_made: [], confidence: 'high' },
    seo: null, uploadedImage: null, patch: { status: 'draft' }, cost: { inputTokens: 0, outputTokens: 0, usd: 0 }, errors: [],
    imagePlan: { strategy: 'unsplash', unsplash_query: 'q', generation_prompt: '', orientation: 'landscape', alt_text: 'Alt del agente', caption: '', reasoning: '' },
    imageOptions: { query: 'q', options: [option], notes: [], at: '' },
  };
}

describe('orchestrator/imageChoice', () => {
  it('elegir descarga en local (sin Ghost) y propone el alt del agente', async () => {
    const chosen = await choosePlanImage(plan(), 0);
    expect(chosen.imageChoice).toMatchObject({ kind: 'option', alt: 'Alt del agente', captionText: '' });
    const file = chosen.imageChoice!.kind === 'option' ? chosen.imageChoice!.localFile : '';
    expect(existsSync(localImagePath(file))).toBe(true);
    expect(download).toHaveBeenCalledOnce();
  });

  it('el pie del editor se escapa y la atribucion va siempre detras', async () => {
    const chosen = await choosePlanImage(plan(), 0);
    const edited = await editPlanImageText(chosen, 'Equipo trabajando', 'Oficina <b>nueva</b>');
    expect(chosenCaption(edited.imageChoice as never, 'es')).toBe('Oficina &lt;b&gt;nueva&lt;/b&gt; · Foto de Ana en Unsplash');
    expect((await findLatestArtifact('post-img-1'))?.imageChoice).toMatchObject({ alt: 'Equipo trabajando' });
  });

  it('"sin imagen" borra la copia local', async () => {
    const chosen = await choosePlanImage(plan(), 0);
    const file = chosen.imageChoice!.kind === 'option' ? chosen.imageChoice!.localFile : '';
    const none = await skipPlanImage(chosen);
    expect(none.imageChoice).toEqual({ kind: 'none' });
    expect(existsSync(localImagePath(file))).toBe(false);
  });

  it('no sirve rutas fuera de la carpeta de imagenes', () => {
    expect(() => localImagePath('../../etc/passwd')).toThrow();
    expect(() => localImagePath('runs/x.json')).toThrow();
  });

  it('un indice que no existe falla', async () => {
    await expect(choosePlanImage(plan(), 5)).rejects.toThrow(/no longer in the list/);
  });
});

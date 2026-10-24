import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { runWithUser } from '../../src/auth/context.js';
import { createUser } from '../../src/auth/store.js';
import { getConfig } from '../../src/config.js';
import { getDb } from '../../src/db/index.js';
import { tarHeader } from '../../src/settings/backup.js';
import { applyImport, createExport, ImportError, readTar, stageImport } from '../../src/settings/workspace.js';
import { addNote, listNotes } from '../../src/team/store.js';

const RUN = 'run-2026-10-01T10-00-00-000Z';
const POST = '6a11e93c0000000000000002';

function tarOf(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    parts.push(tarHeader(name, data.length, new Date()), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

describe('exportar / importar el espacio de trabajo', () => {
  it('exporta lo propio del panel y nunca usuarios, 2FA ni claves', async () => {
    const ana = await createUser('ana', 'una frase bien larga', 'admin');
    const dir = getConfig().DATA_DIR;
    mkdirSync(join(dir, RUN), { recursive: true });
    writeFileSync(join(dir, RUN, `${POST}.json`), JSON.stringify({ runId: RUN, postId: POST, postTitle: 'Hola' }));
    runWithUser(ana, () => addNote(POST, 'Revisar el final'));

    const files = readTar(gunzipSync(runWithUser(ana, () => createExport())));
    expect([...files.keys()]).toEqual(expect.arrayContaining(['manifest.json', 'settings.json', 'team.json', `${RUN}/${POST}.json`]));
    const all = [...files.values()].map((b) => b.toString('utf8')).join('\n');
    expect(all).not.toContain(getConfig().GHOST_ADMIN_API_KEY);
    expect(all).not.toContain(process.env.AI_API_KEY!);
    expect(all).not.toContain('scrypt$');
    expect([...files.keys()].some((n) => n.includes('index.db'))).toBe(false);
    expect(JSON.parse(files.get('manifest.json')!.toString()).exportedBy).toBe('ana');
    expect(JSON.parse(files.get('settings.json')!.toString())).not.toHaveProperty('GHOST_API_URL');
  });

  it('importa con vista previa y solo lo marcado; se suma, no borra', async () => {
    const ana = (await import('../../src/auth/store.js')).findUser('ana')!;
    const exported = runWithUser(ana, () => createExport());
    const dir = getConfig().DATA_DIR;
    rmSync(join(dir, RUN), { recursive: true });
    getDb().prepare('DELETE FROM post_notes').run();

    const preview = runWithUser(ana, () => stageImport(exported));
    expect(preview.plans.newRuns).toBe(1);
    expect(preview.team.notes).toBe(1);
    expect(preview.otherSite).toBe(false);

    const done = runWithUser(ana, () => applyImport(preview.id, ['team']));
    expect(done).toEqual(['team']);
    expect(listNotes(POST).map((n) => n.text)).toEqual(['Revisar el final']);
    expect(existsSync(join(dir, RUN, `${POST}.json`))).toBe(false); // plans weren't ticked

    // Importing again changes nothing: notes are not duplicated.
    const again = runWithUser(ana, () => stageImport(exported));
    expect(again.team.notes).toBe(0);
    runWithUser(ana, () => applyImport(again.id, ['plans', 'team']));
    expect(JSON.parse(readFileSync(join(dir, RUN, `${POST}.json`), 'utf8')).postId).toBe(POST);
    expect(listNotes(POST)).toHaveLength(1);
  });

  it('rechaza lo que no es una exportación y nunca escribe fuera de la carpeta de datos', () => {
    expect(() => stageImport(Buffer.from('hola'))).toThrow(ImportError);
    expect(() => stageImport(tarOf({ 'otra-cosa.json': '{}' }))).toThrow(ImportError);
    const manifest = JSON.stringify({ format: 'ghost-connector-export', version: 1, exportedAt: new Date().toISOString(), exportedBy: null, site: 'https://otro.example' });
    const evil = tarOf({
      'manifest.json': manifest,
      '../../escape.json': '{"runId":"x","postId":"y"}',
      'run-x/../../escape2.json': '{}',
      [`${RUN}/${'6a11e93c0000000000000009'}.json`]: JSON.stringify({ runId: 'otro', postId: 'falso' }), // doesn't match its path
    });
    const preview = stageImport(evil);
    expect(preview.otherSite).toBe(true);
    expect(preview.plans.newRuns).toBe(0);
    applyImport(preview.id, ['plans']);
    expect(existsSync(join(getConfig().DATA_DIR, '..', '..', 'escape.json'))).toBe(false);
    expect(existsSync(join(getConfig().DATA_DIR, RUN, '6a11e93c0000000000000009.json'))).toBe(false);
  });
});

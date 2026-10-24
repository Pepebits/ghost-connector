import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getConfig } from '../../src/config.js';
import { getDb } from '../../src/db/index.js';
import { createBackup, tarHeader } from '../../src/settings/backup.js';

async function toBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

describe('settings/backup', () => {
  it('genera un tar.gz que tar sabe abrir, con la base y los archivos, sin .env por defecto', async () => {
    const dir = getConfig().DATA_DIR;
    getDb();
    mkdirSync(join(dir, 'snippets'), { recursive: true });
    writeFileSync(join(dir, 'snippets', 'p1.json'), '{"ok":true}');
    const env = join(mkdtempSync(join(tmpdir(), 'gc-env-')), '.env');
    writeFileSync(env, 'SECRET=1');

    const out = mkdtempSync(join(tmpdir(), 'gc-out-'));
    writeFileSync(join(out, 'a.tar.gz'), await toBuffer(createBackup({ envPath: env })));
    const list = execFileSync('tar', ['-tzf', join(out, 'a.tar.gz')], { encoding: 'utf8' }).split('\n');
    expect(list).toContain('index.db');
    expect(list).toContain('snippets/p1.json');
    expect(list).not.toContain('.env');
    expect(list).not.toContain('index.db-wal');

    writeFileSync(join(out, 'b.tar.gz'), await toBuffer(createBackup({ includeEnv: true, envPath: env })));
    execFileSync('tar', ['-xzf', join(out, 'b.tar.gz'), '-C', out]);
    expect(readFileSync(join(out, '.env'), 'utf8')).toBe('SECRET=1');
    expect(readFileSync(join(out, 'snippets', 'p1.json'), 'utf8')).toBe('{"ok":true}');
  });

  it('las rutas largas usan el prefijo de ustar', () => {
    const h = tarHeader(`${'a'.repeat(120)}/file.json`, 3, new Date(0));
    expect(h.toString('utf8', 0, 9)).toBe('file.json');
    expect(h.toString('utf8', 345, 350)).toBe('aaaaa');
  });

  it('nombres multibyte: el corte se calcula en bytes', () => {
    const name = `${'ñ'.repeat(70)}/${'á'.repeat(45)}.json`; // 140 + 1 + 95 bytes
    const h = tarHeader(name, 1, new Date(0));
    expect(h.subarray(0, 100).toString('utf8').replace(/\0+$/, '')).toBe(`${'á'.repeat(45)}.json`);
    expect(h.subarray(345, 500).toString('utf8').replace(/\0+$/, '')).toBe('ñ'.repeat(70));
    expect(() => tarHeader(`${'ñ'.repeat(90)}/x`, 1, new Date(0))).toThrow(/too long/);
  });

  it('si se cancela la descarga no se queda colgado ni deja la copia temporal', async () => {
    const { readdirSync } = await import('node:fs');
    const before = readdirSync(tmpdir()).filter((f) => f.startsWith('gc-backup-')).length;
    const stream = createBackup();
    stream.destroy();
    await new Promise((r) => setTimeout(r, 200));
    expect(readdirSync(tmpdir()).filter((f) => f.startsWith('gc-backup-')).length).toBe(before);
  });
});

import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getConfig } from '../../src/config.js';
import { EnvValidationError, resolveUpdates, rewriteEnv, saveEnv } from '../../src/settings/envFile.js';

const snapshot = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in snapshot)) delete process.env[k];
  Object.assign(process.env, snapshot);
});

describe('settings/envFile', () => {
  it('un secreto vacio se conserva; clear_ borra un secreto opcional; solo claves conocidas', () => {
    const u = resolveUpdates({ AI_API_KEY: '', AI_MODEL: ' m ', clear_PEXELS_API_KEY: 'on', NODE_OPTIONS: '--evil' });
    expect(u).toEqual({ AI_MODEL: 'm', PEXELS_API_KEY: '' });
    // Unchecked boxes only count as "false" in the full form.
    expect(resolveUpdates({ __full: '1' })).toMatchObject({ OPENVERSE_ENABLED: 'false', ALLOW_SLUG_CHANGE: 'false' });
  });

  it('saving one section (__group) only touches that section, its booleans included', () => {
    const u = resolveUpdates({ __group: 'openverse', AI_MODEL: 'x', OPENVERSE_LICENSES: 'cc0' });
    expect(u).toEqual({ OPENVERSE_ENABLED: 'false', OPENVERSE_LICENSES: 'cc0' });
    expect(resolveUpdates({ __group: 'ai', AI_MODEL: 'm' })).toEqual({ AI_MODEL: 'm' });
  });

  it('model pickers: "Other" takes the typed name', () => {
    expect(resolveUpdates({ __group: 'ai', AI_MODEL_SEO: '__other', AI_MODEL_SEO__custom: ' gpt-5-mini ' })).toMatchObject({ AI_MODEL_SEO: 'gpt-5-mini' });
    expect(resolveUpdates({ __group: 'ai', AI_MODEL_SEO: '' })).toMatchObject({ AI_MODEL_SEO: '' });
  });

  it('rechaza saltos de linea (inyeccion de variables en el .env)', () => {
    expect(() => resolveUpdates({ AI_MODEL: 'x\nGHOST_API_URL=https://evil' })).toThrow(EnvValidationError);
  });

  it('reescribe conservando comentarios y orden, quita los alias antiguos y entrecomilla', () => {
    const before = '# Ghost\nGHOST_API_URL=https://a.test\n\n# IA\nDEEPSEEK_API_KEY=old\nLOG_LEVEL=info\n';
    const after = rewriteEnv(before, { GHOST_API_URL: 'https://b.test', AI_API_KEY: 'new', SITE_CONTEXT: 'Blog "tech", en español' });
    expect(after).toBe('# Ghost\nGHOST_API_URL=https://b.test\n\n# IA\nLOG_LEVEL=info\nAI_API_KEY=new\nSITE_CONTEXT="Blog \\"tech\\", en español"\n');
  });

  it('no escribe nada si la validacion falla', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gc-env-'));
    const path = join(dir, '.env');
    writeFileSync(path, 'AI_MODEL=a\n');
    expect(() => saveEnv({ GHOST_API_URL: 'no-es-una-url' }, path)).toThrow(EnvValidationError);
    expect(() => saveEnv({ AI_PROVIDER: 'openai-compatible', AI_BASE_URL: '' }, path)).toThrow(/AI_BASE_URL/);
    expect(readFileSync(path, 'utf8')).toBe('AI_MODEL=a\n');
  });

  it('guarda con permisos 0600 y recarga la config en caliente', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gc-env-'));
    const path = join(dir, '.env');
    writeFileSync(path, 'AI_MODEL=a\n', { mode: 0o644 });
    getConfig();
    const changed = saveEnv({ AI_MODEL: 'otro-modelo', AI_API_KEY: '' }, path);
    expect(changed).toContain('AI_MODEL');
    expect(readFileSync(path, 'utf8')).toContain('AI_MODEL=otro-modelo');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(getConfig().AI_MODEL).toBe('otro-modelo');
    expect(getConfig().AI_API_KEY).toBe(snapshot.AI_API_KEY);
  });
});

describe('settings/connectionTest', () => {
  it('no envia la clave guardada a un host distinto del guardado', async () => {
    const { testConnection } = await import('../../src/settings/connectionTest.js');
    const ghost = await testConnection('ghost', { GHOST_API_URL: 'https://otro-sitio.test', GHOST_ADMIN_API_KEY: '' });
    expect(ghost.ok).toBe(false);
    expect(ghost.message).toMatch(/Admin API Key is missing/);
    const ai = await testConnection('ai', { AI_PROVIDER: 'openai-compatible', AI_BASE_URL: 'https://otro-proveedor.test/v1', AI_API_KEY: '' });
    expect(ai.ok).toBe(false);
    expect(ai.message).toMatch(/API key is missing/);
  });
});

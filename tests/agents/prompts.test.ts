import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getConfig } from '../../src/config.js';
import { isPromptCustomized, loadFactoryPrompt, loadPrompt, overridesDir, promptsDir, resetPromptToFactory, savePrompt } from '../../src/agents/prompts.js';

describe('agents/prompts: dos capas', () => {
  it('editar crea una version en los datos del usuario y nunca toca el de fabrica', () => {
    const factory = readFileSync(join(promptsDir(), 'seo.system.md'), 'utf8');
    expect(overridesDir().startsWith(getConfig().DATA_DIR)).toBe(true);
    expect(isPromptCustomized('seo.system')).toBe(false);

    savePrompt('seo.system', 'PROMPT EDITADO');
    expect(isPromptCustomized('seo.system')).toBe(true);
    expect(loadPrompt('seo.system')).toBe('PROMPT EDITADO');
    expect(readFileSync(join(promptsDir(), 'seo.system.md'), 'utf8')).toBe(factory);

    resetPromptToFactory('seo.system');
    expect(isPromptCustomized('seo.system')).toBe(false);
    expect(loadPrompt('seo.system')).toBe(factory);
  });

  it('guardar exactamente el de fabrica equivale a volver a el', () => {
    savePrompt('image.system', 'otro');
    savePrompt('image.system', loadFactoryPrompt('image.system'));
    expect(existsSync(join(overridesDir(), 'image.system.md'))).toBe(false);
  });
});

describe('config: donde viven config y datos', () => {
  it('modo repo con .env en el directorio; si no, ~/.config o GHOST_CONNECTOR_HOME', async () => {
    const { resolveAppHome } = await import('../../src/config.js');
    const repo = resolveAppHome({}, process.cwd());
    expect(repo.mode).toBe(existsSync(join(process.cwd(), '.env')) ? 'repo' : 'home');
    const custom = resolveAppHome({ GHOST_CONNECTOR_HOME: '/tmp/gc-home' }, '/');
    expect(custom).toMatchObject({ mode: 'home', envFile: '/tmp/gc-home/config.env', dataDir: '/tmp/gc-home/data' });
    const xdg = resolveAppHome({ XDG_CONFIG_HOME: '/tmp/xdg' }, '/nonexistent-dir');
    expect(xdg.envFile).toBe('/tmp/xdg/ghost-connector/config.env');
  });
});

import { describe, expect, it } from 'vitest';
import { withSiteContext } from '../../src/agents/runner.js';

describe('agents: contexto del sitio', () => {
  it('se anade al final del system prompt, y nada si esta vacio', () => {
    expect(withSiteContext('Reglas.\n', ' Blog de cocina. ')).toBe('Reglas.\n\nCONTEXTO DEL SITIO:\nBlog de cocina.\n');
    expect(withSiteContext('Reglas.', '  ')).toBe('Reglas.');
  });
});

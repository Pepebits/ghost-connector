import { describe, expect, it } from 'vitest';
import { withSiteContext } from '../../src/agents/runner.js';

describe('agents: site context', () => {
  it('is appended to the system prompt, and nothing if empty', () => {
    expect(withSiteContext('Reglas.\n', ' Blog de cocina. ')).toBe('Reglas.\n\nCONTEXTO DEL SITIO:\nBlog de cocina.\n');
    expect(withSiteContext('Reglas.', '  ')).toBe('Reglas.');
  });
});

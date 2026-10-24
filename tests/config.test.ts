import { describe, expect, it } from 'vitest';
import { applyLegacyEnv } from '../src/config.js';

describe('config: variables antiguas DEEPSEEK_*', () => {
  it('se copian a AI_* solo si la nueva no esta definida', () => {
    const env: NodeJS.ProcessEnv = { DEEPSEEK_API_KEY: 'vieja', DEEPSEEK_MODEL: 'm-viejo', AI_MODEL: 'm-nuevo' };
    expect(applyLegacyEnv(env)).toEqual(['DEEPSEEK_API_KEY']);
    expect(env.AI_API_KEY).toBe('vieja');
    expect(env.AI_MODEL).toBe('m-nuevo');
  });
});

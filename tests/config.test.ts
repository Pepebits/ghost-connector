import { describe, expect, it } from 'vitest';
import { applyLegacyEnv } from '../src/config.js';

describe('config: legacy DEEPSEEK_* variables', () => {
  it('are copied to AI_* only if the new one is not set', () => {
    const env: NodeJS.ProcessEnv = { DEEPSEEK_API_KEY: 'vieja', DEEPSEEK_MODEL: 'm-viejo', AI_MODEL: 'm-nuevo' };
    expect(applyLegacyEnv(env)).toEqual(['DEEPSEEK_API_KEY']);
    expect(env.AI_API_KEY).toBe('vieja');
    expect(env.AI_MODEL).toBe('m-nuevo');
  });
});

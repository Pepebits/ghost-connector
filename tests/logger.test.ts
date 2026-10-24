import { describe, expect, it } from 'vitest';
import { scrubUrl, SECRET_KEYS } from '../src/logger.js';
import { ENV_FIELDS } from '../src/settings/envFile.js';

describe('logger', () => {
  it('redacts every secret setting', () => {
    for (const f of ENV_FIELDS.filter((x) => x.secret)) expect(SECRET_KEYS, f.key).toContain(f.key);
  });

  it('removes login tokens and invite links from logged URLs', () => {
    expect(scrubUrl('/jobs?once=abc&x=1')).toBe('/jobs?once=[REDACTED]&x=1');
    expect(scrubUrl('/?x=1&t=secret')).toBe('/?x=1&t=[REDACTED]');
    expect(scrubUrl('/invite/abc123?y')).toBe('/invite/[REDACTED]?y');
    expect(scrubUrl('/posts/1?tab=x')).toBe('/posts/1?tab=x');
  });
});

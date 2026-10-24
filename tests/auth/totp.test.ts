import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, verifyTotp } from '../../src/auth/totp.js';

// RFC 4226 / 6238 test secret: "12345678901234567890".
const SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('auth/totp', () => {
  it('base32 round trip', () => {
    expect(base32Decode(SECRET).toString()).toBe('12345678901234567890');
    expect(SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });
  it('RFC 4226 vectors', () => {
    expect([0, 1, 2, 9].map((c) => hotp(SECRET, c))).toEqual(['755224', '287082', '359152', '520489']);
  });
  it('RFC 6238 vector (T = 59 s → 94287082, 6 digits)', () => {
    expect(verifyTotp(SECRET, '287082', 59_000)).toBe(1);
  });
  it('accepts one step of drift, not two, and rejects a reused code', () => {
    const now = 30_000 * 1000;
    expect(verifyTotp(SECRET, hotp(SECRET, 999), now)).toBe(999);
    expect(verifyTotp(SECRET, hotp(SECRET, 998), now)).toBeNull();
    expect(verifyTotp(SECRET, hotp(SECRET, 1000), now, 1000)).toBeNull();
    expect(verifyTotp(SECRET, 'abc123', now)).toBeNull();
  });
});

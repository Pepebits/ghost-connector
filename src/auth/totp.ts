import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** TOTP (RFC 6238: SHA-1, 6 digits, 30 s), what every authenticator app speaks. */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

export const totpCounter = (now = Date.now()) => Math.floor(now / 30_000);

/**
 * Checks a code against the current step and one on each side (clock skew).
 * Returns the matching counter, so the caller can refuse a replay of it.
 */
export function verifyTotp(secret: string, code: string, now = Date.now(), lastUsed = -1): number | null {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const c = totpCounter(now);
  for (const counter of [c - 1, c, c + 1]) {
    if (counter <= lastUsed) continue;
    if (timingSafeEqual(Buffer.from(hotp(secret, counter)), Buffer.from(clean))) return counter;
  }
  return null;
}

export function otpauthUri(secret: string, account: string, issuer = 'Ghost Connector'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?${new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' })}`;
}

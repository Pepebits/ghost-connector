import { describe, expect, it } from 'vitest';
import { BlockedUrlError, isBlockedAddress, safeFetch } from '../../src/util/safeFetch.js';

describe('util/safeFetch', () => {
  it('blocks private, loopback, link-local and special IPv4 ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '198.18.0.1', '224.0.0.1', '255.255.255.255']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    for (const ip of ['1.1.1.1', '8.8.8.8', '151.101.1.69']) expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it('blocks IPv6 loopback, unique-local, link-local and IPv4 hidden inside IPv6', () => {
    for (const ip of ['::1', '::', 'fd00::1', 'fe80::1', 'fec0::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '::127.0.0.1']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    for (const ip of ['2606:4700:4700::1111', '::ffff:1.1.1.1']) expect(isBlockedAddress(ip), ip).toBe(false);
    expect(isBlockedAddress('not-an-ip')).toBe(true);
  });

  it('refuses private hosts and non-http schemes before connecting', async () => {
    for (const url of ['http://127.0.0.1:4300/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:a9fe:a9fe]/latest/meta-data/', 'http://localhost/', 'http://db.internal/', 'file:///etc/passwd', 'ftp://example.com/']) {
      await expect(safeFetch(url), url).rejects.toThrow(BlockedUrlError);
    }
  });
});

import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadServiceAccount, opportunities, signedJwt } from '../src/research/searchConsole.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('research/searchConsole', () => {
  it('signs a valid RS256 assertion for the token endpoint, read-only scope', () => {
    const jwt = signedJwt({ client_email: 'bot@p.iam.gserviceaccount.com', private_key: pem }, 1000);
    const [h, c, s] = jwt.split('.');
    expect(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s!, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(c!, 'base64url').toString())).toMatchObject({ iss: 'bot@p.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/webmasters.readonly', iat: 1000, exp: 4600 });
  });

  it('reads the key as JSON, also when .env turned its \\n into real line breaks', () => {
    const json = JSON.stringify({ client_email: 'a@b', private_key: pem });
    expect(loadServiceAccount(json).client_email).toBe('a@b');
    expect(loadServiceAccount(json.replace(/\\n/g, '\n')).private_key).toContain('BEGIN PRIVATE KEY');
    expect(() => loadServiceAccount('/no/such/file.json')).toThrow();
  });

  it('keeps "almost there" searches: position 8-20 with enough impressions, grouped by query', () => {
    const out = opportunities([
      { query: 'sdv coche', page: 'https://b/a/', clicks: 1, impressions: 40, position: 12 },
      { query: 'sdv coche', page: 'https://b/b/', clicks: 0, impressions: 10, position: 17 },
      { query: 'ya top', page: 'https://b/c/', clicks: 30, impressions: 300, position: 2 },
      { query: 'muy lejos', page: 'https://b/d/', clicks: 0, impressions: 100, position: 45 },
      { query: 'pocas', page: 'https://b/e/', clicks: 0, impressions: 3, position: 10 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ query: 'sdv coche', impressions: 50, page: 'https://b/a/' });
    expect(out[0]!.position).toBeCloseTo(13);
  });
});

describe('bing webmaster', () => {
  it('converts GetQueryStats: only the requested period and valid positions', async () => {
    const { bingRows } = await import('../src/research/bingWebmaster.js');
    const now = Date.UTC(2026, 9, 13);
    const day = 86400_000;
    const rows = bingRows(
      [
        { Query: 'riego por goteo', Impressions: 40, Clicks: 1, AvgImpressionPosition: 11, Date: `/Date(${now - 7 * day})/` },
        { Query: 'antigua', Impressions: 40, Clicks: 1, AvgImpressionPosition: 11, Date: `/Date(${now - 60 * day})/` },
        { Query: 'sin posicion', Impressions: 40, Clicks: 0, AvgImpressionPosition: -1, Date: `/Date(${now})/` },
      ],
      28,
      now,
    );
    expect(rows).toEqual([{ query: 'riego por goteo', page: '', clicks: 1, impressions: 40, position: 11, source: 'bing' }]);
  });

  it('merges Google and Bing for the same query and keeps the Google page', async () => {
    const { opportunities } = await import('../src/research/searchConsole.js');
    const list = opportunities([
      { query: 'Riego por goteo', page: 'https://blog.test/riego/', clicks: 0, impressions: 30, position: 10, source: 'google' },
      { query: 'riego por goteo', page: '', clicks: 1, impressions: 10, position: 14, source: 'bing' },
      { query: 'solo bing', page: '', clicks: 0, impressions: 20, position: 9, source: 'bing' },
    ]);
    expect(list[0]).toMatchObject({ query: 'Riego por goteo', impressions: 40, position: 11, page: 'https://blog.test/riego/', sources: ['google', 'bing'] });
    expect(list[1]).toMatchObject({ query: 'solo bing', page: '', sources: ['bing'] });
  });
});

describe('lowCtr', () => {
  it('flags first-page results with under half the usual CTR, Google with a page only', async () => {
    const { lowCtr } = await import('../src/research/searchConsole.js');
    const list = lowCtr([
      { query: 'poda tomates', page: 'https://blog.test/poda/', clicks: 2, impressions: 200, position: 2, source: 'google' },
      { query: 'abono casero', page: 'https://blog.test/abono/', clicks: 30, impressions: 200, position: 2, source: 'google' },
      { query: 'macetas', page: 'https://blog.test/m/', clicks: 0, impressions: 20, position: 3, source: 'google' },
      { query: 'riego', page: '', clicks: 0, impressions: 500, position: 2, source: 'bing' },
      { query: 'sustrato', page: 'https://blog.test/s/', clicks: 0, impressions: 300, position: 12, source: 'google' },
    ]);
    expect(list.map((l) => l.query)).toEqual(['poda tomates']);
    expect(list[0]).toMatchObject({ ctr: 0.01, expectedCtr: 0.15 });
  });
});

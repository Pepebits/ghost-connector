import { afterEach, describe, expect, it, vi } from 'vitest';
import { reloadConfig } from '../../src/config.js';
import { formatCredit } from '../../src/images/provider.js';
import { authorName, licenseCode, plainText, WikimediaProvider } from '../../src/images/wikimedia.provider.js';

const page = (pageid: number, license: string, mime = 'image/jpeg') => ({
  pageid,
  title: `File:Coche ${pageid}.jpg`,
  imageinfo: [{
    url: `https://upload.wikimedia.org/o/${pageid}.jpg`,
    thumburl: `https://upload.wikimedia.org/thumb/a/${pageid}.jpg/1920px-${pageid}.jpg`,
    descriptionurl: `https://commons.wikimedia.org/wiki/File:Coche_${pageid}.jpg`,
    width: 4000, height: 2000, mime,
    extmetadata: {
      Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Ana">Ana <b>R.</b></a>' },
      LicenseShortName: { value: license },
      LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0' },
      ObjectName: { value: `Coche ${pageid}` },
    },
  }],
});

describe('images/wikimedia', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    reloadConfig();
  });

  it('licenseCode: only licenses free for commercial use and modification', () => {
    expect(licenseCode('CC BY 4.0')).toBe('by');
    expect(licenseCode('CC BY-SA 3.0')).toBe('by-sa');
    expect(licenseCode('CC0')).toBe('cc0');
    expect(licenseCode('Public domain')).toBe('pdm');
    expect(licenseCode('CC BY-NC 2.0')).toBeNull();
    expect(licenseCode('GFDL')).toBeNull();
  });

  it('authorName drops unknown authors and repeated names', () => {
    expect(authorName('<span>Unknown author</span> Unknown author')).toBeUndefined();
    expect(authorName('<a href="x">Ana</a> Ana')).toBe('Ana');
    expect(authorName('General Electric Company')).toBe('General Electric Company');
  });

  it('plainText strips the HTML Commons sends', () => {
    expect(plainText('<a href="x">Ana <b>R.</b></a> &amp; co')).toBe('Ana R. & co');
  });

  it('keeps allowed licenses and bitmaps, with a smaller grid thumbnail and an escaped credit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ query: { pages: [page(1, 'CC BY 4.0'), page(2, 'CC BY-NC 2.0'), page(3, 'CC BY-SA 4.0'), page(4, 'CC0', 'image/svg+xml')] } }), { status: 200 })));
    const out = (await new WikimediaProvider().searchOptions('coche', 'landscape', 10))!;
    expect(out.map((o) => o.id)).toEqual(['1']); // by-sa is off by default, NC and SVG never
    expect(out[0]!.thumbUrl).toContain('/500px-');
    expect(out[0]!.attribution).toMatchObject({ authorName: 'Ana R.', authorUrl: 'https://commons.wikimedia.org/wiki/User:Ana', licenseNote: 'CC BY 4.0' });
    expect(formatCredit(out[0]!.attribution, 'es')).toContain('vía Wikimedia Commons');
  });
});

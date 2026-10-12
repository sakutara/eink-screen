import { describe, expect, it } from 'vitest';
import { base64url, codeChallenge, generateVerifier } from './pkce';
import { mapCurrentlyPlaying, pickCover } from './spotify';

describe('mapCurrentlyPlaying', () => {
  const sample = {
    is_playing: true,
    item: {
      id: 'abc123',
      name: 'Nơi này có anh',
      duration_ms: 259000,
      type: 'track',
      artists: [{ name: 'Sơn Tùng M-TP' }, { name: 'Khác' }],
      album: {
        name: 'Album Hay',
        release_date: '2017-02-14',
        images: [
          { url: 'big', width: 640 },
          { url: 'mid', width: 300 },
          { url: 'small', width: 64 },
        ],
      },
    },
  };

  it('maps title, artists, year, duration and cover', () => {
    expect(mapCurrentlyPlaying(sample)).toEqual({
      id: 'abc123',
      title: 'Nơi này có anh',
      artists: 'Sơn Tùng M-TP, Khác',
      album: 'Album Hay',
      year: 2017,
      durationMs: 259000,
      coverUrl: 'mid',
      isPlaying: true,
    });
  });

  it('handles year-only and month-precision release dates', () => {
    const y = (d: string) => mapCurrentlyPlaying({ ...sample, item: { ...sample.item, album: { ...sample.item.album, release_date: d } } })?.year;
    expect(y('1999')).toBe(1999);
    expect(y('2001-05')).toBe(2001);
  });

  it('returns null year for a missing date and null for empty payloads', () => {
    const noDate = mapCurrentlyPlaying({ ...sample, item: { ...sample.item, album: { name: 'x', images: [] } } });
    expect(noDate?.year).toBeNull();
    expect(noDate?.coverUrl).toBeNull();
    expect(mapCurrentlyPlaying(null)).toBeNull();
    expect(mapCurrentlyPlaying({ is_playing: false, item: null })).toBeNull();
  });

  it('maps podcast episodes', () => {
    const ep = mapCurrentlyPlaying({
      is_playing: false,
      item: { id: 'e1', name: 'Tập 1', type: 'episode', duration_ms: 60000, release_date: '2023-03-01', show: { name: 'Show', publisher: 'Pub' }, images: [{ url: 'i', width: 300 }] },
    });
    expect(ep).toMatchObject({ id: 'e1', artists: 'Pub', album: 'Show', year: 2023, isPlaying: false, coverUrl: 'i' });
  });
});

describe('pickCover', () => {
  it('prefers the smallest image of at least 128px, else the largest', () => {
    expect(pickCover([{ url: 'a', width: 64 }, { url: 'b', width: 640 }, { url: 'c', width: 200 }])).toBe('c');
    expect(pickCover([{ url: 'a', width: 64 }, { url: 'b', width: 100 }])).toBe('b');
    expect(pickCover([])).toBeNull();
  });
});

describe('PKCE', () => {
  it('computes the RFC 7636 appendix B challenge', async () => {
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('base64url has no padding or +/ characters', () => {
    expect(base64url(Uint8Array.of(251, 255, 254))).toBe('-__-');
    expect(base64url(Uint8Array.of(1))).toBe('AQ');
  });

  it('generates verifiers of valid length and alphabet', () => {
    const v = generateVerifier();
    expect(v).toHaveLength(64);
    expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
    expect(generateVerifier()).not.toBe(v);
  });
});

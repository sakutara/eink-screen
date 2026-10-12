import { describe, expect, it } from 'vitest';
import { mapsIntentUrl, mapsNavigationUrl } from './googleMaps';
import { parseSharedPlace, shareParamsFromSearch } from './share';

describe('parseSharedPlace', () => {
  it('splits a Google Maps share into query and link', () => {
    const r = parseSharedPlace({ text: 'Highlands Coffee\n12 Nguyễn Huệ, Quận 1\nhttps://maps.app.goo.gl/AbCd123' });
    expect(r).toEqual({ query: 'Highlands Coffee, 12 Nguyễn Huệ, Quận 1', url: 'https://maps.app.goo.gl/AbCd123' });
  });
  it('dedupes the title that repeats the first text line', () => {
    const r = parseSharedPlace({ title: 'Hồ Gươm', text: 'Hồ Gươm\nHoàn Kiếm, Hà Nội\nhttps://maps.app.goo.gl/x' });
    expect(r?.query).toBe('Hồ Gươm, Hoàn Kiếm, Hà Nội');
  });
  it('falls back to the place name and coordinates in a long URL', () => {
    const r = parseSharedPlace({ url: 'https://www.google.com/maps/place/Ben+Thanh+Market/@10.7725,106.698,17z/data=!3m1' });
    expect(r?.query).toBe('Ben Thanh Market');
    expect(r?.coords).toEqual({ lat: 10.7725, lng: 106.698 });
  });
  it('returns null when only an opaque short link is shared', () => {
    expect(parseSharedPlace({ text: 'https://maps.app.goo.gl/AbCd123' })).toBeNull();
    expect(parseSharedPlace({})).toBeNull();
  });
});

describe('shareParamsFromSearch', () => {
  it('reads share params and ignores empty loads and OAuth callbacks', () => {
    expect(shareParamsFromSearch('?text=A%0AB&url=https%3A%2F%2Fx.y')).toEqual({ text: 'A\nB', url: 'https://x.y' });
    expect(shareParamsFromSearch('')).toBeNull();
    expect(shareParamsFromSearch('?code=1&state=2&text=x')).toBeNull();
  });
});

describe('maps links', () => {
  const dest = { placeId: 'ChIJabc', label: 'Quán A & B' };
  it('builds a navigate URL', () => {
    const u = new URL(mapsNavigationUrl(dest, 'TWO_WHEELER'));
    expect(u.origin + u.pathname).toBe('https://www.google.com/maps/dir/');
    expect(u.searchParams.get('destination_place_id')).toBe('ChIJabc');
    expect(u.searchParams.get('destination')).toBe('Quán A & B');
    expect(u.searchParams.get('travelmode')).toBe('two-wheeler');
    expect(u.searchParams.get('dir_action')).toBe('navigate');
  });
  it('wraps it in an Android intent for the Maps package', () => {
    const i = mapsIntentUrl(dest, 'DRIVE');
    expect(i.startsWith('intent://www.google.com/maps/dir/?')).toBe(true);
    expect(i.endsWith('#Intent;scheme=https;package=com.google.android.apps.maps;end')).toBe(true);
  });
});

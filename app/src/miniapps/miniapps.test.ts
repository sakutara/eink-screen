import { describe, expect, it } from 'vitest';
import type { Route } from '../integrations/googleMaps';
import { mapRoute, parseDuration } from '../integrations/googleMaps';
import { computeProgress, distanceBucket } from './directions/geo';
import { directionsKey, type DirectionsData } from './directions';
import { maneuverShape } from './directions/maneuvers';
import { formatDistance, formatDuration } from './format';
import { spotifyKey, type SpotifyData } from './spotify';
import { ellipsize, wrapText } from '../render/text';
import { normalizeQuality } from './quality';

describe('spotifyKey', () => {
  const data = (id: string, isPlaying: boolean) => ({ track: { id, isPlaying } }) as unknown as SpotifyData;
  it('depends only on the track id', () => {
    expect(spotifyKey(data('a', true))).toBe(spotifyKey(data('a', false)));
    expect(spotifyKey(data('a', true))).not.toBe(spotifyKey(data('b', true)));
  });
});

describe('directionsKey', () => {
  const base: DirectionsData = {
    maneuver: 'TURN_LEFT', instruction: 'Rẽ trái vào Đường A', distanceToManeuver: 480, remainingMeters: 5000,
    etaMs: 0, arrived: false, destination: 'X',
  };
  it('ignores trivial distance and ETA changes', () => {
    expect(directionsKey({ ...base, distanceToManeuver: 470, etaMs: 99, remainingMeters: 4990 })).toBe(directionsKey(base));
  });
  it('changes with maneuver, instruction or bucket', () => {
    expect(directionsKey({ ...base, maneuver: 'TURN_RIGHT' })).not.toBe(directionsKey(base));
    expect(directionsKey({ ...base, instruction: 'khác' })).not.toBe(directionsKey(base));
    expect(directionsKey({ ...base, distanceToManeuver: 300 })).not.toBe(directionsKey(base));
  });
});

describe('distanceBucket', () => {
  it('buckets coarsely', () => {
    expect(distanceBucket(40)).toBe('<100');
    expect(distanceBucket(120)).toBe('100');
    expect(distanceBucket(480)).toBe('500');
    expect(distanceBucket(1100)).toBe('1000');
    expect(distanceBucket(5100)).toBe('5000');
  });
});

describe('computeProgress', () => {
  // Three steps heading east along latitude 10 (0.001 deg lng ~ 109.6 m).
  const p = (lng: number) => ({ lat: 10, lng });
  const route: Route = {
    distanceMeters: 330, durationSec: 60,
    steps: [
      { maneuver: 'DEPART', instruction: 'Đi thẳng', distanceMeters: 110, durationSec: 20, start: p(0), end: p(0.001) },
      { maneuver: 'TURN_LEFT', instruction: 'Rẽ trái', distanceMeters: 110, durationSec: 20, start: p(0.001), end: p(0.002) },
      { maneuver: 'TURN_RIGHT', instruction: 'Rẽ phải', distanceMeters: 110, durationSec: 20, start: p(0.002), end: p(0.003) },
    ],
  };

  it('reports the next maneuver and distance on the first step', () => {
    const pr = computeProgress(route, p(0.0004));
    expect(pr.index).toBe(0);
    expect(pr.maneuver).toBe('TURN_LEFT');
    expect(pr.instruction).toBe('Rẽ trái');
    expect(pr.distanceToManeuver).toBeGreaterThan(60);
    expect(pr.distanceToManeuver).toBeLessThan(70);
    expect(pr.offRouteMeters).toBeLessThan(1);
    expect(pr.remainingMeters).toBeCloseTo(pr.distanceToManeuver + 220, 5);
  });

  it('announces arrival on the last step and never goes backwards', () => {
    const near = computeProgress(route, p(0.00299), 2);
    expect(near.maneuver).toBe('ARRIVE');
    expect(near.arrived).toBe(true);
    expect(computeProgress(route, p(0.0004), 1).index).toBe(1);
  });

  it('detects being off route', () => {
    const off = computeProgress(route, { lat: 10.002, lng: 0.0015 });
    expect(off.offRouteMeters).toBeGreaterThan(150);
  });
});

describe('maneuverShape', () => {
  it('covers turn families', () => {
    expect(maneuverShape('TURN_LEFT')).toEqual({ kind: 'bend', angle: -90 });
    expect(maneuverShape('TURN_SHARP_RIGHT')).toEqual({ kind: 'bend', angle: 135 });
    expect(maneuverShape('UTURN_LEFT')).toEqual({ kind: 'uturn', dir: -1 });
    expect(maneuverShape('ROUNDABOUT_RIGHT')).toEqual({ kind: 'roundabout', angle: 90 });
    expect(maneuverShape('ARRIVE')).toEqual({ kind: 'arrive' });
    expect(maneuverShape('NAME_CHANGE')).toEqual({ kind: 'bend', angle: 0 });
    expect(maneuverShape('SOMETHING_NEW')).toEqual({ kind: 'bend', angle: 0 });
  });
});

describe('mapRoute', () => {
  it('maps Routes API steps', () => {
    const r = mapRoute({
      routes: [{
        duration: '600s', distanceMeters: 3000,
        legs: [{ steps: [{
          navigationInstruction: { maneuver: 'TURN_LEFT', instructions: 'Rẽ trái' },
          distanceMeters: 100, staticDuration: '12s',
          startLocation: { latLng: { latitude: 1, longitude: 2 } }, endLocation: { latLng: { latitude: 3, longitude: 4 } },
        }] }],
      }],
    });
    expect(r.durationSec).toBe(600);
    expect(r.steps[0]).toMatchObject({ maneuver: 'TURN_LEFT', durationSec: 12, start: { lat: 1, lng: 2 }, end: { lat: 3, lng: 4 } });
    expect(() => mapRoute({})).toThrow();
    expect(parseDuration('1.5s')).toBe(1.5);
  });
});

describe('formatting and text', () => {
  it('formats duration m:ss and distance', () => {
    expect(formatDuration(259000)).toBe('4:19');
    expect(formatDuration(61000)).toBe('1:01');
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(1234)).toBe('1,2 km');
    expect(formatDistance(15400)).toBe('15 km');
  });

  const measure = (s: string) => s.length * 10;
  it('wraps to at most N lines with an ellipsis', () => {
    expect(wrapText(measure, 'aa bb cc', 50, 2)).toEqual(['aa bb', 'cc']);
    const lines = wrapText(measure, 'aaaa bbbb cccc dddd eeee', 90, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith('…')).toBe(true);
    expect(measure(lines[1]!)).toBeLessThanOrEqual(90);
    expect(ellipsize(measure, 'abcdefghij', 50)).toBe('abcd…');
  });
});

describe('normalizeQuality', () => {
  it('defaults and clamps', () => {
    expect(normalizeQuality(undefined)).toMatchObject({ palette: 'bwr', minIntervalSec: 25, layout: 'full' });
    expect(normalizeQuality({ contrast: 99, layout: 'clockImage' })).toMatchObject({ contrast: 2.5, layout: 'full' });
  });
});

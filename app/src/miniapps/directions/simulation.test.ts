import { describe, expect, it } from 'vitest';
import { dither } from '../../render/dither';
import { PLANE_BYTES, packPlanes, type PixelImage } from '../../render/pack';
import { PANEL } from '../../ble/protocol';
import { directionsMiniApp } from './index';
import { directionsSimMiniApp } from './simMiniApp';
import { SIM_ROUTE, framesToArrive, positionAlong, simulateTrip, summarizeTrip } from './simulation';
import { haversine } from './geo';

describe('SIM_ROUTE', () => {
  it('is a ~3 km, 9 step route with varied maneuvers', () => {
    expect(SIM_ROUTE.steps).toHaveLength(9);
    expect(SIM_ROUTE.distanceMeters).toBeGreaterThan(2500);
    expect(SIM_ROUTE.distanceMeters).toBeLessThan(3600);
    const m = SIM_ROUTE.steps.map((s) => s.maneuver);
    expect(m).toContain('TURN_RIGHT');
    expect(m).toContain('TURN_SLIGHT_LEFT');
    expect(m).toContain('ROUNDABOUT_RIGHT');
    expect(m).toContain('TURN_LEFT');
    expect(m).toContain('RAMP_RIGHT');
  });
  it('has contiguous steps', () => {
    SIM_ROUTE.steps.slice(1).forEach((s, i) => expect(s.start).toEqual(SIM_ROUTE.steps[i]!.end));
  });
  it('positionAlong interpolates and clamps', () => {
    expect(positionAlong(SIM_ROUTE, 0)).toEqual(SIM_ROUTE.steps[0]!.start);
    expect(haversine(positionAlong(SIM_ROUTE, 100), SIM_ROUTE.steps[0]!.start)).toBeCloseTo(100, -1);
    expect(positionAlong(SIM_ROUTE, 1e9)).toEqual(SIM_ROUTE.steps[8]!.end);
  });
});

describe('simulateTrip', () => {
  const frames = simulateTrip();

  it('is deterministic', () => {
    expect(simulateTrip()).toEqual(frames);
  });
  it('yields 10 frames every 30 s by default', () => {
    expect(frames).toHaveLength(10);
    expect(frames.map((f) => f.tSec)).toEqual([30, 60, 90, 120, 150, 180, 210, 240, 270, 300]);
    expect(simulateTrip({ frames: 4, intervalSec: 10 }).map((f) => f.tSec)).toEqual([10, 20, 30, 40]);
  });
  it('has non-increasing remaining distance and the last frame is arrived', () => {
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]!.data.remainingMeters).toBeLessThanOrEqual(frames[i - 1]!.data.remainingMeters + 1e-6);
    }
    expect(frames.slice(0, -1).some((f) => f.data.arrived)).toBe(false);
    const last = frames[frames.length - 1]!;
    expect(last.data.arrived).toBe(true);
    expect(last.data.remainingMeters).toBeLessThan(30);
  });
  it('changes the key between consecutive frames', () => {
    for (let i = 1; i < frames.length; i++) expect(frames[i]!.key).not.toBe(frames[i - 1]!.key);
  });
  it('arrival needs the computed number of frames', () => {
    expect(framesToArrive(35, 30)).toBeLessThanOrEqual(10);
    const slow = simulateTrip({ speedKmh: 10, intervalSec: 30, frames: 10 });
    expect(slow[slow.length - 1]!.data.arrived).toBe(false);
    const n = framesToArrive(10, 30);
    expect(simulateTrip({ speedKmh: 10, intervalSec: 30, frames: n }).at(-1)!.data.arrived).toBe(true);
  });
});

describe('frame packing', () => {
  const white = (): PixelImage => ({ width: PANEL.width, height: PANEL.height, data: new Uint8ClampedArray(PANEL.width * PANEL.height * 4).fill(255) });
  it.each(['bw', 'bwr'] as const)('packs %s planes of 4736 bytes', (palette) => {
    const planes = packPlanes(dither(white(), { palette, algorithm: 'floyd-steinberg' }));
    expect(planes.black).toHaveLength(4736);
    expect(planes.red).toHaveLength(4736);
    expect(PLANE_BYTES).toBe(4736);
  });
});

describe('directionsSimMiniApp', () => {
  const settings = { ...directionsSimMiniApp.defaultSettings };
  const ctxFor = (s = settings) => ({ settings: s, signal: new AbortController().signal, client: async () => { throw new Error('no'); }, log: () => undefined }) as never;

  it('reuses the real key and needs no integration', () => {
    expect(directionsSimMiniApp.key).toBe(directionsMiniApp.key);
    expect(directionsSimMiniApp.requires).toEqual([]);
    expect(directionsSimMiniApp.pollIntervalMs(settings)).toBe(30_000);
    expect(directionsSimMiniApp.pollIntervalMs({ ...settings, intervalSec: 1 })).toBe(5_000);
  });
  it('tick walks the frames and loops', async () => {
    const run = await directionsSimMiniApp.start(ctxFor());
    const expected = simulateTrip({ frames: framesToArrive(35, 30) }).map((f) => f.data);
    for (const d of expected) expect(await run.tick()).toEqual(d);
    expect(await run.tick()).toEqual(expected[0]);
  });
  it('without loop it stays on the arrived frame', async () => {
    const run = await directionsSimMiniApp.start(ctxFor({ ...settings, loop: false }));
    let d;
    for (let i = 0; i < 20; i++) d = await run.tick();
    expect(d!.arrived).toBe(true);
  });
  it('render draws every frame without throwing', () => {
    const texts: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) => {
        if (k === 'measureText') return (s: string) => ({ width: s.length * 7 });
        if (k === 'fillText') return (s: string) => { texts.push(s); };
        return k in t ? t[k] : () => undefined;
      },
      set: (t, k: string, v) => { t[k] = v; return true; },
    });
    for (const f of simulateTrip({ frames: 10 })) {
      directionsSimMiniApp.render(ctx as never, f.data, { width: 296, height: 128, palette: 'bwr' }, settings);
    }
    expect(texts).toContain('Đã đến');
  });
});

describe('summarizeTrip', () => {
  it('counts refreshes and flags intervals shorter than refresh time', () => {
    const frames = simulateTrip();
    const bwr = summarizeTrip(frames, 'bwr', 10, 30);
    expect(bwr.refreshCount).toBe(10);
    expect(bwr.tooSlow).toEqual([]);
    const tight = summarizeTrip(frames, 'bwr', 10, 10);
    expect(tight.tooSlow).toHaveLength(10);
    const bw = summarizeTrip(frames, 'bw', 5, 30);
    expect(bw.refreshes[0]).toMatchObject({ method: 'full', ghostClear: true });
    expect(bw.refreshes.filter((r) => r?.ghostClear).map((r) => r?.frame)).toEqual([0, 5]);
  });
});

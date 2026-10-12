import type { LatLng, Route, RouteStep } from '../../integrations/googleMaps';
import { BUSY_MS_BWR, BUSY_MS_BW_FAST } from '../../ble/device';
import type { PaletteName } from '../../render/dither';
import { chooseMethod, type RefreshMethod } from '../../modes/refreshMethod';
import { directionsKey, type DirectionsData } from './index';
import { computeProgress, haversine } from './geo';

/** Hard-coded demo trip in Hà Nội (made-up street layout, only used to exercise the real miniapp). */
export const SIM_ORIGIN: LatLng = { lat: 21.0285, lng: 105.8542 };
export const SIM_DESTINATION = 'Số 18 Ngõ 245 Phố Nguyễn Văn Cừ, Long Biên';

/** Ride at 30 km/h for the durations Google would report (only affects the ETA). */
const ROUTE_SPEED_MS = 30 / 3.6;

interface Leg {
  maneuver: string;
  instruction: string;
  meters: number;
  /** Compass bearing of travel along this leg, degrees (0 = north, 90 = east). */
  bearing: number;
}

const LEGS: Leg[] = [
  { maneuver: 'DEPART', instruction: 'Đi thẳng trên Phố Đinh Tiên Hoàng', meters: 300, bearing: 0 },
  { maneuver: 'TURN_RIGHT', instruction: 'Rẽ phải vào Phố Lê Thái Tổ', meters: 450, bearing: 90 },
  { maneuver: 'TURN_SLIGHT_LEFT', instruction: 'Đi chếch trái vào Đường Nguyễn Thượng Hiền kéo dài', meters: 300, bearing: 55 },
  { maneuver: 'ROUNDABOUT_RIGHT', instruction: 'Vào vòng xuyến, đi theo lối ra thứ hai vào Đại lộ Thăng Long', meters: 150, bearing: 100 },
  { maneuver: 'TURN_LEFT', instruction: 'Rẽ trái vào Đường Nguyễn Hữu Cảnh', meters: 350, bearing: 10 },
  { maneuver: 'NAME_CHANGE', instruction: 'Tiếp tục đi thẳng, đường đổi tên thành Quốc lộ 1A (Xa lộ Hà Nội – Hải Phòng)', meters: 500, bearing: 10 },
  { maneuver: 'RAMP_RIGHT', instruction: 'Đi vào đường dẫn bên phải để lên Cầu Vượt Nguyễn Văn Cừ', meters: 300, bearing: 40 },
  { maneuver: 'TURN_RIGHT', instruction: 'Rẽ phải vào Ngõ 245 Nguyễn Văn Cừ, Phường Ngọc Lâm, Quận Long Biên', meters: 300, bearing: 130 },
  { maneuver: 'STRAIGHT', instruction: 'Đi thẳng đến Số 18 Ngõ 245', meters: 250, bearing: 130 },
];

const rad = (d: number) => (d * Math.PI) / 180;

function offset(p: LatLng, meters: number, bearingDeg: number): LatLng {
  const b = rad(bearingDeg);
  return {
    lat: p.lat + (meters * Math.cos(b)) / 111_320,
    lng: p.lng + (meters * Math.sin(b)) / (111_320 * Math.cos(rad(p.lat))),
  };
}

function buildRoute(): Route {
  const steps: RouteStep[] = [];
  let at = SIM_ORIGIN;
  for (const leg of LEGS) {
    const end = offset(at, leg.meters, leg.bearing);
    const distanceMeters = Math.round(haversine(at, end));
    steps.push({
      // The first step has no entering maneuver in the real API either.
      maneuver: leg.maneuver === 'DEPART' ? '' : leg.maneuver,
      instruction: leg.instruction,
      distanceMeters,
      durationSec: Math.round(distanceMeters / ROUTE_SPEED_MS),
      start: at,
      end,
    });
    at = end;
  }
  return {
    distanceMeters: steps.reduce((n, s) => n + s.distanceMeters, 0),
    durationSec: steps.reduce((n, s) => n + s.durationSec, 0),
    steps,
  };
}

export const SIM_ROUTE: Route = buildRoute();

/** Point `along` metres from the start of the route (clamped), moving along the step segments. */
export function positionAlong(route: Route, along: number): LatLng {
  let left = Math.max(0, along);
  for (const s of route.steps) {
    if (left <= s.distanceMeters) {
      const f = s.distanceMeters > 0 ? left / s.distanceMeters : 1;
      return { lat: s.start.lat + (s.end.lat - s.start.lat) * f, lng: s.start.lng + (s.end.lng - s.start.lng) * f };
    }
    left -= s.distanceMeters;
  }
  return route.steps[route.steps.length - 1]!.end;
}

export interface SimOptions {
  speedKmh?: number;
  intervalSec?: number;
  frames?: number;
  /** Wall clock the trip "starts" at (ETA = start + t + remaining). Default is a fixed local time. */
  startMs?: number;
  route?: Route;
}

export interface SimFrame {
  /** Simulated seconds since departure (first frame = intervalSec). */
  tSec: number;
  /** Metres travelled along the route. */
  alongMeters: number;
  position: LatLng;
  data: DirectionsData;
  key: string;
}

export const SIM_DEFAULTS = { speedKmh: 35, intervalSec: 30, frames: 10 } as const;
const DEFAULT_START_MS = new Date(2026, 9, 12, 8, 0, 0).getTime();

/** Frames needed to reach the destination at the given speed and interval. */
export function framesToArrive(speedKmh: number, intervalSec: number, route: Route = SIM_ROUTE): number {
  const mps = Math.max(0.1, speedKmh) / 3.6;
  return Math.max(1, Math.ceil(route.distanceMeters / (mps * Math.max(1, intervalSec))));
}

/**
 * Moves a virtual phone along the route at a constant speed and samples it every `intervalSec`,
 * running the real computeProgress + directionsKey on each sample. Pure and deterministic.
 */
export function simulateTrip(opts: SimOptions = {}): SimFrame[] {
  const speedKmh = opts.speedKmh ?? SIM_DEFAULTS.speedKmh;
  const intervalSec = opts.intervalSec ?? SIM_DEFAULTS.intervalSec;
  const frames = Math.max(1, Math.floor(opts.frames ?? SIM_DEFAULTS.frames));
  const startMs = opts.startMs ?? DEFAULT_START_MS;
  const route = opts.route ?? SIM_ROUTE;
  const mps = Math.max(0.1, speedKmh) / 3.6;
  const out: SimFrame[] = [];
  let minIndex = 0;
  for (let i = 1; i <= frames; i++) {
    const tSec = i * intervalSec;
    const alongMeters = Math.min(route.distanceMeters, mps * tSec);
    const position = positionAlong(route, alongMeters);
    const p = computeProgress(route, position, minIndex);
    minIndex = p.index;
    const data: DirectionsData = {
      maneuver: p.maneuver,
      instruction: p.arrived || p.maneuver === 'ARRIVE' ? 'Đến nơi' : p.instruction,
      distanceToManeuver: p.distanceToManeuver,
      remainingMeters: p.remainingMeters,
      etaMs: startMs + (tSec + p.remainingSec) * 1000,
      arrived: p.arrived,
      destination: SIM_DESTINATION,
    };
    out.push({ tSec, alongMeters, position, data, key: directionsKey(data) });
  }
  return out;
}

/** Rough per-refresh transfer overhead (prepare + chunked writes of one or two 4736-byte planes). */
const TRANSFER_MS: Record<PaletteName, number> = { bw: 1500, bwr: 2500 };

export interface SimRefresh {
  frame: number;
  method: RefreshMethod;
  ghostClear: boolean;
  /** Estimated transfer + panel busy time. */
  durationMs: number;
}

export interface SimSummary {
  /** Per frame: the refresh it triggers, or null when the key did not change. */
  refreshes: (SimRefresh | null)[];
  refreshCount: number;
  totalMs: number;
  /** Frame indices whose refresh takes longer than the interval to the next frame. */
  tooSlow: number[];
}

/** Mirrors the runner: send when the key changed vs the last *sent* frame; bw starts with a full refresh, then fast path with ghost clearing. */
export function summarizeTrip(frames: SimFrame[], palette: PaletteName, ghostClearEvery: number, intervalSec: number): SimSummary {
  let lastKey: string | undefined;
  let fastSinceClear = 0;
  let first = true;
  const refreshes: (SimRefresh | null)[] = [];
  const tooSlow: number[] = [];
  let totalMs = 0;
  frames.forEach((f, i) => {
    if (f.key === lastKey) {
      refreshes.push(null);
      return;
    }
    lastKey = f.key;
    const c = chooseMethod(palette, ghostClearEvery, fastSinceClear, first);
    first = false;
    fastSinceClear = c.method === 'fast' ? fastSinceClear + 1 : 0;
    const durationMs = (c.method === 'fast' ? BUSY_MS_BW_FAST : BUSY_MS_BWR) + TRANSFER_MS[palette];
    refreshes.push({ frame: i, method: c.method, ghostClear: c.ghostClear, durationMs });
    totalMs += durationMs;
    if (durationMs > intervalSec * 1000) tooSlow.push(i);
  });
  return { refreshes, refreshCount: refreshes.filter(Boolean).length, totalMs, tooSlow };
}

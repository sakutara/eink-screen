import type { LatLng, Route } from '../../integrations/googleMaps';

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distance from p to the straight segment a-b (local equirectangular projection, fine at city scale). */
export function distanceToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  const k = Math.cos(rad(p.lat));
  const x = (q: LatLng) => rad(q.lng) * k * R;
  const y = (q: LatLng) => rad(q.lat) * R;
  const px = x(p), py = y(p), ax = x(a), ay = y(a), bx = x(b), by = y(b);
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export interface Progress {
  /** Index of the step the user is currently on. */
  index: number;
  /** Distance from the route (to the nearest step segment). */
  offRouteMeters: number;
  distanceToManeuver: number;
  /** Maneuver at the end of the current step; 'ARRIVE' on the last one. */
  maneuver: string;
  instruction: string;
  remainingMeters: number;
  remainingSec: number;
  arrived: boolean;
}

export const ARRIVE_RADIUS_M = 30;

/**
 * Locates `pos` on the route. The step index never goes below `minIndex`
 * so noisy GPS cannot jump backwards.
 */
export function computeProgress(route: Route, pos: LatLng, minIndex = 0): Progress {
  const steps = route.steps;
  if (steps.length === 0) throw new Error('Tuyến đường không có bước nào');
  let index = Math.min(minIndex, steps.length - 1);
  let best = Infinity;
  for (let i = index; i < steps.length; i++) {
    const s = steps[i]!;
    const d = distanceToSegment(pos, s.start, s.end);
    if (d < best - 1e-6) {
      best = d;
      index = i;
    }
  }
  const cur = steps[index]!;
  const toEnd = haversine(pos, cur.end);
  const isLast = index === steps.length - 1;
  const next = steps[index + 1];
  const fraction = cur.distanceMeters > 0 ? Math.min(1, toEnd / cur.distanceMeters) : 0;
  let restMeters = 0, restSec = 0;
  for (let i = index + 1; i < steps.length; i++) {
    restMeters += steps[i]!.distanceMeters;
    restSec += steps[i]!.durationSec;
  }
  return {
    index,
    offRouteMeters: best,
    distanceToManeuver: toEnd,
    maneuver: isLast ? 'ARRIVE' : next?.maneuver ?? 'STRAIGHT',
    instruction: isLast ? '' : next?.instruction ?? '',
    remainingMeters: toEnd + restMeters,
    remainingSec: cur.durationSec * fraction + restSec,
    arrived: isLast && toEnd <= ARRIVE_RADIUS_M,
  };
}

/** Coarse distance buckets so tiny GPS changes do not refresh the (slow) panel. */
export function distanceBucket(m: number): string {
  if (m < 100) return '<100';
  const step = m < 300 ? 50 : m < 1000 ? 100 : m < 2000 ? 250 : 500;
  return String(Math.round(m / step) * step);
}

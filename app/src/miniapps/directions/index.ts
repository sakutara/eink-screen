import { GOOGLE_MAPS_ID, TRAVEL_MODES, type GoogleMapsClient, type LatLng, type Route, type TravelMode } from '../../integrations/googleMaps';
import type { PlaceValue } from '../../integrations/types';
import { ctxMeasure, ellipsize, wrapText } from '../../render/text';
import { formatClock, formatDistance } from '../format';
import type { MiniApp } from '../types';
import { computeProgress, distanceBucket, haversine } from './geo';
import { drawManeuver } from './maneuvers';

export interface DirectionsSettings extends Record<string, unknown> {
  destination: PlaceValue | null;
  mode: TravelMode;
  rerouteSec: number;
}

export interface DirectionsData {
  maneuver: string;
  instruction: string;
  distanceToManeuver: number;
  remainingMeters: number;
  etaMs: number;
  arrived: boolean;
  destination: string;
}

const FONT = 'system-ui, "Segoe UI", Roboto, "Noto Sans", sans-serif';
const OFF_ROUTE_M = 80;
const MOVED_M = 100;
const MIN_REFETCH_MS = 15_000;

/** Panel only refreshes when the maneuver, text or a coarse distance bucket changes. */
export const directionsKey = (d: DirectionsData): string =>
  [d.maneuver, d.arrived ? 'arrived' : distanceBucket(d.distanceToManeuver), d.instruction].join('|');

export const directionsMiniApp: MiniApp<DirectionsSettings, DirectionsData> = {
  id: 'directions',
  name: 'Chỉ đường',
  description: 'Mũi tên rẽ, khoảng cách, tên đường và thời gian đến, theo vị trí GPS của điện thoại.',
  requires: [GOOGLE_MAPS_ID],
  settingsSchema: [
    { key: 'destination', label: 'Điểm đến', type: 'place', integration: GOOGLE_MAPS_ID, required: true },
    { key: 'mode', label: 'Phương tiện', type: 'select', options: TRAVEL_MODES.map((m) => ({ value: m.value, label: m.label })) },
    {
      key: 'rerouteSec', label: 'Tính lại tuyến mỗi', type: 'number', min: 20, max: 600, step: 10, unit: 'giây',
      help: 'Chỉ gọi lại khi đã di chuyển hơn 100 m; lệch tuyến hơn 80 m thì tính lại ngay.',
    },
  ],
  defaultSettings: { destination: null, mode: 'DRIVE', rerouteSec: 60 },
  pollIntervalMs: () => 5000,

  async start(ctx) {
    const { destination, mode } = ctx.settings;
    if (!destination?.placeId) throw new Error('Chưa chọn điểm đến');
    if (!navigator.geolocation) throw new Error('Trình duyệt không có định vị');
    const maps = await ctx.client<GoogleMapsClient>(GOOGLE_MAPS_ID);
    const rerouteMs = Math.max(20, Number(ctx.settings.rerouteSec) || 60) * 1000;

    let pos: LatLng | undefined;
    let geoError: string | undefined;
    const watchId = navigator.geolocation.watchPosition(
      (p) => {
        pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        geoError = undefined;
      },
      (e) => { geoError = `Không lấy được vị trí: ${e.message}`; },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );

    let route: Route | undefined;
    let fetchedAt = 0;
    let fetchedFrom: LatLng | undefined;
    let minIndex = 0;

    const refetch = async (from: LatLng) => {
      fetchedAt = Date.now();
      fetchedFrom = from;
      route = await maps.computeRoute(from, { placeId: destination.placeId }, mode);
      minIndex = 0;
      ctx.log(`Đã tính tuyến: ${route.steps.length} bước, ${formatDistance(route.distanceMeters)}`);
    };

    return {
      async tick() {
        if (!pos) {
          if (geoError) throw new Error(geoError);
          return null;
        }
        const now = Date.now();
        let off = route ? computeProgress(route, pos, minIndex).offRouteMeters : Infinity;
        const since = now - fetchedAt;
        const moved = fetchedFrom ? haversine(fetchedFrom, pos) : Infinity;
        const need = !route
          || (off > OFF_ROUTE_M && since > MIN_REFETCH_MS)
          || (since >= rerouteMs && moved > MOVED_M);
        if (need) {
          try {
            await refetch(pos);
            off = 0;
          } catch (e) {
            if (!route) throw e;
            ctx.log(`Tính lại tuyến thất bại, dùng tuyến cũ: ${e instanceof Error ? e.message : e}`);
          }
        }
        const p = computeProgress(route as Route, pos, minIndex);
        minIndex = p.index;
        return {
          maneuver: p.maneuver,
          instruction: p.arrived || p.maneuver === 'ARRIVE' ? 'Đến nơi' : p.instruction,
          distanceToManeuver: p.distanceToManeuver,
          remainingMeters: p.remainingMeters,
          etaMs: Date.now() + p.remainingSec * 1000,
          arrived: p.arrived,
          destination: destination.label,
        };
      },
      stop() {
        navigator.geolocation.clearWatch(watchId);
      },
    };
  },

  key: directionsKey,

  render(ctx, d, { width, height, palette }) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    const accent = palette === 'bwr' ? '#f00' : '#000';
    drawManeuver(ctx, d.arrived ? 'ARRIVE' : d.maneuver, 62, 64, 112, accent);

    const x = 132, maxW = width - x - 6;
    const measure = ctxMeasure(ctx);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#000';
    ctx.font = `bold 28px ${FONT}`;
    ctx.fillText(d.arrived ? 'Đã đến' : formatDistance(d.distanceToManeuver), x, 4);

    // Bold: the black/white fast path (ADR-10) blurs thin strokes; sizes kept moderate for 3 lines.
    ctx.font = `bold 15px ${FONT}`;
    const lines = wrapText(measure, d.instruction || (d.arrived ? d.destination : ''), maxW, 3);
    lines.forEach((line, i) => ctx.fillText(line, x, 38 + i * 18));

    ctx.font = `bold 13px ${FONT}`;
    ctx.textBaseline = 'bottom';
    const footer = `Còn ${formatDistance(d.remainingMeters)} · ${formatClock(new Date(d.etaMs))}`;
    ctx.fillText(ellipsize(measure, footer, maxW), x, height - 4);
  },
};

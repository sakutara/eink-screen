import type { Integration, Values } from './types';

export const GOOGLE_MAPS_ID = 'googleMaps';
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const SEARCH_TEXT_URL = 'https://places.googleapis.com/v1/places:searchText';

export type TravelMode = 'DRIVE' | 'TWO_WHEELER' | 'WALK' | 'BICYCLE';

export const TRAVEL_MODES: { value: TravelMode; label: string }[] = [
  { value: 'DRIVE', label: 'Ô tô' },
  { value: 'TWO_WHEELER', label: 'Xe máy' },
  { value: 'WALK', label: 'Đi bộ' },
  { value: 'BICYCLE', label: 'Xe đạp' },
];

export interface LatLng { lat: number; lng: number }

export interface RouteStep {
  /** Maneuver needed to ENTER this step (empty for the first one). */
  maneuver: string;
  instruction: string;
  distanceMeters: number;
  durationSec: number;
  start: LatLng;
  end: LatLng;
}

export interface Route {
  distanceMeters: number;
  durationSec: number;
  steps: RouteStep[];
}

export type Destination = { placeId: string } | LatLng;

export interface PlaceSuggestion {
  placeId: string;
  text: string;
}

export interface GoogleMapsClient {
  computeRoute(origin: LatLng, destination: Destination, mode: TravelMode): Promise<Route>;
  autocomplete(input: string, sessionToken: string, near?: LatLng): Promise<PlaceSuggestion[]>;
  /** Best match for a free-text query (e.g. a place shared from Google Maps); null when nothing matches. */
  searchPlace(query: string, near?: LatLng): Promise<PlaceSuggestion | null>;
}

const MAPS_TRAVEL_MODE: Record<TravelMode, string> = {
  DRIVE: 'driving',
  TWO_WHEELER: 'two-wheeler',
  WALK: 'walking',
  BICYCLE: 'bicycling',
};

/** Google Maps URLs API link that starts turn-by-turn navigation to a place. */
export function mapsNavigationUrl(dest: { placeId: string; label: string }, mode: TravelMode): string {
  const q = new URLSearchParams({
    api: '1',
    destination: dest.label,
    destination_place_id: dest.placeId,
    travelmode: MAPS_TRAVEL_MODE[mode],
    dir_action: 'navigate',
  });
  return `https://www.google.com/maps/dir/?${q}`;
}

/** Android intent URL that opens {@link mapsNavigationUrl} directly in the Maps app (no-op when it is not installed). */
export function mapsIntentUrl(dest: { placeId: string; label: string }, mode: TravelMode): string {
  const https = mapsNavigationUrl(dest, mode);
  return `intent://${https.replace(/^https:\/\//, '')}#Intent;scheme=https;package=com.google.android.apps.maps;end`;
}

const FIELD_MASK = [
  'routes.duration',
  'routes.distanceMeters',
  'routes.legs.steps.navigationInstruction',
  'routes.legs.steps.distanceMeters',
  'routes.legs.steps.staticDuration',
  'routes.legs.steps.startLocation',
  'routes.legs.steps.endLocation',
].join(',');

/** "123s" / "123.5s" -> seconds. */
export const parseDuration = (d: unknown): number => {
  const m = /^(-?\d+(?:\.\d+)?)s$/.exec(String(d ?? ''));
  return m ? Number(m[1]) : 0;
};

const latLng = (l: { latLng?: { latitude: number; longitude: number } } | undefined): LatLng => ({
  lat: l?.latLng?.latitude ?? 0,
  lng: l?.latLng?.longitude ?? 0,
});

interface ApiStep {
  navigationInstruction?: { maneuver?: string; instructions?: string };
  distanceMeters?: number;
  staticDuration?: string;
  startLocation?: { latLng?: { latitude: number; longitude: number } };
  endLocation?: { latLng?: { latitude: number; longitude: number } };
}

export function mapRoute(json: unknown): Route {
  const r = (json as { routes?: { duration?: string; distanceMeters?: number; legs?: { steps?: ApiStep[] }[] }[] })?.routes?.[0];
  if (!r) throw new Error('Không tìm được tuyến đường');
  const steps: RouteStep[] = (r.legs ?? []).flatMap((leg) => leg.steps ?? []).map((s) => ({
    maneuver: s.navigationInstruction?.maneuver ?? '',
    instruction: s.navigationInstruction?.instructions ?? '',
    distanceMeters: s.distanceMeters ?? 0,
    durationSec: parseDuration(s.staticDuration),
    start: latLng(s.startLocation),
    end: latLng(s.endLocation),
  }));
  return {
    distanceMeters: r.distanceMeters ?? steps.reduce((n, s) => n + s.distanceMeters, 0),
    durationSec: parseDuration(r.duration) || steps.reduce((n, s) => n + s.durationSec, 0),
    steps,
  };
}

async function failure(res: Response): Promise<Error> {
  let detail = '';
  try {
    detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '';
  } catch { /* ignore */ }
  return new Error(`Google Maps lỗi ${res.status}${detail ? `: ${detail}` : ''}`);
}

export function createClient(cfg: Values): GoogleMapsClient {
  const key = String(cfg.apiKey ?? '').trim();
  return {
    async computeRoute(origin, destination, mode) {
      const wp = (d: Destination) => ('placeId' in d
        ? { placeId: d.placeId }
        : { location: { latLng: { latitude: d.lat, longitude: d.lng } } });
      const body: Record<string, unknown> = {
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: wp(destination),
        travelMode: mode,
        languageCode: 'vi',
        units: 'METRIC',
      };
      if (mode === 'DRIVE' || mode === 'TWO_WHEELER') body.routingPreference = 'TRAFFIC_AWARE';
      const res = await fetch(ROUTES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw await failure(res);
      return mapRoute(await res.json());
    },

    async autocomplete(input, sessionToken, near) {
      const body: Record<string, unknown> = { input, languageCode: 'vi', sessionToken };
      if (near) body.locationBias = { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50000 } };
      const res = await fetch(AUTOCOMPLETE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw await failure(res);
      const j = (await res.json()) as { suggestions?: { placePrediction?: { placeId: string; text?: { text: string } } }[] };
      return (j.suggestions ?? [])
        .map((s) => s.placePrediction)
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => ({ placeId: p.placeId, text: p.text?.text ?? p.placeId }));
    },

    async searchPlace(query, near) {
      const body: Record<string, unknown> = { textQuery: query, languageCode: 'vi', pageSize: 1 };
      if (near) body.locationBias = { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 2000 } };
      const res = await fetch(SEARCH_TEXT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw await failure(res);
      const place = ((await res.json()) as { places?: { id: string; displayName?: { text?: string }; formattedAddress?: string }[] }).places?.[0];
      if (!place) return null;
      return { placeId: place.id, text: place.displayName?.text || place.formattedAddress || query };
    },
  };
}

export const googleMaps: Integration<GoogleMapsClient> = {
  id: GOOGLE_MAPS_ID,
  name: 'Google Maps',
  description: 'Chỉ đường (Routes API) và gợi ý địa điểm (Places API New) bằng API key của bạn.',
  configFields: [
    {
      key: 'apiKey', label: 'API key', type: 'password', required: true,
      help: 'Bật Routes API và Places API (New) trong Google Cloud, giới hạn key theo HTTP referrer của trang này.',
    },
  ],
  auth: { kind: 'apiKey' },
  isReady: (cfg) => String(cfg.apiKey ?? '').trim().length > 0,

  async test(cfg) {
    const client = createClient(cfg);
    const [places, routes] = await Promise.allSettled([
      client.autocomplete('Hà Nội', 'test'),
      client.computeRoute({ lat: 21.0285, lng: 105.8542 }, { lat: 21.0245, lng: 105.8412 }, 'DRIVE'),
    ]);
    const line = (name: string, r: PromiseSettledResult<unknown>) =>
      `${name}: ${r.status === 'fulfilled' ? 'OK' : (r.reason as Error).message}`;
    const summary = `${line('Places', places)}\n${line('Routes', routes)}`;
    if (places.status === 'rejected' && routes.status === 'rejected') throw new Error(summary);
    return summary;
  },

  getClient: createClient,
};

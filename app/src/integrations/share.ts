import type { LatLng } from './googleMaps';

/** Fields of the Web Share Target GET request (`?title=&text=&url=`). */
export interface ShareParams {
  title?: string;
  text?: string;
  url?: string;
}

export interface SharedPlace {
  /** Free-text query for Places Text Search: name + address lines Google Maps put in the share text. */
  query: string;
  /** The Maps link, when present (short links cannot be resolved from a browser: CORS). */
  url?: string;
  /** Coordinates from a long Maps URL, used only as a location bias. */
  coords?: LatLng;
}

const URL_RE = /https?:\/\/[^\s]+/g;
const MAPS_HOST_RE = /^https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)/i;

/** Drops trailing punctuation that chat apps glue onto links. */
const cleanUrl = (u: string): string => u.replace(/[)\].,;]+$/, '');

function coordsFromUrl(url: string): LatLng | undefined {
  const m = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url)
    ?? /[?&](?:q|query|destination|ll)=(-?\d+(?:\.\d+)?)(?:,|%2C)(-?\d+(?:\.\d+)?)/i.exec(url);
  if (!m) return undefined;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : undefined;
}

/** `/maps/place/Ten+Dia+Diem/@...` -> "Ten Dia Diem". */
function nameFromUrl(url: string): string | undefined {
  const m = /\/maps\/place\/([^/@?]+)/.exec(url);
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1]!.replace(/\+/g, ' ')).trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Turns what Google Maps shares ("Tên\nĐịa chỉ\nhttps://maps.app.goo.gl/...") into a search query.
 * Returns null when nothing usable is there (no text lines and no place name in the URL).
 */
export function parseSharedPlace(p: ShareParams): SharedPlace | null {
  const raw = [p.title, p.text, p.url].filter((s): s is string => !!s && s.trim().length > 0).join('\n');
  if (!raw) return null;
  const urls = (raw.match(URL_RE) ?? []).map(cleanUrl);
  const url = urls.find((u) => MAPS_HOST_RE.test(u)) ?? urls[0];

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const line of raw.replace(URL_RE, '').split(/\r?\n/)) {
    const t = line.trim();
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      lines.push(t);
    }
  }

  const coords = url ? coordsFromUrl(url) : undefined;
  const query = lines.join(', ') || (url ? nameFromUrl(url) : undefined) || '';
  if (!query) return null;
  return { query, ...(url ? { url } : {}), ...(coords ? { coords } : {}) };
}

/** Reads share-target params from a URL search string; null when this load was not a share. */
export function shareParamsFromSearch(search: string): ShareParams | null {
  const q = new URLSearchParams(search);
  if (q.has('code') || q.has('error')) return null; // OAuth callback
  const params: ShareParams = {};
  for (const k of ['title', 'text', 'url'] as const) {
    const v = q.get(k);
    if (v) params[k] = v;
  }
  return Object.keys(params).length > 0 ? params : null;
}

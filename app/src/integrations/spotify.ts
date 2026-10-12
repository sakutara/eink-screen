import { del, get, set } from 'idb-keyval';
import { clearTokens, loadTokens, saveTokens } from './store';
import { codeChallenge, generateVerifier, randomState } from './pkce';
import type { Integration, StoredTokens, Values } from './types';

export const SPOTIFY_ID = 'spotify';
const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const SCOPES = ['user-read-currently-playing', 'user-read-playback-state'];
const PENDING_KEY = 'spotify:pkce';

export interface NowPlaying {
  id: string;
  title: string;
  artists: string;
  album: string;
  /** Release year, or null when unknown. */
  year: number | null;
  durationMs: number;
  coverUrl: string | null;
  isPlaying: boolean;
}

export interface SpotifyClient {
  getCurrentlyPlaying(): Promise<NowPlaying | null>;
}

/** Redirect URI = page URL without query/hash; it must be registered in the Spotify dashboard. */
export const redirectUri = (): string => location.origin + location.pathname;

interface SpotifyImage { url: string; width?: number | null }

/** Maps the `currently-playing` JSON to {@link NowPlaying}; null when nothing usable is playing. */
export function mapCurrentlyPlaying(json: unknown): NowPlaying | null {
  const j = json as { is_playing?: boolean; item?: Record<string, unknown> | null } | null;
  const item = j?.item as {
    id?: string; name?: string; duration_ms?: number; type?: string; release_date?: string;
    artists?: { name: string }[]; album?: { name?: string; release_date?: string; images?: SpotifyImage[] };
    show?: { name?: string; publisher?: string; images?: SpotifyImage[] }; images?: SpotifyImage[];
  } | null | undefined;
  if (!item?.id || !item.name) return null;

  const isEpisode = item.type === 'episode';
  const releaseDate = isEpisode ? item.release_date : item.album?.release_date;
  const yearMatch = /^(\d{4})/.exec(releaseDate ?? '');
  return {
    id: item.id,
    title: item.name,
    artists: isEpisode
      ? item.show?.publisher || item.show?.name || ''
      : (item.artists ?? []).map((a) => a.name).join(', '),
    album: isEpisode ? item.show?.name ?? '' : item.album?.name ?? '',
    year: yearMatch ? Number(yearMatch[1]) : null,
    durationMs: item.duration_ms ?? 0,
    coverUrl: pickCover(isEpisode ? item.images ?? item.show?.images : item.album?.images),
    isPlaying: !!j?.is_playing,
  };
}

/** Smallest image that is at least 128px wide, otherwise the largest available. */
export function pickCover(images: SpotifyImage[] | undefined): string | null {
  if (!images?.length) return null;
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((i) => (i.width ?? 0) >= 128) ?? sorted[sorted.length - 1])?.url ?? null;
}

const clientId = (cfg: Values): string => String(cfg.clientId ?? '').trim();

async function tokenRequest(body: Record<string, string>): Promise<StoredTokens & { refreshToken: string }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Spotify từ chối token (${res.status}): ${text.slice(0, 200)}`);
  }
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? body.refresh_token ?? '',
    expiresAt: Date.now() + j.expires_in * 1000,
  };
}

async function validAccessToken(cfg: Values, force = false): Promise<string> {
  const tokens = await loadTokens(SPOTIFY_ID);
  if (!tokens) throw new Error('Chưa kết nối Spotify');
  if (!force && tokens.expiresAt - Date.now() > 30_000) return tokens.accessToken;
  if (!tokens.refreshToken) throw new Error('Phiên Spotify hết hạn, hãy kết nối lại');
  const next = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: clientId(cfg),
  });
  await saveTokens(SPOTIFY_ID, next);
  return next.accessToken;
}

export function createClient(cfg: Values): SpotifyClient {
  return {
    async getCurrentlyPlaying() {
      for (let attempt = 0; attempt < 2; attempt++) {
        const token = await validAccessToken(cfg, attempt > 0);
        const res = await fetch(`${API}/me/player/currently-playing?additional_types=track,episode`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 204) return null;
        if (res.status === 401 && attempt === 0) continue;
        if (res.status === 429) throw new Error(`Spotify giới hạn tần suất, thử lại sau ${res.headers.get('Retry-After') ?? '?'}s`);
        if (!res.ok) throw new Error(`Spotify lỗi ${res.status}`);
        return mapCurrentlyPlaying(await res.json());
      }
      throw new Error('Spotify từ chối token');
    },
  };
}

export const spotify: Integration<SpotifyClient> = {
  id: SPOTIFY_ID,
  name: 'Spotify',
  description: 'Lấy bài đang phát (cần tài khoản Spotify và Client ID tự đăng ký).',
  configFields: [
    {
      key: 'clientId', label: 'Client ID', type: 'text', required: true,
      help: 'Tạo app tại developer.spotify.com/dashboard, rồi thêm Redirect URI bên dưới vào app. Spotify yêu cầu HTTPS hoặc http://127.0.0.1.',
    },
  ],
  auth: { kind: 'oauthPkce', scopes: SCOPES },
  isReady: (cfg, tokens) => !!clientId(cfg) && !!tokens,
  info: () => [{ label: 'Redirect URI', value: redirectUri() }],

  async connect(cfg) {
    const id = clientId(cfg);
    if (!id) throw new Error('Nhập Client ID trước');
    const verifier = generateVerifier();
    const state = randomState();
    await set(PENDING_KEY, { verifier, state });
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
      client_id: id,
      response_type: 'code',
      redirect_uri: redirectUri(),
      scope: SCOPES.join(' '),
      code_challenge_method: 'S256',
      code_challenge: await codeChallenge(verifier),
      state,
    }).toString();
    location.assign(url.toString());
  },

  async handleRedirect(cfg) {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const error = params.get('error');
    const state = params.get('state');
    if (!code && !error) return false;
    const pending = await get<{ verifier: string; state: string }>(PENDING_KEY);
    if (!pending || pending.state !== state) return false; // not ours (or stale)
    await del(PENDING_KEY);
    history.replaceState(null, '', location.pathname + '#/links');
    if (error) throw new Error(`Spotify báo lỗi: ${error}`);
    const tokens = await tokenRequest({
      grant_type: 'authorization_code',
      code: code as string,
      redirect_uri: redirectUri(),
      client_id: clientId(cfg),
      code_verifier: pending.verifier,
    });
    await saveTokens(SPOTIFY_ID, tokens);
    return true;
  },

  async test(cfg) {
    const np = await createClient(cfg).getCurrentlyPlaying();
    return np ? `Đang phát: ${np.title} – ${np.artists}` : 'Kết nối tốt, hiện không có bài nào đang phát.';
  },

  getClient: createClient,
};

export const disconnectSpotify = (): Promise<void> => clearTokens(SPOTIFY_ID);

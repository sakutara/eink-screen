import { SPOTIFY_ID, type NowPlaying, type SpotifyClient } from '../../integrations/spotify';
import { drawCover } from '../../render/canvas';
import { ctxMeasure, ellipsize, wrapText } from '../../render/text';
import { formatDuration } from '../format';
import type { MiniApp } from '../types';

export interface SpotifySettings extends Record<string, unknown> {
  pollSec: number;
}

export interface SpotifyData {
  track: NowPlaying;
  cover: ImageBitmap | null;
}

const FONT = 'system-ui, "Segoe UI", Roboto, "Noto Sans", sans-serif';
const COVER = 128;

/** Only the track id matters: play/pause and progress must not refresh the panel. */
export const spotifyKey = (d: Pick<SpotifyData, 'track'>): string => d.track.id;

async function loadCover(url: string | null): Promise<ImageBitmap | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}

export const spotifyMiniApp: MiniApp<SpotifySettings, SpotifyData> = {
  id: 'spotify',
  name: 'Spotify',
  description: 'Bài đang phát: ảnh bìa, tên bài, nghệ sĩ, năm và thời lượng. Chỉ cập nhật màn khi đổi bài.',
  requires: [SPOTIFY_ID],
  settingsSchema: [
    { key: 'pollSec', label: 'Hỏi Spotify mỗi', type: 'number', min: 5, max: 120, step: 1, unit: 'giây' },
  ],
  defaultSettings: { pollSec: 12 },
  pollIntervalMs: (s) => Math.max(5, Number(s.pollSec) || 12) * 1000,

  async start(ctx) {
    const client = await ctx.client<SpotifyClient>(SPOTIFY_ID);
    let lastId: string | undefined;
    let lastCover: ImageBitmap | null = null;
    return {
      async tick() {
        const track = await client.getCurrentlyPlaying();
        if (!track) return null;
        if (track.id !== lastId) {
          lastCover?.close();
          lastCover = await loadCover(track.coverUrl);
          lastId = track.id;
        }
        return { track, cover: lastCover };
      },
      stop() {
        lastCover?.close();
        lastCover = null;
      },
    };
  },

  key: spotifyKey,

  render(ctx, { track, cover }, { width, height, palette }) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);

    if (cover) {
      drawCover(ctx, cover as unknown as CanvasImageSource & { width: number; height: number }, COVER, COVER);
    } else {
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, COVER - 2, COVER - 2);
      ctx.fillStyle = '#000';
      ctx.font = `bold 64px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('♪', COVER / 2, COVER / 2);
    }

    const x = COVER + 10;
    const maxW = width - x - 6;
    const measure = ctxMeasure(ctx);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    ctx.font = `bold 18px ${FONT}`;
    ctx.fillStyle = '#000';
    const titleLines = wrapText(measure, track.title, maxW, 2);
    let y = 6;
    for (const line of titleLines) {
      ctx.fillText(line, x, y);
      y += 22;
    }

    ctx.font = `14px ${FONT}`;
    ctx.fillStyle = palette === 'bwr' ? '#e00' : '#000';
    ctx.fillText(ellipsize(measure, track.artists, maxW), x, y + 6);

    ctx.fillStyle = '#000';
    ctx.font = `13px ${FONT}`;
    const meta = [track.year ? String(track.year) : null, track.durationMs ? formatDuration(track.durationMs) : null]
      .filter(Boolean)
      .join('  ·  ');
    ctx.textBaseline = 'bottom';
    if (track.album) ctx.fillText(ellipsize(measure, track.album, maxW), x, height - 24);
    ctx.font = `bold 15px ${FONT}`;
    ctx.fillText(meta, x, height - 6);
  },
};

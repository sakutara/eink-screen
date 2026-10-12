import type { MiniApp } from '../types';
import { directionsMiniApp, type DirectionsData } from './index';
import { SIM_DEFAULTS, framesToArrive, simulateTrip } from './simulation';

export interface DirectionsSimSettings extends Record<string, unknown> {
  intervalSec: number;
  speedKmh: number;
  loop: boolean;
}

const num = (v: unknown, fallback: number, min: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, n) : fallback;
};

/**
 * Scripted trip for the "Chỉ đường" miniapp without GPS or API: every poll returns the next
 * simulated frame. Rendering and change detection are the real ones from directionsMiniApp.
 */
export const directionsSimMiniApp: MiniApp<DirectionsSimSettings, DirectionsData> = {
  id: 'directions-sim',
  name: 'Chỉ đường (mô phỏng)',
  description: 'Chuyến đi giả lập (~2,9 km, 9 bước), mỗi lần hỏi trả về một khung kế tiếp: dùng để thử màn mà không cần GPS hay API key.',
  requires: [],
  settingsSchema: [
    { key: 'intervalSec', label: 'Khoảng giữa hai khung', type: 'number', min: 5, max: 300, step: 5, unit: 'giây',
      help: 'Thời gian chạy mô phỏng giữa hai lần lấy khung; cũng là chu kỳ hỏi dữ liệu.' },
    { key: 'speedKmh', label: 'Tốc độ giả lập', type: 'number', min: 5, max: 120, step: 5, unit: 'km/h' },
    { key: 'loop', label: 'Lặp lại khi đã đến nơi', type: 'checkbox' },
  ],
  defaultSettings: { intervalSec: SIM_DEFAULTS.intervalSec, speedKmh: SIM_DEFAULTS.speedKmh, loop: true },
  pollIntervalMs: (s) => num(s.intervalSec, SIM_DEFAULTS.intervalSec, 5) * 1000,

  async start(ctx) {
    const intervalSec = num(ctx.settings.intervalSec, SIM_DEFAULTS.intervalSec, 5);
    const speedKmh = num(ctx.settings.speedKmh, SIM_DEFAULTS.speedKmh, 1);
    const frames = simulateTrip({ speedKmh, intervalSec, frames: framesToArrive(speedKmh, intervalSec) });
    const loop = ctx.settings.loop !== false;
    let i = 0;
    ctx.log(`Mô phỏng ${frames.length} khung, mỗi ${intervalSec} giây, ${speedKmh} km/h`);
    return {
      async tick() {
        const f = frames[Math.min(i, frames.length - 1)]!;
        i = loop && i >= frames.length - 1 ? 0 : i + 1;
        return f.data;
      },
      stop() {},
    };
  },

  key: directionsMiniApp.key,
  render: (ctx, d, area) => directionsMiniApp.render(ctx, d, area, directionsMiniApp.defaultSettings),
};

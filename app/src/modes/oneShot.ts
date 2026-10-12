import { errMsg, type EpdDevice, type UploadProgress, type UploadTimings } from '../ble/device';
import { Mode, PANEL, sanitizeLabel, type CountdownParams } from '../ble/protocol';
import type { Ctx2D } from '../render/canvas';
import type { PaletteName } from '../render/dither';
import type { Planes } from '../render/pack';
import { rememberCountdown } from '../state/session';

export const showCalendar = (d: EpdDevice): Promise<void> => d.setMode(Mode.CALENDAR);
export const showClock = (d: EpdDevice, face: 1 | 2): Promise<void> => d.setMode(face === 1 ? Mode.CLOCK_1 : Mode.CLOCK_2);

/** Firmware may accept up to 16 label characters; asks the device (D8 FF), falling back to 8. */
export async function countdownMaxLabel(d: EpdDevice): Promise<number> {
  try {
    return await d.queryCountdownCaps();
  } catch {
    return 8;
  }
}

export interface CountdownInput {
  /** yyyy-mm-dd from <input type="date"> */
  date: string;
  label: string;
}

export function parseCountdown(input: CountdownInput, maxLabel: number): CountdownParams {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.date);
  if (!m) throw new Error('Chọn ngày hợp lệ');
  const label = sanitizeLabel(input.label, maxLabel);
  if (!label) throw new Error('Nhãn cần ít nhất một ký tự ASCII');
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), label };
}

/** Sets the countdown on the device and persists the params on the saved device (needed to restore mode 8 later). */
export async function applyCountdown(d: EpdDevice, params: CountdownParams): Promise<void> {
  await d.setCountdown(params);
  await rememberCountdown(params);
}

// ------------------------------------------------------------------ still image

export type FitMode = 'fit' | 'fill';

export interface FitOptions {
  mode: FitMode;
  /** -1..1: shifts the image along the axis with spare room (fill: the overflow, fit: the margin). */
  offsetX: number;
  offsetY: number;
}

export interface Placement { dx: number; dy: number; dw: number; dh: number }

export function computeFit(srcW: number, srcH: number, dstW: number, dstH: number, o: FitOptions): Placement {
  const scale = o.mode === 'fill' ? Math.max(dstW / srcW, dstH / srcH) : Math.min(dstW / srcW, dstH / srcH);
  const dw = srcW * scale, dh = srcH * scale;
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  return {
    dw, dh,
    dx: (dstW - dw) / 2 + (clamp(o.offsetX) * Math.abs(dstW - dw)) / 2,
    dy: (dstH - dh) / 2 + (clamp(o.offsetY) * Math.abs(dstH - dh)) / 2,
  };
}

export function drawStill(
  ctx: Ctx2D,
  src: CanvasImageSource & { width: number; height: number },
  o: FitOptions,
): void {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, PANEL.width, PANEL.height);
  const p = computeFit(src.width, src.height, PANEL.width, PANEL.height, o);
  ctx.drawImage(src, p.dx, p.dy, p.dw, p.dh);
}

export async function sendStill(
  d: EpdDevice,
  planes: Planes,
  onProgress?: (p: UploadProgress) => void,
  palette: PaletteName = 'bwr',
): Promise<UploadTimings> {
  try {
    // Palette bw has no red: use the black-only fast path.
    return palette === 'bw'
      ? await d.uploadBlackFast(planes.black, { onProgress })
      : await d.uploadImage(planes, { onProgress });
  } catch (e) {
    throw new Error(`Gửi ảnh thất bại: ${errMsg(e)}`);
  }
}

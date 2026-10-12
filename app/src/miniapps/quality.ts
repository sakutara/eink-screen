import type { FieldSpec } from '../integrations/types';
import type { PaletteName } from '../render/dither';
import type { QualitySettings } from './types';

/** Default minimum interval per palette: full 3-colour refresh ~15 s, black/white fast path (LUT fast25) ~1-2 s + transfer. */
export const MIN_INTERVAL_SEC: Record<PaletteName, number> = { bwr: 25, bw: 5 };
export const DEFAULT_GHOST_CLEAR_EVERY = 10;

/**
 * Default dither algorithm per palette. Black/white miniapps are mostly text and symbols, which stay
 * crisp with a plain threshold; the 3-colour palette keeps Floyd-Steinberg for gradients.
 */
export const ALGORITHM_BY_PALETTE: Record<PaletteName, QualitySettings['algorithm']> = {
  bwr: 'floyd-steinberg',
  bw: 'threshold',
};
export const defaultAlgorithm = (palette: PaletteName): QualitySettings['algorithm'] => ALGORITHM_BY_PALETTE[palette];
/** Default stored by older versions (before the interval followed the palette). */
const LEGACY_MIN_INTERVAL_SEC = 35;

export const defaultMinInterval = (palette: PaletteName): number => MIN_INTERVAL_SEC[palette];

export const DEFAULT_QUALITY: QualitySettings = {
  palette: 'bwr',
  algorithm: 'floyd-steinberg',
  contrast: 1,
  minIntervalSec: MIN_INTERVAL_SEC.bwr,
  ghostClearEvery: DEFAULT_GHOST_CLEAR_EVERY,
  layout: 'full',
};

export const PALETTE_FIELD: FieldSpec = {
  key: 'palette', label: 'Bảng màu', type: 'select',
  options: [{ value: 'bwr', label: 'Đen / trắng / đỏ' }, { value: 'bw', label: 'Đen / trắng' }],
};
export const ALGORITHM_FIELD: FieldSpec = {
  key: 'algorithm', label: 'Thuật toán dither', type: 'select',
  options: [
    { value: 'floyd-steinberg', label: 'Floyd–Steinberg' },
    { value: 'atkinson', label: 'Atkinson' },
    { value: 'threshold', label: 'Ngưỡng (không dither)' },
  ],
};
export const CONTRAST_FIELD: FieldSpec = {
  key: 'contrast', label: 'Độ tương phản', type: 'number', min: 0.5, max: 2.5, step: 0.1,
};

export const QUALITY_FIELDS: FieldSpec[] = [
  PALETTE_FIELD,
  ALGORITHM_FIELD,
  CONTRAST_FIELD,
  { key: 'minIntervalSec', label: 'Khoảng cập nhật tối thiểu', type: 'number', min: 5, max: 600, step: 5, unit: 'giây',
    help: 'Full refresh 3 màu ~15 s, đen/trắng nhanh ~1-2 s cộng truyền ảnh. Mặc định 25 s (3 màu) hoặc 5 s (đen/trắng).' },
  { key: 'ghostClearEvery', label: 'Xoá ghost sau mỗi', type: 'number', min: 0, max: 100, step: 1, unit: 'khung',
    help: 'Chỉ áp dụng cho đen/trắng nhanh: cứ N khung thì thay bằng một lần full refresh (~15 s) để xoá bóng mờ tích lũy. 0 = tắt.' },
  {
    // TODO: enable once EpdDevice supports the 0x83 clock+image mode (raw 03/04 register area writes for the 194x128 region).
    key: 'layout', label: 'Bố cục', type: 'select',
    options: [
      { value: 'full', label: 'Toàn màn 296×128' },
      { value: 'clockImage', label: 'Đồng hồ + ảnh 194×128 (chưa hỗ trợ)', disabled: true },
    ],
  },
];

/**
 * Merges stored values over defaults and clamps the numeric fields. A missing minIntervalSec or
 * algorithm follows the palette default.
 */
export function normalizeQuality(raw: Partial<QualitySettings> | undefined): QualitySettings {
  const q = { ...DEFAULT_QUALITY, ...raw };
  if (q.palette !== 'bw') q.palette = 'bwr';
  if (raw?.algorithm === undefined) q.algorithm = defaultAlgorithm(q.palette);
  q.contrast = Number.isFinite(Number(q.contrast)) ? Math.min(2.5, Math.max(0.5, Number(q.contrast))) : 1;
  const interval = Number(raw?.minIntervalSec);
  q.minIntervalSec = raw?.minIntervalSec === undefined || !Number.isFinite(interval)
    ? defaultMinInterval(q.palette)
    : Math.max(5, interval);
  const ghost = Number(raw?.ghostClearEvery);
  q.ghostClearEvery = raw?.ghostClearEvery === undefined || !Number.isFinite(ghost)
    ? DEFAULT_GHOST_CLEAR_EVERY
    : Math.max(0, Math.floor(ghost));
  q.layout = 'full'; // clockImage is not implemented in Phase 0 device code
  return q;
}

/**
 * When the palette changes in the form and the interval / algorithm was still the old palette's
 * default, it follows the new palette; a user-chosen value is kept.
 */
export function followPaletteInterval(prev: Partial<QualitySettings>, next: Partial<QualitySettings>): Partial<QualitySettings> {
  const was: PaletteName = prev.palette === 'bw' ? 'bw' : 'bwr';
  const now: PaletteName = next.palette === 'bw' ? 'bw' : 'bwr';
  if (was === now) return next;
  const out = { ...next };
  if (next.minIntervalSec === defaultMinInterval(was)) out.minIntervalSec = defaultMinInterval(now);
  if (next.algorithm === defaultAlgorithm(was)) out.algorithm = defaultAlgorithm(now);
  return out;
}

/**
 * Drops the old defaults from stored settings so they follow the palette; call on load only:
 * the fixed 35 s interval, and Floyd-Steinberg on the black/white palette (the old global default).
 */
export function migrateStoredQuality(raw: Partial<QualitySettings>): Partial<QualitySettings> {
  const out = { ...raw };
  if (out.minIntervalSec === LEGACY_MIN_INTERVAL_SEC) delete out.minIntervalSec;
  if (out.palette === 'bw' && out.algorithm === 'floyd-steinberg') delete out.algorithm;
  return out;
}

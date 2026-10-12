import type { PaletteName } from '../render/dither';
import { PLANE_BYTES, type Planes } from '../render/pack';

/** `fast`: black plane only (palette bw). `full`: normal black + red refresh. */
export type RefreshMethod = 'full' | 'fast';

export interface MethodChoice {
  method: RefreshMethod;
  /** True when a 'full' refresh was chosen only to clear accumulated fast-path ghosting. */
  ghostClear: boolean;
}

/**
 * Palette bwr always does a normal refresh. Palette bw uses the fast path, except that every
 * `ghostClearEvery`-th fast frame (`fastSinceClear` fast frames already sent since the last full
 * refresh) is replaced by a full refresh. 0 disables the clearing.
 * `first` marks the first frame of a run: palette bw always starts with a full refresh so the
 * fast path never builds on whatever the firmware left on the panel.
 */
export function chooseMethod(
  palette: PaletteName,
  ghostClearEvery: number,
  fastSinceClear: number,
  first = false,
): MethodChoice {
  if (palette !== 'bw') return { method: 'full', ghostClear: false };
  if (first) return { method: 'full', ghostClear: true };
  if (ghostClearEvery > 0 && fastSinceClear + 1 >= ghostClearEvery) return { method: 'full', ghostClear: true };
  return { method: 'fast', ghostClear: false };
}

/** Same image with an all "not red" red plane (bit 1 = not red), for the ghost-clearing full refresh. */
export function withoutRed(planes: Planes): Planes {
  return { black: planes.black, red: new Uint8Array(PLANE_BYTES).fill(0xff) };
}

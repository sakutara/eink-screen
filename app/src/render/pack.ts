import { PANEL } from '../ble/protocol';

/** Structural subset of ImageData so packing works without a DOM. */
export interface PixelImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray | Uint8Array;
}

export interface Planes {
  black: Uint8Array;
  red: Uint8Array;
}

/**
 * Packs RGBA pixels into the panel's column-major 1bpp layout:
 * x from width-1 down to 0, y top to bottom, MSB first (byte-exact with the
 * reference tool's `canvas2bytes_bw`).
 *
 * `black` plane bit = 1 when the pixel has no zero channel (white), so black
 * and pure red both map to 0. `red` plane is the reference "bwr" bit
 * (pure red => 1) inverted before sending, i.e. 0 = red, 1 = not red.
 * Expects palette-quantized input (see dither.ts); partial trailing bits are dropped.
 */
export function packPlanes(img: PixelImage): Planes {
  const { width, height, data } = img;
  const size = Math.floor((width * height) / 8);
  const black = new Uint8Array(size);
  const red = new Uint8Array(size);
  let bit = 0;
  for (let x = width - 1; x >= 0; x--) {
    for (let y = 0; y < height; y++) {
      const i = (width * 4 * y) + x * 4;
      const r = data[i] as number, g = data[i + 1] as number, b = data[i + 2] as number;
      const byte = bit >> 3;
      if (byte >= size) return { black, red: invert(red) };
      const mask = 0x80 >> (bit & 7);
      if (r > 0 && g > 0 && b > 0) black[byte] = (black[byte] as number) | mask;
      if (r > 0 && g === 0 && b === 0) red[byte] = (red[byte] as number) | mask;
      bit++;
    }
  }
  return { black, red: invert(red) };
}

function invert(bytes: Uint8Array): Uint8Array {
  for (let i = 0; i < bytes.length; i++) bytes[i] = (bytes[i] as number) ^ 0xff;
  return bytes;
}

export const PLANE_BYTES = (PANEL.width * PANEL.height) / 8;

import type { PixelImage } from './pack';

export type PaletteName = 'bw' | 'bwr';
export type DitherAlgorithm = 'floyd-steinberg' | 'atkinson' | 'threshold';

export interface DitherOptions {
  palette: PaletteName;
  algorithm: DitherAlgorithm;
  /** 1 = unchanged, >1 more contrast, <1 less. */
  contrast?: number;
}

type RGB = readonly [number, number, number];

const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [255, 255, 255];
const RED: RGB = [255, 0, 0];

const PALETTES: Record<PaletteName, readonly RGB[]> = {
  bw: [BLACK, WHITE],
  bwr: [BLACK, WHITE, RED],
};

// Error diffusion kernels as [dx, dy, weight]; weights are already divided.
const KERNELS: Record<Exclude<DitherAlgorithm, 'threshold'>, readonly (readonly [number, number, number])[]> = {
  'floyd-steinberg': [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]],
  atkinson: [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]],
};

/**
 * Maps an image onto the pure palette colours the packer expects.
 * Transparent pixels are composited onto white. Returns a new RGBA buffer.
 */
export function dither(src: PixelImage, opts: DitherOptions): PixelImage {
  const { width, height } = src;
  const palette = PALETTES[opts.palette];
  const contrast = opts.contrast ?? 1;
  const buf = new Float32Array(width * height * 3);

  for (let p = 0; p < width * height; p++) {
    const a = (src.data[p * 4 + 3] as number) / 255;
    for (let c = 0; c < 3; c++) {
      const v = (src.data[p * 4 + c] as number) * a + 255 * (1 - a);
      buf[p * 3 + c] = clamp((v - 128) * contrast + 128);
    }
  }

  const out = new Uint8ClampedArray(width * height * 4);
  const kernel = opts.algorithm === 'threshold' ? [] : KERNELS[opts.algorithm];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const r = buf[p * 3] as number, g = buf[p * 3 + 1] as number, b = buf[p * 3 + 2] as number;
      const q = nearest(palette, r, g, b);
      out.set([q[0], q[1], q[2], 255], p * 4);
      if (kernel.length === 0) continue;
      const er = r - q[0], eg = g - q[1], eb = b - q[2];
      for (const [dx, dy, w] of kernel) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny >= height) continue;
        const n = (ny * width + nx) * 3;
        buf[n] = (buf[n] as number) + er * w;
        buf[n + 1] = (buf[n + 1] as number) + eg * w;
        buf[n + 2] = (buf[n + 2] as number) + eb * w;
      }
    }
  }
  return { width, height, data: out };
}

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function nearest(palette: readonly RGB[], r: number, g: number, b: number): RGB {
  let best = palette[0] as RGB;
  let bestDist = Infinity;
  for (const c of palette) {
    const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

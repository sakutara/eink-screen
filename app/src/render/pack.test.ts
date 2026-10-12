import { describe, expect, it } from 'vitest';
import { dither } from './dither';
import { packPlanes, type PixelImage } from './pack';

/** Verbatim port of the reference tool's canvas2bytes_bw (reads RGBA data instead of a canvas). */
function forkCanvas2bytesBw(img: PixelImage, type = 'bw'): number[] {
  const arr: number[] = [];
  let buffer: number[] = [];
  const d = img.data;
  for (let x = img.width - 1; x >= 0; x--) {
    for (let y = 0; y < img.height; y++) {
      const index = img.width * 4 * y + x * 4;
      if (type !== 'bwr') {
        buffer.push(d[index]! > 0 && d[index + 1]! > 0 && d[index + 2]! > 0 ? 1 : 0);
      } else {
        buffer.push(d[index]! > 0 && d[index + 1] === 0 && d[index + 2] === 0 ? 1 : 0);
      }
      if (buffer.length === 8) {
        arr.push(parseInt(buffer.join(''), 2));
        buffer = [];
      }
    }
  }
  return arr;
}

const COLORS = [[0, 0, 0], [255, 255, 255], [255, 0, 0]] as const;

function image(w: number, h: number, pick: (x: number, y: number) => number): PixelImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      data.set([...COLORS[pick(x, y)]!, 255], (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data };
}

function expectMatchesFork(img: PixelImage) {
  const { black, red } = packPlanes(img);
  expect(Array.from(black)).toEqual(forkCanvas2bytesBw(img));
  expect(Array.from(red)).toEqual(forkCanvas2bytesBw(img, 'bwr').map((b) => b ^ 0xff));
}

describe('packPlanes', () => {
  it('is byte-exact with the reference on a panel-sized pseudo-random image', () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 3;
    expectMatchesFork(image(296, 128, () => rnd()));
  });

  it('is byte-exact on structured images', () => {
    expectMatchesFork(image(296, 128, (x) => (x < 100 ? 0 : x < 200 ? 1 : 2)));
    expectMatchesFork(image(296, 128, (_, y) => y % 3));
    expectMatchesFork(image(16, 8, (x, y) => (x + y) % 3));
  });

  it('has the expected size and orientation', () => {
    const img = image(296, 128, (x, y) => (x === 295 && y === 0 ? 0 : 1));
    const { black, red } = packPlanes(img);
    expect(black).toHaveLength(4736);
    expect(red).toHaveLength(4736);
    // First pixel scanned is (x=295, y=0): the only black one -> MSB of the first byte cleared.
    expect(black[0]).toBe(0x7f);
    expect(red[0]).toBe(0xff);
  });

  it('white => black bit 1 / red bit 1; black => 0 / 1; red => 0 / 0', () => {
    const one = (c: number) => packPlanes(image(8, 8, () => c));
    expect(Array.from(one(1).black)).toEqual(Array(8).fill(0xff));
    expect(Array.from(one(1).red)).toEqual(Array(8).fill(0xff));
    expect(Array.from(one(0).black)).toEqual(Array(8).fill(0));
    expect(Array.from(one(0).red)).toEqual(Array(8).fill(0xff));
    expect(Array.from(one(2).black)).toEqual(Array(8).fill(0));
    expect(Array.from(one(2).red)).toEqual(Array(8).fill(0));
  });
});

describe('dither', () => {
  const gray = (v: number): PixelImage => ({
    width: 16, height: 16,
    data: new Uint8ClampedArray(16 * 16 * 4).map((_, i) => (i % 4 === 3 ? 255 : v)),
  });

  it('outputs only palette colours', () => {
    for (const algorithm of ['floyd-steinberg', 'atkinson', 'threshold'] as const) {
      const out = dither(gray(100), { palette: 'bwr', algorithm });
      for (let i = 0; i < out.data.length; i += 4) {
        const key = `${out.data[i]},${out.data[i + 1]},${out.data[i + 2]}`;
        expect(['0,0,0', '255,255,255', '255,0,0']).toContain(key);
      }
    }
  });

  it('maps red to red in bwr but not in bw; threshold splits at mid-gray', () => {
    const red: PixelImage = { width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255]) };
    expect(Array.from(dither(red, { palette: 'bwr', algorithm: 'threshold' }).data)).toEqual([255, 0, 0, 255]);
    expect(dither(red, { palette: 'bw', algorithm: 'threshold' }).data[0]).toBe(0);
    expect(dither(gray(200), { palette: 'bw', algorithm: 'threshold' }).data[0]).toBe(255);
    expect(dither(gray(60), { palette: 'bw', algorithm: 'threshold' }).data[0]).toBe(0);
  });

  it('error diffusion approximates mid-gray density; contrast pushes towards extremes', () => {
    const white = (img: PixelImage) => {
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4) if (img.data[i] === 255) n++;
      return n / (img.width * img.height);
    };
    const fs = white(dither(gray(128), { palette: 'bw', algorithm: 'floyd-steinberg' }));
    expect(fs).toBeGreaterThan(0.4);
    expect(fs).toBeLessThan(0.6);
    expect(white(dither(gray(150), { palette: 'bw', algorithm: 'threshold', contrast: 1 }))).toBe(1);
    expect(white(dither(gray(110), { palette: 'bw', algorithm: 'threshold', contrast: 4 }))).toBe(0);
  });
});

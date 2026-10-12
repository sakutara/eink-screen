import { describe, expect, it } from 'vitest';
import { dither } from './dither';

const grey = (v: number) => ({ width: 1, height: 1, data: new Uint8ClampedArray([v, v, v, 255]) });
const isBlack = (v: number, threshold?: number, contrast?: number) =>
  dither(grey(v), { palette: 'bw', algorithm: 'threshold', threshold, contrast }).data[0] === 0;

describe('dither threshold', () => {
  it('is neutral at 128 and contrast does not move the cut', () => {
    expect(isBlack(127)).toBe(true);
    expect(isBlack(129)).toBe(false);
    expect(isBlack(127, 128, 2.5)).toBe(true);
    expect(isBlack(129, 128, 0.5)).toBe(false);
  });
  it('a higher black level turns anti-aliased edge greys black', () => {
    expect(isBlack(150)).toBe(false);
    expect(isBlack(150, 170)).toBe(true);
    expect(isBlack(200, 170)).toBe(false);
  });
  it('is ignored by error diffusion', () => {
    const a = dither(grey(150), { palette: 'bw', algorithm: 'floyd-steinberg' });
    const b = dither(grey(150), { palette: 'bw', algorithm: 'floyd-steinberg', threshold: 200 });
    expect(Array.from(b.data)).toEqual(Array.from(a.data));
  });
});

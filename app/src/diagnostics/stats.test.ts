import { describe, expect, it } from 'vitest';
import { percentile } from './stats';

describe('percentile', () => {
  it('nearest-rank', () => {
    const v = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(v, 50)).toBe(10);
    expect(percentile(v, 95)).toBe(19);
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([], 50)).toBeNaN();
  });
});

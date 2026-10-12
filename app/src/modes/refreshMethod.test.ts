import { describe, expect, it } from 'vitest';
import { PLANE_BYTES } from '../render/pack';
import { chooseMethod, withoutRed } from './refreshMethod';

describe('chooseMethod', () => {
  it('bwr is always a normal refresh', () => {
    for (let n = 0; n < 30; n++) expect(chooseMethod('bwr', 10, n)).toEqual({ method: 'full', ghostClear: false });
  });

  it('bw is fast, with a full refresh on every N-th frame', () => {
    const seq: string[] = [];
    let fast = 0;
    for (let i = 0; i < 12; i++) {
      const c = chooseMethod('bw', 5, fast);
      seq.push(c.ghostClear ? 'G' : c.method);
      fast = c.method === 'fast' ? fast + 1 : 0;
    }
    expect(seq.join(' ')).toBe('fast fast fast fast G fast fast fast fast G fast fast');
  });

  it('the first frame of a run is a full refresh for bw, also when clearing is disabled', () => {
    expect(chooseMethod('bw', 10, 0, true)).toEqual({ method: 'full', ghostClear: true });
    expect(chooseMethod('bw', 0, 0, true)).toEqual({ method: 'full', ghostClear: true });
    expect(chooseMethod('bwr', 10, 0, true)).toEqual({ method: 'full', ghostClear: false });
  });

  it('0 disables ghost clearing; a non-first frame 0 is never a clear', () => {
    expect(chooseMethod('bw', 0, 1000)).toEqual({ method: 'fast', ghostClear: false });
    expect(chooseMethod('bw', 10, 0)).toEqual({ method: 'fast', ghostClear: false });
  });

  it('withoutRed keeps black and makes the red plane all "not red"', () => {
    const black = new Uint8Array(PLANE_BYTES).fill(0x5a);
    const p = withoutRed({ black, red: new Uint8Array(PLANE_BYTES) });
    expect(p.black).toBe(black);
    expect(p.red).toHaveLength(PLANE_BYTES);
    expect(p.red.every((b) => b === 0xff)).toBe(true);
  });
});

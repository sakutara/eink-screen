import { describe, expect, it } from 'vitest';
import { toHex } from '../ble/protocol';
import {
  ALLOWED_REGISTERS, BASELINE_FULL, buildLut, buildRawSteps, LUT_BYTES, LUT_PRESETS, defaultOptions, describePlan, resultsToMarkdown, suggestBusySeconds, UPDATE_VALUES,
  type RunResult,
} from './fastRefresh';

const hexes = (steps: ReturnType<typeof buildRawSteps>) => steps.flatMap((s) => s.packets.map(toHex));

describe('fast refresh steps', () => {
  it('default: bypass red, no border, F7', () => {
    expect(hexes(buildRawSteps(defaultOptions(), 247))).toEqual([
      '03 21', '04 40 00', '03 22', '04 f7', '03 20',
    ]);
  });

  it.each(UPDATE_VALUES)('update value 0x%s is sent exactly', (v) => {
    const steps = buildRawSteps({ updateValue: v, bypassRed: false, border: false }, 247);
    expect(hexes(steps)).toEqual(['03 22', `04 ${v.toString(16)}`, '03 20']);
  });

  it('border toggle adds 03 3c / 04 05 between bypass and update control', () => {
    expect(hexes(buildRawSteps({ updateValue: 0xc7, bypassRed: true, border: true }, 247))).toEqual([
      '03 21', '04 40 00', '03 3c', '04 05', '03 22', '04 c7', '03 20',
    ]);
    expect(hexes(buildRawSteps({ updateValue: 0xc7, bypassRed: false, border: true }, 247))).toEqual([
      '03 3c', '04 05', '03 22', '04 c7', '03 20',
    ]);
  });

  it('only whitelisted registers and exactly one trigger, last', () => {
    for (const v of UPDATE_VALUES) for (const bypassRed of [true, false]) for (const border of [true, false]) {
      const steps = buildRawSteps({ updateValue: v, bypassRed, border }, 23);
      for (const s of steps) expect(ALLOWED_REGISTERS as readonly number[]).toContain(s.cmd);
      for (const s of steps) {
        const [first, ...rest] = s.packets;
        expect(first?.[0]).toBe(0x03);
        expect(first?.length).toBe(2);
        for (const p of rest) expect(p[0]).toBe(0x04);
      }
      expect(steps.filter((s) => s.trigger)).toHaveLength(1);
      expect(steps[steps.length - 1]?.trigger).toBe(true);
      expect(steps[steps.length - 1]?.cmd).toBe(0x20);
    }
  });

  it('rejects values outside the whitelist', () => {
    for (const v of [0x00, 0xf8, 0xcf, 0x99, 0x100]) {
      expect(() => buildRawSteps({ updateValue: v, bypassRed: true, border: false }, 247)).toThrow(RangeError);
    }
  });

  it('splits 04 data by mtu-1', async () => {
    const { rawRegisterPackets } = await import('../ble/protocol');
    const data = Uint8Array.from([1, 2, 3, 4, 5]);
    expect(rawRegisterPackets(0x22, data, 3).map(toHex)).toEqual(['03 22', '04 01 02', '04 03 04', '04 05']);
    expect(rawRegisterPackets(0x22, data, 247).map(toHex)).toEqual(['03 22', '04 01 02 03 04 05']);
    expect(rawRegisterPackets(0x20, undefined, 247).map(toHex)).toEqual(['03 20']);
    // mtu 2 -> 1 byte per 04 packet; mtu <= 1 still makes progress
    expect(rawRegisterPackets(0x22, Uint8Array.of(9, 8), 1).map(toHex)).toEqual(['03 22', '04 09', '04 08']);
  });

  it('plan lists mode/INIT/WRITE_IMG, raw steps and sleep 06', () => {
    const plan = describePlan(defaultOptions(), 247, 37, 244);
    expect(plan[1]?.hex).toBe('01');
    expect(plan[plan.length - 1]?.hex).toBe('06');
    expect(plan.map((l) => l.hex)).toContain('03 20');
  });

  it('markdown has one row per result', () => {
    const md = resultsToMarkdown([
      { id: 1, image: 'Tương phản', updateValue: 0xf7, bypassRed: true, border: false, durationMs: 2345, density: 4, ghost: 'light', note: 'a|b' },
    ]);
    expect(md).toContain('| 1 | Tương phản | 0xF7 | có | không | 2.3 | 4 | nhẹ | a\\|b |');
  });
});

describe('custom LUT', () => {
  it('reference LUT matches Waveshare WF_FULL (153 bytes)', () => {
    const lut = buildLut(0x19);
    expect(lut).toHaveLength(LUT_BYTES);
    expect(Array.from(lut.subarray(0, 13))).toEqual([0x90, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x60]);
    expect(Array.from(lut.subarray(60, 67))).toEqual([0x19, 0x19, 0, 0, 0, 0, 0]);
    expect(Array.from(lut.subarray(144))).toEqual([0x24, 0x42, 0x22, 0x22, 0x23, 0x32, 0, 0, 0]);
    // L0=L2, L1=L3: result depends on the new BW bit only
    expect(lut[0]).toBe(lut[24]);
    expect(lut[12]).toBe(lut[36]);
  });

  it('rejects out-of-range frame counts', () => {
    for (const n of [0, -1, 101, 1.5]) expect(() => buildLut(n)).toThrow(RangeError);
  });

  it('LUT run: bypass, 0x32 data, forced 0xC7, trigger last, no voltage registers', () => {
    const steps = buildRawSteps({ updateValue: 0xf7, bypassRed: true, border: false, lut: 'fast15' }, 247);
    const h = hexes(steps);
    expect(h.slice(0, 2)).toEqual(['03 21', '04 40 00']);
    expect(h[2]).toBe('03 32');
    expect(h[3]?.split(' ')).toHaveLength(1 + LUT_BYTES);
    expect(h.slice(4)).toEqual(['03 22', '04 c7', '03 20']);
    for (const s of steps) expect([0x03, 0x04, 0x2c, 0x3f]).not.toContain(s.cmd);
    for (const s of steps) expect(ALLOWED_REGISTERS as readonly number[]).toContain(s.cmd);
  });

  it('splits the LUT over 04 packets for a small mtu', () => {
    const steps = buildRawSteps({ updateValue: 0xf7, bypassRed: false, border: false, lut: 'fast8' }, 21);
    const lutStep = steps.find((s) => s.cmd === 0x32)!;
    const sizes = lutStep.packets.slice(1).map((p) => p.length - 1);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(LUT_BYTES);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(20);
  });

  it('rejects unknown LUT ids and presets stay within the frame cap', () => {
    expect(() => buildRawSteps({ updateValue: 0xf7, bypassRed: true, border: false, lut: 'x' as never }, 247)).toThrow(RangeError);
    for (const p of Object.values(LUT_PRESETS)) expect(() => buildLut(p.frames)).not.toThrow();
  });

  it('markdown shows LUT in the 0x22 column; plan summarises the long packet', () => {
    const md = resultsToMarkdown([
      { id: 1, image: 'x', updateValue: 0xf7, lut: 'fast25', bypassRed: true, border: false, durationMs: 1000, density: 3, ghost: 'none', note: '' },
    ]);
    expect(md).toContain('0xC7 + LUT fast25');
    const plan = describePlan({ updateValue: 0xf7, bypassRed: true, border: false, lut: 'fast25' }, 247, 37, 244);
    expect(plan.some((l) => l.hex.includes('… (153 byte dữ liệu)'))).toBe(true);
  });
});

describe('baseline results', () => {
  const row = (id: number, durationMs: number, baseline?: string): RunResult => ({
    id, image: 'Ảnh test BWR', updateValue: 0xf7, bypassRed: true, border: false,
    durationMs, density: 3, ghost: 'none', note: '', ...(baseline ? { baseline } : {}),
  });

  it('suggests ceil(max baseline * 1.25 / 1000) and ignores raw rows', () => {
    expect(suggestBusySeconds([row(1, 8400)])).toBeUndefined();
    expect(suggestBusySeconds([row(1, 8400), row(2, 20000, BASELINE_FULL)])).toBe(25);
    expect(suggestBusySeconds([row(1, 15100, BASELINE_FULL), row(2, 12000, 'x')])).toBe(19);
  });

  it('markdown row shows the baseline label and suggestion', () => {
    const md = resultsToMarkdown([row(1, 15100, BASELINE_FULL)]);
    expect(md).toContain('| 1 | Ảnh test BWR | chuẩn 05 (đỏ+đen) | - | - | 15.1 | 3 | không |  |');
    expect(md).toContain('busyMs gợi ý: 19 s');
  });
});

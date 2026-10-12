import { describe, expect, it } from 'vitest';
import * as P from './protocol';

const hex = (u: Uint8Array) => P.toHex(u);
const bytes = (h: string) => Uint8Array.from(h.split(' ').map((x) => parseInt(x, 16)));

describe('encoders', () => {
  it('setTime packs ts big-endian, tz int8, mode', () => {
    expect(hex(P.setTime(0x6789abcd, 7, 2))).toBe('20 67 89 ab cd 07 02');
    expect(hex(P.setTime(1, -5, 0x83))).toBe('20 00 00 00 01 fb 83');
  });

  it('simple opcodes', () => {
    expect(hex(P.init())).toBe('01');
    expect(hex(P.refresh())).toBe('05');
    expect(hex(P.weekStart(1))).toBe('21 01');
    expect(hex(P.countdownQuery())).toBe('d6 ff');
    expect(hex(P.countdownStop())).toBe('d7');
    expect(hex(P.countdownCaps())).toBe('d8 ff');
    expect(hex(P.sleepQuery())).toBe('fb ff');
    expect(hex(P.rawCommand(0x22, 0xf7))).toBe('03 22 f7');
    expect(hex(P.rawData(1, 2))).toBe('04 01 02');
  });

  it('countdownSet matches the reference layout (year little-endian, ts/tz appended)', () => {
    const pkt = P.countdownSet({ year: 2027, month: 2, day: 6, label: 'TET', ts: 0x01020304, tz: 7 });
    expect(hex(pkt)).toBe('d6 00 eb 07 02 06 03 54 45 54 01 02 03 04 07');
  });

  it('countdownSet sanitizes and truncates labels, validates dates', () => {
    expect(P.sanitizeLabel('Sinh nhật Đức ✓')).toBe('Sinh nhat Duc');
    expect(P.sanitizeLabel('abcdefghijklmnopqrstuvwxyz', 8)).toBe('abcdefgh');
    const pkt = P.countdownSet({ year: 2027, month: 1, day: 1, label: 'Tết', ts: 0, tz: 0 }, 8);
    expect(pkt[6]).toBe(3);
    expect(() => P.countdownSet({ year: 1999, month: 1, day: 1, label: '', ts: 0, tz: 0 })).toThrow();
  });

  it('sleepSet', () => {
    expect(hex(P.sleepSet({ enabled: true, startHour: 22, startMinute: 30, endHour: 6, endMinute: 0 }))).toBe(
      'fb 01 16 1e 06 00',
    );
  });
});

describe('writeImageChunks flags', () => {
  const data = new Uint8Array(10).map((_, i) => i);

  it('black: 0x0F first then 0xFF', () => {
    const p = P.writeImageChunks('black', data, 4);
    expect(p.map((x) => x[1])).toEqual([0x0f, 0xff, 0xff]);
    expect(p.every((x) => x[0] === 0x30)).toBe(true);
  });

  it('red: 0x00 first then 0xF0', () => {
    const p = P.writeImageChunks('red', data, 4);
    expect(p.map((x) => x[1])).toEqual([0x00, 0xf0, 0xf0]);
  });

  it('splits payload by chunk size and preserves data', () => {
    const p = P.writeImageChunks('black', data, 4);
    expect(p.map((x) => x.length)).toEqual([6, 6, 4]);
    const joined = p.flatMap((x) => Array.from(x.subarray(2)));
    expect(joined).toEqual(Array.from(data));
  });

  it('full panel plane at chunk 242', () => {
    const p = P.writeImageChunks('black', new Uint8Array(4736), 242);
    expect(p).toHaveLength(20);
  });

  it('chunkSizeForMtu', () => {
    expect(P.chunkSizeForMtu(244)).toBe(242);
    expect(P.chunkSizeForMtu(23)).toBe(21);
    expect(P.chunkSizeForMtu(1000)).toBe(244);
  });
});

describe('decoders', () => {
  const sample = bytes('14 13 06 05 04 03 02 02 ff 12 07 08 01');

  it('decodes the sample config packet', () => {
    const c = P.decodeConfig(sample)!;
    expect(c.pins).toEqual({ mosi: 0x14, sclk: 0x13, cs: 6, dc: 5, rst: 4, busy: 3, bs: 2 });
    expect(c.model).toBe(2);
    expect(c.wakeup).toBe(0xff);
    expect(c.led).toBe(0x12);
    expect(c.en).toBe(7);
    expect(c.mode).toBe(8);
    expect(c.weekStart).toBe(1);
    expect(c.panelProfile).toBeUndefined();
  });

  it('detects the 2.13 panel profile byte', () => {
    const c = P.decodeConfig(bytes('14 13 06 05 04 03 02 02 ff 12 07 08 01 21'))!;
    expect(c.panelProfile).toBe(0x21);
  });

  it('rejects non-config data', () => {
    expect(P.decodeConfig(bytes('01 02 03'))).toBeNull();
    expect(P.decodeConfig(bytes('00 00 00 00 00 00 00 09 00'))).toBeNull();
  });

  const ascii = (s: string) => new TextEncoder().encode(s);

  it('classifies text replies', () => {
    expect(P.classifyNotification(ascii('mtu=244'))).toEqual({ kind: 'mtu', mtu: 244 });
    expect(P.classifyNotification(ascii('t=1760000000'))).toEqual({ kind: 'time', ts: 1760000000 });
    expect(P.classifyNotification(ascii('clock_image=ok')).kind).toBe('text');
  });

  it('classifies config', () => {
    expect(P.classifyNotification(sample).kind).toBe('config');
  });

  it('classifies D6/D7/D8', () => {
    const d6 = P.classifyNotification(bytes('d6 00 00 eb 07 02 06 03 54 45 54'));
    expect(d6).toEqual({ kind: 'countdown', state: { status: 0, year: 2027, month: 2, day: 6, label: 'TET' } });
    expect(P.classifyNotification(bytes('d7 00')).kind).toBe('countdownStop');
    expect(P.classifyNotification(bytes('d8 00 10'))).toEqual({ kind: 'countdownCaps', maxLabel: 16 });
  });

  it('classifies week start and sleep replies', () => {
    expect(P.classifyNotification(bytes('21 00 01'))).toEqual({ kind: 'weekStart', state: 0, weekStart: 1 });
    const sleep = P.classifyNotification(bytes('fb 00 01 16 1e 06 00'));
    expect(sleep).toMatchObject({
      kind: 'sleep', state: 0, active: null,
      schedule: { enabled: true, startHour: 22, startMinute: 30, endHour: 6, endMinute: 0 },
    });
    expect(P.classifyNotification(bytes('fb 00 01 16 1e 06 00 01'))).toMatchObject({ active: 1 });
  });

  it('falls back to unknown', () => {
    expect(P.classifyNotification(bytes('ff 00 01')).kind).toBe('unknown');
  });
});

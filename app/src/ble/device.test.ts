import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUSY_MS_BW_FAST, BUSY_MS_BWR, EpdDevice } from './device';
import { toHex } from './protocol';

/** Device with a fake characteristic; INIT is answered by a stub so no notifications are needed. */
function makeDevice(failAfter?: number) {
  const writes: string[] = [];
  const bluetooth = { gatt: { connected: true }, addEventListener() {}, removeEventListener() {} } as unknown as BluetoothDevice;
  const d = new EpdDevice(bluetooth);
  d.mtu = 20; // chunk = 19 bytes -> 3 chunks for a 40-byte plane
  (d as unknown as { characteristic: unknown }).characteristic = {
    writeValueWithResponse: async (p: Uint8Array) => {
      if (failAfter !== undefined && writes.length >= failAfter && toHex(p) !== '06') throw new Error('rớt gói');
      writes.push(toHex(p));
    },
  };
  d.runInit = async () => { writes.push('INIT'); };
  return { d, writes };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('EpdDevice.restoreMode', () => {
  const snap = (mode: number | undefined) => ({ mode, weekStart: undefined, config: undefined });
  const modeOf = (hex: string) => parseInt(hex.split(' ').at(-1)!, 16);

  it('gives the original mode back when it is known', async () => {
    const { d, writes } = makeDevice();
    const r = await d.restoreMode(snap(2));
    expect(r).toMatchObject({ restored: true });
    expect(writes).toHaveLength(1);
    expect(modeOf(writes[0]!)).toBe(2);
  });

  it('falls back to the calendar app when there is no snapshot or mode', async () => {
    for (const s of [undefined, snap(undefined)]) {
      const { d, writes } = makeDevice();
      const r = await d.restoreMode(s);
      expect(r.restored).toBe(true);
      expect(r.message).toContain('app lịch');
      expect(writes).toHaveLength(1);
      expect(writes[0]!.startsWith('20 ')).toBe(true);
      expect(modeOf(writes[0]!)).toBe(1);
      expect(d.mode).toBe(1);
    }
  });

  it('falls back to the calendar app for a countdown without saved parameters', async () => {
    const { d, writes } = makeDevice();
    const r = await d.restoreMode(snap(8));
    expect(r.message).toContain('đếm ngược');
    expect(modeOf(writes.at(-1)!)).toBe(1);
  });

  it('reports failure only when even the calendar switch fails', async () => {
    const { d } = makeDevice(0);
    const r = await d.restoreMode(snap(undefined));
    expect(r.restored).toBe(false);
    expect(r.message).toContain('app lịch');
  });
});

describe('EpdDevice.uploadBlackFast', () => {
  it('sends mode0, INIT, black plane, raw bypass/LUT/update/activate, waits, then 06', async () => {
    const { d, writes } = makeDevice();
    const done = d.uploadBlackFast(new Uint8Array(40).fill(0xff), { chunkDelayMs: 0 });
    await vi.advanceTimersByTimeAsync(BUSY_MS_BW_FAST + 1000);
    const t = await done;
    expect(writes[0]!.startsWith('20 ')).toBe(true); // mode 0 set-time packet
    expect(writes[1]).toBe('INIT');
    const tailStart = writes.indexOf('03 21');
    expect(writes.slice(1, tailStart).filter((w) => w !== 'INIT').every((w) => /^30 /.test(w))).toBe(true);
    const tail = writes.slice(tailStart);
    expect(tail.slice(0, 3)).toEqual(['03 21', '04 40 00', '03 32']);
    const upd = tail.indexOf('03 22');
    const lutPackets = tail.slice(3, upd);
    expect(lutPackets.every((w) => w.startsWith('04 '))).toBe(true);
    const lutBytes = lutPackets.flatMap((w) => w.split(' ').slice(1));
    expect(lutBytes).toHaveLength(153);
    expect(lutBytes.slice(0, 3)).toEqual(['90', '00', '00']);
    expect(tail.slice(upd)).toEqual(['03 22', '04 c7', '03 20', '06']);
    expect(d.mode).toBe(0);
    expect(t.busyMs).toBeGreaterThanOrEqual(BUSY_MS_BW_FAST);
    expect(Object.keys(t).sort()).toEqual(['busyMs', 'prepareMs', 'sendMs', 'totalMs']);
  });

  it('honours a custom busyMs and defaults are the measured constants', async () => {
    expect(BUSY_MS_BWR).toBe(20_000);
    expect(BUSY_MS_BW_FAST).toBe(2_000);
    const { d, writes } = makeDevice();
    const done = d.uploadBlackFast(new Uint8Array(19), { chunkDelayMs: 0, busyMs: 1000 });
    await vi.advanceTimersByTimeAsync(1500);
    await done;
    expect(writes.at(-1)).toBe('06');
  });

  it('best-effort 06 when the sequence fails mid-way', async () => {
    const { d, writes } = makeDevice(4);
    const done = d.uploadBlackFast(new Uint8Array(40), { chunkDelayMs: 0 });
    const assertion = expect(done).rejects.toThrow('rớt gói');
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(writes.at(-1)).toBe('06');
  });
});

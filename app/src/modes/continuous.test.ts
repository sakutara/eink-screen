import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ModeSnapshot } from '../ble/device';
import type { MiniApp, QualitySettings } from '../miniapps/types';
import type { PixelImage, Planes } from '../render/pack';
import { ContinuousRunner, type RunnerDeps, type UpdateTransport } from './continuous';

const planes: Planes = { black: new Uint8Array(1), red: new Uint8Array(1) };
const preview: PixelImage = { width: 1, height: 1, data: new Uint8Array(4) };

class FakeTransport implements UpdateTransport {
  sent: number[] = [];
  methods: (string | undefined)[] = [];
  reds: boolean[] = [];
  restored: { snapshot: ModeSnapshot | undefined; countdown: unknown }[] = [];
  disposed = 0;
  failNext = 0;
  constructor(private readonly clock: () => number) {}
  async open() { return { mode: 8, weekStart: 1, config: undefined } as ModeSnapshot; }
  async send(p?: Planes, _progress?: unknown, method?: string) {
    this.methods.push(method);
    this.reds.push(!!p && p.red.every((b) => b === 0xff));
    if (this.failNext > 0) { this.failNext--; throw new Error('mất kết nối'); }
    this.sent.push(this.clock());
    return { prepareMs: 1, sendMs: 2, busyMs: 3, totalMs: 6 };
  }
  async restore(snapshot: ModeSnapshot | undefined, countdown?: unknown) {
    this.restored.push({ snapshot, countdown });
    return { restored: true, message: 'ok' };
  }
  async dispose() { this.disposed++; }
}

/** Data source driven by a script: key per tick (null = no data). */
function scriptedMiniApp(script: (string | null)[]) {
  let i = 0;
  const stop = vi.fn();
  const rendered: string[] = [];
  const app: MiniApp = {
    id: 't', name: 't', description: '', requires: [], settingsSchema: [], defaultSettings: {},
    pollIntervalMs: () => 12_000,
    start: async () => ({
      tick: async () => {
        const v = script[Math.min(i, script.length - 1)] ?? null;
        i++;
        return v === null ? null : { v };
      },
      stop,
    }),
    key: (d) => (d as { v: string }).v,
    render: () => undefined,
  };
  return { app, stop, rendered };
}

const quality: QualitySettings = { palette: 'bwr', algorithm: 'threshold', contrast: 1, threshold: 128, minIntervalSec: 35, ghostClearEvery: 10, layout: 'full' };

let wake: { acquire: Mock<() => Promise<void>>; release: Mock<() => Promise<void>> };
const deps = (): Partial<RunnerDeps> => ({
  renderFrame: () => ({ planes, preview }),
  wakeLock: wake,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  wake = { acquire: vi.fn(async () => undefined), release: vi.fn(async () => undefined) };
});
afterEach(() => vi.useRealTimers());

function make(script: (string | null)[]) {
  const transport = new FakeTransport(() => Date.now());
  const mini = scriptedMiniApp(script);
  const runner = new ContinuousRunner({
    miniapp: mini.app, settings: {}, quality, transport,
    countdown: { year: 2027, month: 1, day: 1, label: 'TET' }, deps: deps(),
  });
  return { transport, mini, runner };
}

describe('ContinuousRunner refresh method', () => {
  const makeQ = (q: Partial<QualitySettings>) => {
    const transport = new FakeTransport(() => Date.now());
    const mini = scriptedMiniApp(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    const runner = new ContinuousRunner({
      miniapp: mini.app, settings: {}, transport, deps: deps(),
      quality: { ...quality, minIntervalSec: 5, ...q },
    });
    return { transport, runner };
  };

  it('bwr: always full', async () => {
    const { transport, runner } = makeQ({ palette: 'bwr', ghostClearEvery: 3 });
    await runner.start();
    await vi.advanceTimersByTimeAsync(80_000);
    expect(transport.methods.length).toBeGreaterThan(3);
    expect(transport.methods.every((m) => m === 'full')).toBe(true);
    await runner.stop();
  });

  it('bw: starts with a full refresh, then fast, every 3rd frame is a full refresh with an all-not-red plane', async () => {
    const { transport, runner } = makeQ({ palette: 'bw', ghostClearEvery: 3 });
    await runner.start();
    await vi.advanceTimersByTimeAsync(80_000);
    expect(transport.methods.slice(0, 7)).toEqual(['full', 'fast', 'fast', 'full', 'fast', 'fast', 'full']);
    expect(transport.reds[0]).toBe(true);
    expect(transport.reds[1]).toBe(false);
    expect(transport.reds[3]).toBe(true);
    await runner.stop();
  });

  it('bw with ghostClearEvery 0 only does the initial full refresh', async () => {
    const { transport, runner } = makeQ({ palette: 'bw', ghostClearEvery: 0 });
    await runner.start();
    await vi.advanceTimersByTimeAsync(80_000);
    expect(transport.methods[0]).toBe('full');
    expect(transport.methods.slice(1).every((m) => m === 'fast')).toBe(true);
    await runner.stop();
  });
});

describe('ContinuousRunner', () => {
  it('attempts the first frame right after start without waiting', async () => {
    const { transport, runner } = make(['A']);
    await runner.start();
    await vi.advanceTimersByTimeAsync(0); // flush microtasks only, no clock time
    expect(Date.now()).toBe(0);
    expect(transport.methods).toHaveLength(1);
    await runner.stop();
  });

  it('uploads the first frame immediately and skips unchanged keys', async () => {
    const { transport, runner } = make(['A', 'A', 'A', 'A']);
    await runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.sent).toEqual([0]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.sent).toEqual([0]);
    expect(runner.status.state.uploads).toBe(1);
    expect(runner.status.state.preview).toBe(preview);
    await runner.stop();
  });

  it('respects the minimum interval and sends the latest queued frame', async () => {
    // t=0 A, t=12 B (queued), t=24 C (replaces B), t=36 C allowed
    const { transport, runner } = make(['A', 'B', 'C', 'C', 'C']);
    await runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.sent).toEqual([0]);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(transport.sent).toEqual([0]);
    expect(runner.status.state.hasPending).toBe(true);
    await vi.advanceTimersByTimeAsync(24_000);
    expect(transport.sent).toHaveLength(2);
    expect(transport.sent[1]).toBeGreaterThanOrEqual(35_000);
    expect(runner.status.state.lastKey).toBe('C');
    await runner.stop();
  });

  it('does not upload when the source has no data', async () => {
    const { transport, runner } = make([null, null]);
    await runner.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.sent).toEqual([]);
    await runner.stop();
  });

  it('retries a failed upload sooner than the full interval and counts errors', async () => {
    const { transport, runner } = make(['A']);
    transport.failNext = 1;
    await runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(runner.status.state.errors).toBe(1);
    expect(runner.status.state.lastError).toContain('mất kết nối');
    await vi.advanceTimersByTimeAsync(12_000);
    expect(transport.sent).toHaveLength(1);
    expect(runner.status.state.lastError).toBeUndefined();
    await runner.stop();
  });

  it('restores the initial mode, disposes and releases the wake lock on stop', async () => {
    const { transport, mini, runner } = make(['A']);
    await runner.start();
    expect(wake.acquire).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(0);
    await runner.stop();
    expect(transport.restored).toHaveLength(1);
    expect(transport.restored[0]!.snapshot?.mode).toBe(8);
    expect(transport.restored[0]!.countdown).toMatchObject({ label: 'TET' });
    expect(transport.disposed).toBe(1);
    expect(mini.stop).toHaveBeenCalledOnce();
    expect(wake.release).toHaveBeenCalledOnce();
    expect(runner.status.state.state).toBe('stopped');
    // idempotent
    await runner.stop();
    expect(transport.restored).toHaveLength(1);
    // no more uploads after stop
    await vi.advanceTimersByTimeAsync(120_000);
    expect(transport.sent).toHaveLength(1);
  });

  it('stop({immediate}) restores without waiting for the loop', async () => {
    const { transport, runner } = make(['A']);
    await runner.start();
    await runner.stop({ immediate: true });
    expect(transport.restored).toHaveLength(1);
    expect(runner.status.state.state).toBe('stopped');
  });

  it('cleans up and rethrows when the transport cannot open', async () => {
    const { transport, runner } = make(['A']);
    transport.open = async () => { throw new Error('không thấy thiết bị'); };
    await expect(runner.start()).rejects.toThrow('không thấy thiết bị');
    expect(transport.disposed).toBe(1);
    expect(wake.release).toHaveBeenCalled();
    expect(runner.status.state.state).toBe('error');
  });
});

import { connectSaved } from '../ble/connect';
import { errMsg, type EpdDevice } from '../ble/device';
import type { SavedDevice } from '../devices/store';
import type { Planes } from '../render/pack';
import { openDevice } from '../state/session';
import { percentile } from './stats';

export interface CycleResult {
  cycle: number;
  ok: boolean;
  /** Time to get a ready device (discovery + GATT + INIT). 0 when the connection was kept. */
  connectMs: number;
  /** From "data ready" to the panel having finished refreshing. */
  latencyMs: number;
  drops: number;
  error?: string;
}

export interface BenchmarkSummary {
  cycles: number;
  successRate: number;
  connectP50: number;
  connectP95: number;
  latencyP50: number;
  latencyP95: number;
  drops: number;
  errors: string[];
}

export interface BenchmarkOptions {
  cycles: number;
  saved: SavedDevice;
  planes: Planes;
  busyMs: number;
  /** Reuse an already open device (the connection is kept for every cycle). */
  existing?: EpdDevice;
  signal: AbortSignal;
  onCycle?: (r: CycleResult) => void;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function freshDevice(saved: SavedDevice): Promise<EpdDevice> {
  const result = await connectSaved(saved, { allowPicker: false });
  return openDevice(result);
}

export async function runBenchmark(o: BenchmarkOptions): Promise<{ summary: BenchmarkSummary; results: CycleResult[] }> {
  const results: CycleResult[] = [];
  let device: EpdDevice | undefined = o.existing;
  let dropCounter = 0;
  const watch = (d: EpdDevice) => d.on('disconnect', () => dropCounter++);
  let unwatch = device ? watch(device) : () => undefined;

  try {
    for (let cycle = 1; cycle <= o.cycles && !o.signal.aborted; cycle++) {
      const dropsBefore = dropCounter;
      const t0 = performance.now();
      let connectMs = 0;
      try {
        if (!device || !device.connected) {
          const tc = performance.now();
          unwatch();
          device = await freshDevice(o.saved);
          unwatch = watch(device);
          connectMs = Math.round(performance.now() - tc);
        }
        await device.uploadImage(o.planes, { busyMs: o.busyMs });
        const latencyMs = Math.round(performance.now() - t0);
        const r: CycleResult = { cycle, ok: true, connectMs, latencyMs, drops: dropCounter - dropsBefore };
        results.push(r);
        o.onCycle?.(r);
      } catch (e) {
        const r: CycleResult = {
          cycle, ok: false, connectMs, latencyMs: Math.round(performance.now() - t0),
          drops: dropCounter - dropsBefore, error: errMsg(e),
        };
        results.push(r);
        o.onCycle?.(r);
        await device?.disconnect().catch(() => undefined);
        device = undefined;
        await delay(1000);
      }
    }
  } finally {
    unwatch();
    // The caller's device stays open (it may be the session device); only close one we opened.
    if (device && device !== o.existing) await device.disconnect();
  }
  return { summary: summarize(results), results };
}

export function summarize(results: CycleResult[]): BenchmarkSummary {
  const ok = results.filter((r) => r.ok);
  const connects = results.filter((r) => r.connectMs > 0).map((r) => r.connectMs);
  return {
    cycles: results.length,
    successRate: results.length ? ok.length / results.length : 0,
    connectP50: percentile(connects, 50),
    connectP95: percentile(connects, 95),
    latencyP50: percentile(ok.map((r) => r.latencyMs), 50),
    latencyP95: percentile(ok.map((r) => r.latencyMs), 95),
    drops: results.reduce((n, r) => n + r.drops, 0),
    errors: results.filter((r) => r.error).map((r) => `#${r.cycle}: ${r.error}`),
  };
}

export function toMarkdown(s: BenchmarkSummary, meta: Record<string, string | number>): string {
  const f = (n: number) => (Number.isNaN(n) ? '-' : String(Math.round(n)));
  const row = `| ${s.cycles} | ${(s.successRate * 100).toFixed(0)}% | ${f(s.connectP50)} / ${f(s.connectP95)} | ${f(s.latencyP50)} / ${f(s.latencyP95)} | ${s.drops} |`;
  const metaLines = Object.entries(meta).map(([k, v]) => `- ${k}: ${v}`);
  const errors = s.errors.map((e) => `- ${e}`);
  return [
    '### Benchmark gửi ảnh (giữ kết nối)',
    ...metaLines,
    '',
    '| Chu kỳ | Thành công | Kết nối lại p50/p95 (ms) | Độ trễ p50/p95 (ms) | Rớt |',
    '|---|---|---|---|---|',
    row,
    ...(errors.length ? ['', 'Lỗi:', ...errors] : []),
  ].join('\n');
}

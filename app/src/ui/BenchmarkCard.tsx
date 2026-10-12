import { useRef, useState } from 'preact/hooks';
import { BUSY_MS_BWR } from '../ble/device';
import { runBenchmark, summarize, toMarkdown, type CycleResult } from '../diagnostics/benchmark';
import { canvasToPlanes } from '../render/canvas';
import { drawTestPattern } from '../render/testPattern';
import { addLog } from '../state/log';
import { session } from '../state/session';

export function BenchmarkCard() {
  const s = session.use();
  const [cycles, setCycles] = useState(20);
  const [busySec, setBusySec] = useState(BUSY_MS_BWR / 1000);
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState<CycleResult[]>([]);
  const abort = useRef<AbortController | undefined>(undefined);

  const start = async () => {
    const saved = s.saved;
    if (!saved || !s.device) return;
    const est = Math.round((cycles * busySec) / 60);
    if (!confirm(`Chạy benchmark ${cycles} chu kỳ, mỗi chu kỳ refresh màn ~${busySec}s (tổng khoảng ${est}+ phút). Giữ màn hình điện thoại sáng và đứng gần thiết bị. Bắt đầu?`)) return;
    const { planes } = canvasToPlanes(drawTestPattern(), { palette: 'bwr', algorithm: 'threshold' });
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setLive([]);
    const sleepLock = await navigator.wakeLock?.request('screen').catch(() => undefined);
    try {
      addLog('info', 'Benchmark: bắt đầu');
      await runBenchmark({
        cycles, saved, planes, busyMs: busySec * 1000,
        existing: s.device, signal: controller.signal,
        onCycle: (r) => setLive((prev) => [...prev, r]),
      });
    } finally {
      await sleepLock?.release();
      setRunning(false);
    }
  };

  const meta = () => ({
    'Thiết bị': `${s.saved?.displayName ?? '?'} (fw 0x${(s.device?.version ?? 0).toString(16)})`,
    'Trình duyệt': navigator.userAgent,
    'Thời gian chờ refresh (s)': busySec,
    Ngày: new Date().toISOString(),
  });
  const copy = (text: string) => navigator.clipboard?.writeText(text);
  const r = live.length ? summarize(live) : undefined;
  const fmt = (n: number) => (Number.isNaN(n) ? '-' : Math.round(n));

  return (
    <div class="card">
      <h2>Benchmark gửi ảnh</h2>
      <p class="muted">Giữ kết nối suốt các chu kỳ, mỗi chu kỳ gửi ảnh và refresh; chỉ kết nối lại khi bị rớt.</p>
      <div class="row">
        <label class="field">Số chu kỳ<input type="number" min={1} max={100} value={cycles} onInput={(e) => setCycles(Number(e.currentTarget.value))} /></label>
        <label class="field">Chờ refresh (s)<input type="number" min={0} max={90} value={busySec} onInput={(e) => setBusySec(Number(e.currentTarget.value))} /></label>
      </div>
      <div class="row" style="margin-top:8px">
        <button class="primary" disabled={running || !s.device} onClick={start}>Chạy</button>
        <button disabled={!running} onClick={() => abort.current?.abort()}>Dừng</button>
      </div>
      {running && <p class="muted">Đang chạy: {live.length}/{cycles}</p>}
      {r && (
        <>
          <table class="bench">
            <thead><tr><th>OK</th><th>Kết nối lại p50/p95</th><th>Độ trễ p50/p95</th><th>Rớt</th></tr></thead>
            <tbody>
              <tr>
                <td>{(r.successRate * 100).toFixed(0)}% ({r.cycles})</td>
                <td>{fmt(r.connectP50)}/{fmt(r.connectP95)}</td>
                <td>{fmt(r.latencyP50)}/{fmt(r.latencyP95)}</td>
                <td>{r.drops}</td>
              </tr>
            </tbody>
          </table>
          <div class="row" style="margin-top:8px">
            <button onClick={() => copy(JSON.stringify({ meta: meta(), summary: r, cycles: live }, null, 2))}>Sao chép JSON</button>
            <button onClick={() => copy(toMarkdown(r, meta()))}>Sao chép Markdown</button>
          </div>
        </>
      )}
    </div>
  );
}

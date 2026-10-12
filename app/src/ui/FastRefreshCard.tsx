import { useEffect, useRef, useState } from 'preact/hooks';
import { errMsg, type UploadProgress } from '../ble/device';
import { chunkSizeForMtu, refresh } from '../ble/protocol';
import {
  BASELINE_BLACK, BASELINE_FULL, buildRawSteps, defaultOptions, describePlan, GHOST_LABEL, isLutId, LUT_PRESETS, resultsToMarkdown, suggestBusySeconds, UPDATE_INFO, UPDATE_VALUES, updateLabel,
  type FastRefreshOptions, type Ghost, type LutId, type RunResult,
} from '../diagnostics/fastRefresh';
import { canvasToPlanes, putPixels } from '../render/canvas';
import { PLANE_BYTES, type Planes } from '../render/pack';
import { drawContrastPattern, drawTestPattern } from '../render/testPattern';
import { addLog } from '../state/log';
import { session } from '../state/session';
import { useAction } from './actions';

type ImageKind = 'contrast' | 'pattern';
const IMAGES: Record<ImageKind, { label: string; draw: () => HTMLCanvasElement; algorithm: 'floyd-steinberg' | 'threshold' }> = {
  contrast: { label: 'Tương phản (chữ nhỏ, khối đen, gradient)', draw: drawContrastPattern, algorithm: 'floyd-steinberg' },
  pattern: { label: 'Ảnh test BWR (chiều, mũi tên)', draw: drawTestPattern, algorithm: 'threshold' },
};

const makePlanes = (kind: ImageKind) =>
  canvasToPlanes(IMAGES[kind].draw(), { palette: 'bwr', algorithm: IMAGES[kind].algorithm });

const runOptsNote = (o: FastRefreshOptions) => o.lut
  ? `Ghi LUT cố định "${o.lut}" qua 0x32 (chỉ chọn trong các điện áp OTP, không ghi 0x03/0x04/0x2C). Tệ nhất là ảnh nhạt/ghost hoặc ảnh âm bản, refresh chuẩn sẽ xoá.`
  : 'Chỉ dùng waveform OTP của panel, không ghi LUT/điện áp. Tệ nhất là ghost/ảnh nhạt, refresh chuẩn sẽ xoá.';

type Phase = 'idle' | 'sending' | 'waiting' | 'rating';

interface Pending {
  durationMs: number;
  image: string;
  options: FastRefreshOptions;
  density: number;
  ghost: Ghost;
  note: string;
  /** Set for baseline runs of the normal 05 refresh: no 06 is sent afterwards. */
  baseline?: string;
}

export function FastRefreshCard() {
  const s = session.use();
  const d = s.device;
  const [busy, run] = useAction();
  const [image, setImage] = useState<ImageKind>('contrast');
  const [opts, setOpts] = useState<FastRefreshOptions>(defaultOptions());
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<UploadProgress>();
  const [elapsed, setElapsed] = useState(0);
  const [pending, setPending] = useState<Pending>();
  const [results, setResults] = useState<RunResult[]>([]);
  const preview = useRef<HTMLCanvasElement>(null);
  const trigger = useRef(0);
  const lastRun = useRef<{ planes: Planes; image: ImageKind } | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const disabled = !d || busy || phase !== 'idle';

  useEffect(() => {
    if (preview.current) putPixels(preview.current, makePlanes(image).preview);
  }, [image]);
  useEffect(() => () => clearInterval(timer.current), []);

  const mtu = d?.mtu ?? 244;
  const suggested = suggestBusySeconds(results);

  const start = async () => {
    if (!d) return;
    const { planes } = makePlanes(image);
    const plan = describePlan(opts, mtu, Math.ceil(PLANE_BYTES / chunkSizeForMtu(mtu)), chunkSizeForMtu(mtu));
    const list = plan.map((l, i) => `${i + 1}. ${l.label}: ${l.hex}`).join('\n');
    if (!confirm(`Chạy thử nghiệm refresh nhanh đen trắng? Màn sẽ nhấp nháy.\n\nGói sẽ gửi:\n${list}\n\n${runOptsNote(opts)}`)) return;
    lastRun.current = { planes, image };
    const imageLabel = IMAGES[image].label;
    const runOpts = { ...opts };
    setPhase('sending');
    let triggered = false;
    try {
      addLog('info', `▶ Refresh nhanh: ${imageLabel}, 0x22=${runOpts.lut ? 'c7' : runOpts.updateValue.toString(16)}, LUT=${runOpts.lut ?? 'OTP'}, bỏ qua đỏ=${runOpts.bypassRed}, border=${runOpts.border}`);
      await d.uploadBlackPlane(planes.black, { onProgress: setProgress });
      setProgress(undefined);
      for (const step of buildRawSteps(runOpts, d.mtu ?? 244)) {
        await d.rawCommand(step.cmd, step.data);
        if (step.trigger) {
          trigger.current = performance.now();
          triggered = true;
        }
      }
      addLog('info', 'Đã kích hoạt cập nhật. Bấm "Màn đã ngừng nhấp nháy" khi màn xong.');
      setElapsed(0);
      timer.current = setInterval(() => setElapsed(performance.now() - trigger.current), 100);
      setPending({ durationMs: 0, image: imageLabel, options: runOpts, density: 3, ghost: 'none', note: '' });
      setPhase('waiting');
    } catch (e) {
      addLog('error', `✘ Refresh nhanh: ${errMsg(e)}`);
      setProgress(undefined);
      // Never leave the panel powered after a failed/aborted sequence.
      if (triggered || d.connected) await d.epdSleep().catch(() => undefined);
      setPhase('idle');
    }
  };

  const startBaseline = async (black: boolean) => {
    if (!d) return;
    const { planes } = makePlanes('pattern');
    const label = black ? BASELINE_BLACK : BASELINE_FULL;
    const steps = black
      ? 'mode 0 → INIT → plane đen → mode 3 → 05 (không gửi plane đỏ: RAM đỏ giữ nội dung cũ)'
      : 'mode 0 → INIT → plane đen → plane đỏ → mode 3 → 05';
    if (!confirm(`Đo baseline refresh chuẩn: ${label}?\n\nTrình tự: ${steps}.\nẢnh test BWR. Màn nhấp nháy 15-30 s. Không gửi 06 (firmware tự quản lý ngủ). Bấm "Màn đã ngừng nhấp nháy" bằng tay khi màn xong.`)) return;
    const imageLabel = IMAGES.pattern.label;
    setPhase('sending');
    try {
      addLog('info', `▶ Baseline: ${label}, ${imageLabel}`);
      if (black) {
        await d.uploadBlackPlane(planes.black, { onProgress: setProgress });
        setProgress(undefined);
        await d.setMode(3);
        await d.write(refresh());
      } else {
        await d.uploadImage(planes, { skipBusyWait: true, onProgress: setProgress });
        setProgress(undefined);
      }
      trigger.current = performance.now();
      addLog('info', 'Đã gửi REFRESH 05. Bấm "Màn đã ngừng nhấp nháy" khi màn xong.');
      setElapsed(0);
      timer.current = setInterval(() => setElapsed(performance.now() - trigger.current), 100);
      setPending({ durationMs: 0, image: imageLabel, options: opts, density: 3, ghost: 'none', note: '', baseline: label });
      setPhase('waiting');
    } catch (e) {
      addLog('error', `✘ Baseline: ${errMsg(e)}`);
      setProgress(undefined);
      setPhase('idle');
    }
  };

  const stopped = async () => {
    const ms = performance.now() - trigger.current;
    clearInterval(timer.current);
    setElapsed(ms);
    setPending((p) => p && { ...p, durationMs: Math.round(ms) });
    setPhase('rating');
    addLog('info', `Stopwatch: ${Math.round(ms)} ms`);
    if (pending?.baseline) return; // normal flow: firmware manages sleep, never send 06 here
    try {
      await d?.epdSleep();
      addLog('info', 'Đã gửi 06 (ngủ sâu bộ điều khiển)');
    } catch (e) {
      addLog('error', `Không gửi được 06: ${errMsg(e)}. Hãy bấm "Gửi ngủ (06)" hoặc chạy lại refresh chuẩn.`);
    }
  };

  const abandon = () => {
    clearInterval(timer.current);
    setPending(undefined);
    setPhase('idle');
    if (!pending?.baseline) void d?.epdSleep().catch(() => undefined);
  };

  const save = () => {
    if (!pending) return;
    setResults((r) => [...r, {
      id: r.length + 1,
      image: pending.image,
      updateValue: pending.options.updateValue,
      ...(pending.options.lut ? { lut: pending.options.lut } : {}),
      bypassRed: pending.options.bypassRed,
      border: pending.options.border,
      durationMs: pending.durationMs,
      density: pending.density,
      ghost: pending.ghost,
      note: pending.note,
      ...(pending.baseline ? { baseline: pending.baseline } : {}),
    }]);
    setPending(undefined);
    setPhase('idle');
  };

  const standardRefresh = () => {
    const last = lastRun.current ?? { planes: makePlanes(image).planes, image };
    void run('Chạy lại refresh chuẩn (05)', async () => {
      const t = await d!.uploadImage(last.planes, { skipBusyWait: true, onProgress: setProgress });
      setProgress(undefined);
      return `đã gửi đen + đỏ và 05 (gửi ${t.sendMs} ms); màn sẽ nhấp nháy khoảng 15-30 s`;
    }, 'Gửi lại ảnh (đen + đỏ) và REFRESH chuẩn 05 để xoá ghost? Màn nhấp nháy 15-30 giây.');
  };

  const restore = () => {
    const snap = s.initialSnapshot;
    if (!snap) return;
    void run('Khôi phục mode ban đầu', async () => {
      const r = await d!.restoreMode(snap, s.saved?.countdownParams);
      if (!r.restored) alert(r.message);
      return r.message;
    }, `Khôi phục mode ban đầu (${snap.mode ?? '?'})?`);
  };

  const meta = () => ({
    'Thiết bị': `${s.saved?.displayName ?? '?'} (fw 0x${(d?.version ?? 0).toString(16)})`,
    mtu: d?.mtu ?? '?',
    Ngày: new Date().toISOString(),
  });
  const copy = (text: string) => navigator.clipboard?.writeText(text);

  return (
    <div class="card">
      <h2>Thử nghiệm refresh đen trắng nhanh</h2>
      <p class="muted">
        Thử bỏ qua `05` REFRESH (waveform 3 màu OTP, ~15-30 s) bằng cách gửi lệnh SSD1680 thô qua opcode 03/04.
        Mặc định dùng waveform OTP có sẵn. Tuỳ chọn "LUT thử nghiệm" ghi một LUT đen/trắng cố định qua 0x32 (ADR-10):
        chỉ chọn trong điện áp OTP đã có, không ghi 0x03/0x04/0x2C/0x3F. Rủi ro thực tế là ảnh nhạt, ghost hoặc âm bản;
        một lần refresh chuẩn sẽ xoá. Không nhập hex tự do. Sau mỗi lần chạy app gửi `06` để đưa bộ điều khiển vào ngủ sâu.
      </p>
      {!d && <p class="muted">Kết nối thiết bị để dùng thử nghiệm này.</p>}

      <label class="field">Ảnh
        <select disabled={disabled} value={image} onChange={(e) => setImage(e.currentTarget.value as ImageKind)}>
          {(Object.keys(IMAGES) as ImageKind[]).map((k) => <option key={k} value={k}>{IMAGES[k].label}</option>)}
        </select>
      </label>
      <canvas ref={preview} class="preview" width={296} height={128} />

      <label class="field">LUT thử nghiệm (0x32)
        <select disabled={disabled} value={opts.lut ?? ''}
          onChange={(e) => { const v = e.currentTarget.value; setOpts({ ...opts, lut: isLutId(v) ? v : undefined }); }}>
          <option value="">Không (dùng waveform OTP)</option>
          {(Object.keys(LUT_PRESETS) as LutId[]).map((k) => <option key={k} value={k}>{LUT_PRESETS[k].label}</option>)}
        </select>
      </label>
      <label class="field">Giá trị Display Update Control 2 (0x22){opts.lut ? ' — bị ép 0xC7 khi dùng LUT' : ''}
        <select disabled={disabled || !!opts.lut} value={opts.updateValue}
          onChange={(e) => setOpts({ ...opts, updateValue: Number(e.currentTarget.value) })}>
          {UPDATE_VALUES.map((v) => <option key={v} value={v}>{UPDATE_INFO[v]}</option>)}
        </select>
      </label>
      <div>
        <label><input type="checkbox" disabled={disabled} checked={opts.bypassRed}
          onChange={(e) => setOpts({ ...opts, bypassRed: e.currentTarget.checked })} /> Bỏ qua RAM đỏ (03 21 / 04 40 00)</label>
      </div>
      <div>
        <label><input type="checkbox" disabled={disabled} checked={opts.border}
          onChange={(e) => setOpts({ ...opts, border: e.currentTarget.checked })} /> Border waveform (03 3C / 04 05)</label>
      </div>

      <div class="row" style="margin-top:8px">
        <button class="primary" disabled={disabled} onClick={start}>Chạy</button>
        <button disabled={!d || busy || phase !== 'idle'} onClick={standardRefresh}>Chạy lại refresh chuẩn (05)</button>
        <button disabled={!d || busy || phase !== 'idle'} onClick={() => run('Gửi ngủ (06)', () => d!.epdSleep(), 'Gửi 06 để đưa bộ điều khiển vào ngủ sâu?')}>Gửi ngủ (06)</button>
        <button disabled={!d || busy || phase !== 'idle' || !s.initialSnapshot} onClick={restore}>Khôi phục mode ban đầu</button>
      </div>
      <h3 style="margin-top:16px">Đo baseline refresh chuẩn (05)</h3>
      <p class="muted">
        Chạy luồng chuẩn (ảnh test BWR) rồi bấm giờ bằng tay như trên, để biết có thể kiểm tra busyMs mặc định (20 s, đo thực tế 15,3 s × 1,25)
        còn hợp lý không. Không gửi 06 ở đây.
      </p>
      <div class="row">
        <button disabled={disabled} onClick={() => startBaseline(false)}>Đo baseline refresh chuẩn (05)</button>
        <button disabled={disabled} onClick={() => startBaseline(true)}>Đo chuẩn 05, chỉ plane đen</button>
      </div>
      {progress && <p class="muted">{progress.phase}: <progress max={1} value={progress.fraction} /></p>}
      {phase === 'sending' && <p class="muted">Đang gửi ảnh và lệnh…</p>}

      {phase === 'waiting' && (
        <div style="margin-top:8px">
          <p><strong>{(elapsed / 1000).toFixed(1)} s</strong> kể từ khi kích hoạt (không đọc BUSY của panel).</p>
          <div class="row">
            <button class="primary" onClick={stopped}>Màn đã ngừng nhấp nháy</button>
            <button onClick={abandon}>Huỷ lần chạy</button>
          </div>
        </div>
      )}

      {phase === 'rating' && pending && (
        <div style="margin-top:8px">
          <p>Thời gian quan sát: <strong>{(pending.durationMs / 1000).toFixed(1)} s</strong></p>
          <div class="row">
            <label class="field">Độ đậm (1-5)
              <select value={pending.density} onChange={(e) => setPending({ ...pending, density: Number(e.currentTarget.value) })}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label class="field">Ghost
              <select value={pending.ghost} onChange={(e) => setPending({ ...pending, ghost: e.currentTarget.value as Ghost })}>
                {(Object.keys(GHOST_LABEL) as Ghost[]).map((g) => <option key={g} value={g}>{GHOST_LABEL[g]}</option>)}
              </select>
            </label>
            <label class="field grow">Ghi chú
              <input value={pending.note} onInput={(e) => setPending({ ...pending, note: e.currentTarget.value })} />
            </label>
          </div>
          <button class="primary" onClick={save}>Lưu kết quả</button>
        </div>
      )}

      {results.length > 0 && (
        <>
          <table class="bench">
            <thead><tr><th>#</th><th>0x22</th><th>Đỏ</th><th>Border</th><th>Giây</th><th>Đậm</th><th>Ghost</th><th>Ghi chú</th></tr></thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td><td>{r.baseline ?? updateLabel(r)}</td><td>{r.baseline ? '-' : r.bypassRed ? 'bỏ qua' : '-'}</td>
                  <td>{r.baseline ? '-' : r.border ? 'có' : '-'}</td><td>{(r.durationMs / 1000).toFixed(1)}</td>
                  <td>{r.density}</td><td>{GHOST_LABEL[r.ghost]}</td><td>{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {suggested !== undefined && (
            <p style="margin-top:8px">busyMs gợi ý: <strong>{suggested} s</strong> <span class="muted">(baseline chậm nhất × 1.25, làm tròn lên)</span></p>
          )}
          <div class="row" style="margin-top:8px">
            <button onClick={() => copy(resultsToMarkdown(results, meta()))}>Sao chép kết quả (markdown)</button>
            <button disabled={phase !== 'idle'} onClick={() => setResults([])}>Xoá bảng</button>
          </div>
        </>
      )}
    </div>
  );
}

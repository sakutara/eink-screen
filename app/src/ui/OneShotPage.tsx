import { useEffect, useRef, useState } from 'preact/hooks';
import { sanitizeLabel } from '../ble/protocol';
import type { UploadProgress } from '../ble/device';
import type { Values } from '../integrations/types';
import { ALGORITHM_FIELD, CONTRAST_FIELD, THRESHOLD_FIELD, PALETTE_FIELD } from '../miniapps/quality';
import { applyCountdown, countdownMaxLabel, drawStill, parseCountdown, sendStill, showCalendar, showClock, type FitMode } from '../modes/oneShot';
import { canvasToPlanes, createCanvas, get2d, putPixels } from '../render/canvas';
import type { Planes } from '../render/pack';
import { disconnectDevice, session } from '../state/session';
import { useAction } from './actions';
import { DevicePicker } from './DevicePicker';
import { FieldForm } from './FieldForm';

const pad = (n: number) => String(n).padStart(2, '0');

export function OneShotPage() {
  const s = session.use();
  const [busy, run] = useAction();
  const d = s.device;
  const ready = s.status === 'connected' && !!d;

  return (
    <>
      <h1>Một lần</h1>
      <DevicePicker hideDisconnect />
      {!ready && <p class="muted">Kết nối thiết bị để cài chế độ cho firmware.</p>}
      {ready && (
        <>
          <div class="card">
            <h2>Lịch và đồng hồ</h2>
            <div class="row">
              <button disabled={busy} onClick={() => run('Lịch', () => showCalendar(d!))}>Lịch</button>
              <button disabled={busy} onClick={() => run('Đồng hồ mặt 1', () => showClock(d!, 1))}>Đồng hồ (mặt 1)</button>
              <button disabled={busy} onClick={() => run('Đồng hồ mặt 2', () => showClock(d!, 2))}>Đồng hồ (mặt 2)</button>
            </div>
          </div>
          <CountdownCard busy={busy} run={run} />
          <StillImageCard busy={busy} run={run} />
          <div class="card">
            <h2>Hoàn tất</h2>
            <p class="muted">Ngắt kết nối không làm gì màn hình: firmware tiếp tục chạy chế độ đã cài (đồng hồ tự cập nhật theo phút).</p>
            <button disabled={busy} onClick={() => run('Ngắt kết nối', disconnectDevice)}>Ngắt kết nối</button>
          </div>
        </>
      )}
    </>
  );
}

type Run = ReturnType<typeof useAction>[1];

function CountdownCard({ busy, run }: { busy: boolean; run: Run }) {
  const s = session.use();
  const d = s.device!;
  const saved = s.saved?.countdownParams;
  const [date, setDate] = useState(saved ? `${saved.year}-${pad(saved.month)}-${pad(saved.day)}` : '');
  const [label, setLabel] = useState(saved?.label ?? '');
  const [maxLabel, setMaxLabel] = useState(8);

  useEffect(() => { void countdownMaxLabel(d).then(setMaxLabel); }, [d]);

  const sent = sanitizeLabel(label, maxLabel);
  return (
    <div class="card">
      <h2>Đếm ngược</h2>
      <div class="row">
        <label class="field">Ngày đích<input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} /></label>
        <label class="field grow">Nhãn (ASCII, tối đa {maxLabel} ký tự)
          <input value={label} maxLength={32} onInput={(e) => setLabel(e.currentTarget.value)} />
        </label>
      </div>
      <p class="muted">Sẽ gửi: "{sent}" ({sent.length}/{maxLabel}). Firmware chỉ vẽ ASCII nên dấu tiếng Việt bị bỏ.</p>
      <button disabled={busy || !date || !sent} onClick={() => run('Đặt đếm ngược', async () => {
        await applyCountdown(d, parseCountdown({ date, label }, maxLabel));
        return 'thiết bị đã xác nhận và lưu tham số';
      }, `Đặt đếm ngược tới ${date} với nhãn "${sent}"? Firmware sẽ lưu vào flash.`)}>Đặt đếm ngược</button>
    </div>
  );
}

function StillImageCard({ busy, run }: { busy: boolean; run: Run }) {
  const s = session.use();
  const d = s.device!;
  const [bitmap, setBitmap] = useState<ImageBitmap>();
  const [fit, setFit] = useState<FitMode>('fit');
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [quality, setQuality] = useState<Values>({ palette: 'bw', algorithm: 'threshold', contrast: 1 });
  const [progress, setProgress] = useState<UploadProgress>();
  const preview = useRef<HTMLCanvasElement>(null);
  const planes = useRef<Planes | undefined>(undefined);

  useEffect(() => {
    if (!bitmap || !preview.current) return;
    const canvas = createCanvas();
    drawStill(get2d(canvas), bitmap, { mode: fit, offsetX, offsetY });
    const out = canvasToPlanes(canvas, {
      palette: quality.palette === 'bwr' ? 'bwr' : 'bw',
      algorithm: (quality.algorithm as 'threshold') ?? 'floyd-steinberg',
      contrast: Number(quality.contrast) || 1,
      threshold: Number(quality.threshold) || undefined,
    });
    planes.current = out.planes;
    putPixels(preview.current, out.preview);
  }, [bitmap, fit, offsetX, offsetY, quality]);

  return (
    <div class="card">
      <h2>Ảnh tĩnh</h2>
      <input
        type="file" accept="image/*"
        onChange={async (e) => {
          const file = e.currentTarget.files?.[0];
          if (file) setBitmap(await createImageBitmap(file));
        }}
      />
      {bitmap && (
        <>
          <div class="row" style="margin-top:8px">
            <label class="field">Cách đặt ảnh
              <select value={fit} onChange={(e) => setFit(e.currentTarget.value as FitMode)}>
                <option value="fit">Vừa khung (có viền trắng)</option>
                <option value="fill">Lấp đầy (cắt bớt)</option>
              </select>
            </label>
          </div>
          <label class="field">Dịch ngang
            <input type="range" min={-1} max={1} step={0.05} value={offsetX} onInput={(e) => setOffsetX(Number(e.currentTarget.value))} />
          </label>
          <label class="field">Dịch dọc
            <input type="range" min={-1} max={1} step={0.05} value={offsetY} onInput={(e) => setOffsetY(Number(e.currentTarget.value))} />
          </label>
          <FieldForm fields={[PALETTE_FIELD, ALGORITHM_FIELD, CONTRAST_FIELD, THRESHOLD_FIELD]} values={quality} onChange={setQuality} />
        </>
      )}
      <p class="muted">Xem trước (đã dither, đúng như màn sẽ hiển thị):</p>
      <canvas ref={preview} class="preview" width={296} height={128} />
      {progress && <p class="muted">{progress.phase}: <progress max={1} value={progress.fraction} /></p>}
      <button class="primary" disabled={busy || !bitmap} onClick={() => run('Gửi ảnh tĩnh', async () => {
        if (!planes.current) throw new Error('Chưa có ảnh');
        const t = await sendStill(d, planes.current, setProgress, quality.palette === 'bwr' ? 'bwr' : 'bw');
        setProgress(undefined);
        return `gửi ${t.sendMs} ms, chờ refresh ${t.busyMs} ms`;
      }, `Gửi ảnh lên màn (mất khoảng ${quality.palette === 'bw' ? 12 : 20} giây, màn nhấp nháy)? Chế độ hiện tại sẽ được thay bằng ảnh.`)}>
        Gửi lên màn
      </button>
    </div>
  );
}

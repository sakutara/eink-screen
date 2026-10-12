import { useEffect, useRef, useState } from 'preact/hooks';
import { Mode, sanitizeLabel } from '../ble/protocol';
import { BUSY_MS_BWR, type UploadProgress } from '../ble/device';
import { canvasToPlanes, putPixels } from '../render/canvas';
import { drawTestPattern } from '../render/testPattern';
import { rememberCountdown, session } from '../state/session';
import { useAction } from './actions';

const todayPlus = (days: number) => {
  const d = new Date(Date.now() + days * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function TestActions() {
  const s = session.use();
  const [busy, run] = useAction();
  const d = s.device;
  const disabled = busy || !d;

  const [date, setDate] = useState(todayPlus(30));
  const [label, setLabel] = useState('TET');
  const [busyMs, setBusyMs] = useState(BUSY_MS_BWR / 1000);
  const [progress, setProgress] = useState<UploadProgress>();
  const preview = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!preview.current) return;
    const canvas = drawTestPattern();
    putPixels(preview.current, canvasToPlanes(canvas, { palette: 'bwr', algorithm: 'threshold' }).preview);
  }, []);

  const setCountdown = () => run('Đặt đếm ngược', async () => {
    const [year, month, day] = date.split('-').map(Number) as [number, number, number];
    const params = { year, month, day, label: sanitizeLabel(label) };
    await d!.setCountdown(params);
    await rememberCountdown(params);
    return 'thiết bị đã xác nhận';
  }, `Đặt đếm ngược tới ${date} với nhãn "${sanitizeLabel(label)}"? Firmware sẽ lưu vào flash.`);

  const sendImage = () => run('Gửi ảnh test', async () => {
    const canvas = drawTestPattern();
    const { planes } = canvasToPlanes(canvas, { palette: 'bwr', algorithm: 'threshold' });
    const t = await d!.uploadImage(planes, { busyMs: busyMs * 1000, onProgress: setProgress });
    setProgress(undefined);
    return `chuẩn bị ${t.prepareMs} ms, gửi ${t.sendMs} ms, chờ refresh ${t.busyMs} ms. Quan sát màn: đúng chiều, không bị gương/xoay?`;
  }, `Gửi ảnh test lên màn (mất khoảng ${busyMs + 10} giây, màn nhấp nháy)? Mode hiện tại sẽ bị thay bằng chế độ ảnh.`);

  const restore = () => {
    const snap = s.initialSnapshot;
    if (!snap) return;
    void run('Khôi phục mode ban đầu', async () => {
      const r = await d!.restoreMode(snap, s.saved?.countdownParams);
      if (!r.restored) alert(r.message);
      return r.message;
    }, `Khôi phục mode ban đầu (${snap.mode ?? '?'})?`);
  };

  const modeBtn = (text: string, mode: number) => (
    <button disabled={disabled} onClick={() => run(text, async () => { await d!.setMode(mode); }, `Chuyển màn sang "${text}"?`)}>
      {text}
    </button>
  );

  return (
    <div class="card">
      <h2>Ma trận test</h2>
      {!d && <p class="muted">Kết nối thiết bị để dùng các nút bên dưới. Mỗi nút đều hỏi xác nhận.</p>}
      <div class="row">
        {modeBtn('Lịch', Mode.CALENDAR)}
        {modeBtn('Đồng hồ 1', Mode.CLOCK_1)}
        {modeBtn('Đồng hồ 2', Mode.CLOCK_2)}
      </div>

      <h2 style="margin-top:16px">Đếm ngược</h2>
      <div class="row">
        <label class="field">Ngày đích<input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} /></label>
        <label class="field grow">Nhãn (ASCII, tối đa 16)
          <input value={label} maxLength={16} onInput={(e) => setLabel(e.currentTarget.value)} />
        </label>
      </div>
      <p class="muted">Gửi đi: "{sanitizeLabel(label)}"</p>
      <div class="row">
        <button disabled={disabled || !date} onClick={setCountdown}>Đặt đếm ngược</button>
        <button disabled={disabled} onClick={() => run('Dừng đếm ngược', () => d!.stopCountdown(), 'Dừng đếm ngược và về đồng hồ 1?')}>Dừng</button>
        <button disabled={disabled} onClick={() => run('Hỏi đếm ngược', async () => {
          const st = await d!.queryCountdown();
          return `st=${st.status} ${st.year}-${st.month}-${st.day} "${st.label}"`;
        }, 'Hỏi trạng thái đếm ngược (D6 FF)?')}>Hỏi đếm ngược</button>
      </div>

      <h2 style="margin-top:16px">Ảnh test BWR</h2>
      <canvas ref={preview} class="preview" width={296} height={128} />
      <div class="row">
        <label class="field">Chờ refresh (giây)
          <input type="number" min={0} max={90} value={busyMs} onInput={(e) => setBusyMs(Number(e.currentTarget.value))} />
        </label>
        <button disabled={disabled} onClick={sendImage}>Gửi ảnh test</button>
      </div>
      {progress && (
        <p class="muted">
          {progress.phase}: <progress max={1} value={progress.fraction} />
        </p>
      )}

      <h2 style="margin-top:16px">Khôi phục</h2>
      <button disabled={disabled || !s.initialSnapshot} onClick={restore}>Khôi phục mode ban đầu</button>
    </div>
  );
}

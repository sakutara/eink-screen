import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BUSY_MS_BWR, BUSY_MS_BW_FAST } from '../ble/device';
import type { Values } from '../integrations/types';
import { formatClock, formatDistance } from '../miniapps/format';
import { directionsSimMiniApp } from '../miniapps/directions/simMiniApp';
import { SIM_DEFAULTS, SIM_ROUTE, framesToArrive, simulateTrip, summarizeTrip } from '../miniapps/directions/simulation';
import { ALGORITHM_FIELD, CONTRAST_FIELD, THRESHOLD_FIELD, DEFAULT_GHOST_CLEAR_EVERY, normalizeQuality } from '../miniapps/quality';
import type { QualitySettings } from '../miniapps/types';
import { renderFrame } from '../modes/frame';
import type { PaletteName } from '../render/dither';
import { putPixels } from '../render/canvas';
import type { PixelImage } from '../render/pack';
import { FieldForm } from './FieldForm';

const MANEUVER_LABEL: Record<string, string> = {
  STRAIGHT: 'Đi thẳng', NAME_CHANGE: 'Đổi tên đường', TURN_RIGHT: 'Rẽ phải', TURN_LEFT: 'Rẽ trái',
  TURN_SLIGHT_LEFT: 'Chếch trái', TURN_SLIGHT_RIGHT: 'Chếch phải', ROUNDABOUT_RIGHT: 'Vòng xuyến',
  ROUNDABOUT_LEFT: 'Vòng xuyến', RAMP_RIGHT: 'Đường dẫn phải', RAMP_LEFT: 'Đường dẫn trái', ARRIVE: 'Đến nơi',
};

const SPEEDS = [1, 5, 30] as const;

function PreviewCanvas({ image, scale = 2 }: { image: PixelImage; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) putPixels(ref.current, image);
  }, [image]);
  return <canvas ref={ref} class="sim-canvas" width={image.width} height={image.height} style={`max-width:${image.width * scale}px`} />;
}

export function SimulationPage() {
  const [sim, setSim] = useState<Values>({ speedKmh: SIM_DEFAULTS.speedKmh, intervalSec: SIM_DEFAULTS.intervalSec, frames: SIM_DEFAULTS.frames });
  const [quality, setQuality] = useState<Values>({ contrast: 1 });
  const [palette, setPalette] = useState<PaletteName>('bw');
  const [speedMul, setSpeedMul] = useState<number>(5);
  const [playing, setPlaying] = useState(false);
  const [shown, setShown] = useState<number>(Infinity);

  const speedKmh = Math.max(1, Number(sim.speedKmh) || SIM_DEFAULTS.speedKmh);
  const intervalSec = Math.max(5, Number(sim.intervalSec) || SIM_DEFAULTS.intervalSec);
  const frameCount = Math.min(60, Math.max(1, Math.floor(Number(sim.frames) || SIM_DEFAULTS.frames)));
  const q = useMemo<QualitySettings>(
    () => normalizeQuality({ ...(quality as Partial<QualitySettings>), palette, ghostClearEvery: DEFAULT_GHOST_CLEAR_EVERY }),
    [quality, palette],
  );

  const frames = useMemo(() => simulateTrip({ speedKmh, intervalSec, frames: frameCount }), [speedKmh, intervalSec, frameCount]);
  const images = useMemo(
    () => frames.map((f) => renderFrame(directionsSimMiniApp, f.data, directionsSimMiniApp.defaultSettings, q)),
    [frames, q],
  );
  const summary = useMemo(() => summarizeTrip(frames, palette, q.ghostClearEvery, intervalSec), [frames, palette, q.ghostClearEvery, intervalSec]);
  const needFrames = framesToArrive(speedKmh, intervalSec);
  const arrivedAt = frames.findIndex((f) => f.data.arrived);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setShown((n) => {
        if (n + 1 >= frames.length) {
          setPlaying(false);
          return frames.length;
        }
        return n + 1;
      });
    }, Math.max(50, (intervalSec * 1000) / speedMul));
    return () => clearInterval(id);
  }, [playing, speedMul, intervalSec, frames.length]);

  const play = () => {
    setShown(1);
    setPlaying(true);
  };
  const visible = Math.min(shown, frames.length);
  const current = Math.max(0, visible - 1);
  const live = playing || shown < Infinity;

  return (
    <>
      <h1>Mô phỏng chỉ đường</h1>
      <p class="muted">
        Chuyến đi giả lập {formatDistance(SIM_ROUTE.distanceMeters)}, {SIM_ROUTE.steps.length} bước. Dùng đúng logic thật
        (computeProgress, directionsKey, render, dither, đóng gói). Không dùng GPS, API hay Bluetooth. Để gửi thật tới màn,
        chọn miniapp "Chỉ đường (mô phỏng)" ở <a href="#/continuous">tab Liên tục</a>.
      </p>

      <div class="card">
        <h2>Thông số</h2>
        <div class="sim-form">
          <FieldForm
            fields={[
              { key: 'speedKmh', label: 'Tốc độ', type: 'number', min: 5, max: 120, step: 5, unit: 'km/h' },
              { key: 'intervalSec', label: 'Khoảng giữa hai khung', type: 'number', min: 5, max: 300, step: 5, unit: 'giây' },
              { key: 'frames', label: 'Số khung', type: 'number', min: 1, max: 60, step: 1 },
            ]}
            values={sim}
            onChange={(v) => { setSim(v); setPlaying(false); setShown(Infinity); }}
          />
          <FieldForm fields={[ALGORITHM_FIELD, CONTRAST_FIELD, THRESHOLD_FIELD]} values={{ ...quality, algorithm: q.algorithm }} onChange={setQuality} />
        </div>
        <div class="row" style="margin-top:10px">
          <span class="muted">Bảng màu</span>
          <button class={palette === 'bw' ? 'primary' : ''} onClick={() => setPalette('bw')}>Đen / trắng</button>
          <button class={palette === 'bwr' ? 'primary' : ''} onClick={() => setPalette('bwr')}>Đen / trắng / đỏ</button>
        </div>
        <div class="row" style="margin-top:10px">
          <button class="primary" onClick={play} disabled={playing}>Phát</button>
          <button onClick={() => { setPlaying(false); setShown(Infinity); }} disabled={!live}>Hiện tất cả</button>
          <span class="muted">Tốc độ phát</span>
          {SPEEDS.map((m) => (
            <button key={m} class={speedMul === m ? 'primary' : ''} onClick={() => setSpeedMul(m)}>×{m}</button>
          ))}
        </div>
        {arrivedAt < 0 && (
          <p class="err">Chưa đến nơi sau {frameCount} khung: cần khoảng {needFrames} khung ở {speedKmh} km/h, {intervalSec} giây.</p>
        )}
      </div>

      <div class="card">
        <h2>Tóm tắt</h2>
        <dl class="kv">
          <dt>Bảng màu</dt><dd>{palette === 'bw' ? 'đen/trắng (nhanh)' : 'đen/trắng/đỏ'}</dd>
          <dt>Số lần làm mới</dt><dd>{summary.refreshCount}/{frames.length} khung</dd>
          <dt>Thời gian màn</dt>
          <dd>~{Math.round(summary.totalMs / 1000)} s cho {Math.round((frames.length * intervalSec))} s mô phỏng</dd>
          <dt>Mỗi lần</dt>
          <dd>{palette === 'bw' ? `${BUSY_MS_BW_FAST / 1000} s (nhanh), ${BUSY_MS_BWR / 1000} s (xoá ghost)` : `${BUSY_MS_BWR / 1000} s`} + gửi ảnh</dd>
        </dl>
        {summary.tooSlow.length > 0 ? (
          <p class="err">
            Khoảng {intervalSec} giây ngắn hơn thời gian làm mới + gửi ảnh ({summary.tooSlow.length} khung): màn sẽ bị trễ,
            runner chỉ giữ khung mới nhất.
          </p>
        ) : (
          <p class="ok">Khoảng {intervalSec} giây đủ cho mỗi lần làm mới + gửi ảnh (ước lượng).</p>
        )}
      </div>

      {live && visible > 0 && (
        <div class="card">
          <h2>Màn hiện tại · +{frames[current]!.tSec} s</h2>
          <PreviewCanvas image={images[current]!.preview} />
        </div>
      )}

      <div class="sim-grid">
        {frames.map((f, i) => {
          const prev = frames[i - 1];
          const changed = !prev || prev.key !== f.key;
          const hidden = i >= visible;
          return (
            <div key={i} class={`card sim-frame${hidden ? ' hidden' : ''}${live && i === current ? ' current' : ''}`}>
              <PreviewCanvas image={images[i]!.preview} />
              <div class="row spread">
                <strong>#{i + 1} · +{f.tSec} s</strong>
                <span class={changed ? 'ok' : 'muted'}>{changed ? '● làm mới' : '○ giữ nguyên'}</span>
              </div>
              <div class="muted">
                {f.data.arrived ? 'Đã đến nơi' : `${MANEUVER_LABEL[f.data.maneuver] ?? f.data.maneuver} sau ${formatDistance(f.data.distanceToManeuver)}`}
              </div>
              <div class="muted">Còn {formatDistance(f.data.remainingMeters)} · đến lúc {formatClock(new Date(f.data.etaMs))}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

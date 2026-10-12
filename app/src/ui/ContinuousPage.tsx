import { useEffect, useRef, useState } from 'preact/hooks';
import { errMsg } from '../ble/device';
import { isIntegrationReady } from '../integrations/registry';
import type { Values } from '../integrations/types';
import { QUALITY_FIELDS, followPaletteInterval, migrateStoredQuality, normalizeQuality } from '../miniapps/quality';
import { getMiniApp, miniApps } from '../miniapps/registry';
import type { QualitySettings } from '../miniapps/types';
import { active } from '../modes/active';
import type { ContinuousRunner, RunnerState } from '../modes/continuous';
import { startMiniApp } from '../modes/launch';
import { putPixels } from '../render/canvas';
import { session } from '../state/session';
import { loadValue } from '../state/settings';
import { DevicePicker } from './DevicePicker';
import { FieldForm } from './FieldForm';
import { ShareCard } from './ShareCard';
import { share } from '../state/share';

const STATE_LABEL: Record<RunnerState, string> = {
  idle: 'Chưa chạy',
  starting: 'Đang chuẩn bị',
  running: 'Đang chạy',
  uploading: 'Đang gửi ảnh',
  stopping: 'Đang dừng',
  stopped: 'Đã dừng',
  error: 'Lỗi',
};

export function ContinuousPage() {
  const { runner } = active.use();
  const s = session.use();
  const sh = share.use();
  const [miniId, setMiniId] = useState(miniApps[0]!.id);
  const [settings, setSettings] = useState<Values>({});
  const [quality, setQuality] = useState<Values>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string>();

  const mini = getMiniApp(miniId)!;
  const live = !!runner && runner.status.state.state !== 'stopped' && runner.status.state.state !== 'error';

  useEffect(() => {
    void (async () => {
      const last = await loadValue<string | undefined>('continuous:lastMiniapp', undefined);
      if (last && getMiniApp(last)) setMiniId(last);
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      setSettings({ ...mini.defaultSettings, ...(await loadValue<Values>(`miniapp:${mini.id}:settings`, {})) });
      setQuality({ ...normalizeQuality(migrateStoredQuality(await loadValue<Partial<QualitySettings>>(`miniapp:${mini.id}:quality`, {}))) });
      const ready = await Promise.all(mini.requires.map(async (id) => [id, await isIntegrationReady(id)] as const));
      setMissing(ready.filter(([, ok]) => !ok).map(([id]) => id));
    })();
  }, [miniId, sh.place?.placeId]);

  // A place shared from Google Maps always targets Chỉ đường.
  useEffect(() => {
    if (sh.phase === 'ready' && !live) setMiniId('directions');
  }, [sh.phase, sh.place?.placeId]);

  const start = async () => {
    setError(undefined);
    const saved = s.saved;
    if (s.status !== 'connected' || !saved) { setError('Hãy kết nối thiết bị trước'); return; }
    const q = normalizeQuality(quality as Partial<QualitySettings>);
    try {
      await startMiniApp(mini, settings, q);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <>
      <h1>Liên tục</h1>
      <ShareCard />
      <DevicePicker hideDisconnect={live} />
      <p class="muted"><a href="#/simulation">Mô phỏng chỉ đường</a>: xem trước chuyến đi giả lập mà không cần GPS hay thiết bị.</p>

      <div class="card">
        <h2>Miniapp</h2>
        <label class="field">Chọn miniapp
          <select disabled={live} value={miniId} onChange={(e) => setMiniId(e.currentTarget.value)}>
            {miniApps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <p class="muted">{mini.description}</p>
        {missing.length > 0 && (
          <p class="err">Cần cấu hình ở tab <a href="#/links">Liên kết</a>: {missing.join(', ')}</p>
        )}
        {mini.settingsSchema.length > 0 && <FieldForm fields={mini.settingsSchema} values={settings} onChange={setSettings} disabled={live} />}
      </div>

      <div class="card">
        <h2>Chất lượng ảnh</h2>
        <FieldForm fields={QUALITY_FIELDS} values={quality} onChange={(v) => setQuality(followPaletteInterval(quality as Partial<QualitySettings>, v as Partial<QualitySettings>))} disabled={live} />
      </div>

      <div class="card">
        <h2>Cách cập nhật</h2>
        <p class="muted">App giữ kết nối Bluetooth suốt phiên và tự kết nối lại nếu bị rớt. Khi dừng, app trả màn về chế độ trước đó rồi ngắt kết nối. Giữ màn hình điện thoại sáng và đừng đóng tab khi đang chạy.</p>
      </div>

      <div class="card">
        <div class="row">
          <button class="primary" disabled={live || missing.length > 0 || s.status !== 'connected'} onClick={start}>Bắt đầu</button>
          <button class="danger" disabled={!live} onClick={() => void runner?.stop()}>Dừng</button>
        </div>
        {error && <div class="err-box" role="alert"><strong>Không bắt đầu được:</strong> {error}</div>}
      </div>

      {runner && <StatusCard runner={runner} />}
    </>
  );
}

function StatusCard({ runner }: { runner: ContinuousRunner }) {
  const st = runner.status.use();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (st.preview && canvas.current) putPixels(canvas.current, st.preview);
  }, [st.preview]);

  const time = (t?: number) => (t ? new Date(t).toLocaleTimeString('vi-VN') : '—');
  const wait = st.nextAllowedAt ? Math.max(0, Math.ceil((st.nextAllowedAt - Date.now()) / 1000)) : 0;
  const frameNo = st.uploads + 1;
  let plain: string;
  if (st.state === 'error') plain = 'Lỗi';
  else if (st.state === 'starting') plain = 'Đang chuẩn bị';
  else if (st.state === 'uploading') {
    plain = `Đang gửi khung ${frameNo}` + (st.progress ? `: ${st.progress.phase} ${Math.round(st.progress.fraction * 100)}%` : '');
  } else if (st.state === 'running') {
    if (st.hasPending) plain = wait > 0 ? `Đang chờ khoảng cập nhật còn ${wait} s` : `Đang chuẩn bị gửi khung ${frameNo}`;
    else plain = 'Đang chờ dữ liệu';
  } else plain = STATE_LABEL[st.state];
  return (
    <div class="card">
      <h2>Trạng thái</h2>
      {st.lastError && <div class="err-box" role="alert"><strong>Lỗi:</strong> {st.lastError}</div>}
      <p><strong>{plain}</strong></p>
      <canvas ref={canvas} class="preview" width={296} height={128} />
      <dl class="kv" style="margin-top:8px">
        <dt>Đã gửi / lỗi</dt><dd>{st.uploads} lần gửi · {st.errors} lỗi</dd>
        <dt>Cập nhật cuối</dt><dd>{time(st.lastUpdateAt)}</dd>
        <dt>Thời gian gửi</dt>
        <dd>{st.lastTimings ? `chuẩn bị ${st.lastTimings.prepareMs} + gửi ${st.lastTimings.sendMs} + chờ ${st.lastTimings.busyMs} ms` : '—'}</dd>
      </dl>
      {st.progress && <p class="muted">{st.progress.phase}: <progress max={1} value={st.progress.fraction} /></p>}
      {st.message && <p class="muted">{st.message}</p>}
      <p class="muted">Xem chi tiết ở nhật ký Chẩn đoán.</p>
    </div>
  );
}

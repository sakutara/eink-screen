import { useEffect, useState } from 'preact/hooks';
import { errMsg } from '../ble/device';
import { capabilities } from '../ble/connect';
import { listDevices, removeDevice, renameDevice, type SavedDevice } from '../devices/store';
import { connectNewDevice, connectSavedDevice, disconnectDevice, session } from '../state/session';
import { modeName } from './actions';

export function DevicesPage() {
  const s = session.use();
  const [devices, setDevices] = useState<SavedDevice[]>([]);
  const [error, setError] = useState<string>();
  const reload = () => listDevices().then(setDevices);
  useEffect(() => { void reload(); }, [s.saved, s.status]);

  const guard = async (fn: () => Promise<void>) => {
    setError(undefined);
    try { await fn(); } catch (e) { setError(errMsg(e)); }
    void reload();
  };

  if (!capabilities().bluetooth) {
    return <div class="card err">Trình duyệt này không hỗ trợ Web Bluetooth. Hãy dùng Chrome trên Android (HTTPS).</div>;
  }

  return (
    <>
      <h1>Thiết bị</h1>
      {error && <div class="card err">{error}</div>}
      {devices.length === 0 && <p class="muted">Chưa có thiết bị nào được lưu.</p>}
      {devices.map((d) => {
        const active = s.status === 'connected' && s.saved?.id === d.id;
        return (
          <div class="card" key={d.id}>
            <div class="row spread">
              <div class="grow">
                <strong>{d.displayName}</strong>
                <div class="muted">
                  {d.advName} · fw {d.version !== undefined ? `0x${d.version.toString(16)}` : '?'} · mode {modeName(d.lastMode)}
                </div>
                <div class="muted">Lần cuối: {new Date(d.lastSeen).toLocaleString('vi-VN')}</div>
              </div>
              {active && <span class="ok">Đã kết nối</span>}
            </div>
            <div class="row" style="margin-top:8px">
              {active ? (
                <button onClick={() => guard(disconnectDevice)}>Ngắt kết nối</button>
              ) : (
                <button class="primary" disabled={s.status === 'connecting'} onClick={() => guard(() => connectSavedDevice(d))}>
                  Kết nối
                </button>
              )}
              <button onClick={() => {
                const name = prompt('Tên thiết bị', d.displayName)?.trim();
                if (name) void guard(async () => { await renameDevice(d.id, name); });
              }}>Đổi tên</button>
              <button class="danger" onClick={() => {
                if (confirm(`Xoá "${d.displayName}" khỏi danh sách?`)) void guard(() => removeDevice(d.id));
              }}>Xoá</button>
            </div>
          </div>
        );
      })}
      <button class="primary" disabled={s.status === 'connecting'} onClick={() => guard(connectNewDevice)}>
        {s.status === 'connecting' ? 'Đang kết nối…' : 'Thêm thiết bị'}
      </button>
    </>
  );
}

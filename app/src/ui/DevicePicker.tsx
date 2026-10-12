import { useEffect, useState } from 'preact/hooks';
import { errMsg } from '../ble/device';
import { listDevices, type SavedDevice } from '../devices/store';
import { connectNewDevice, connectSavedDevice, disconnectDevice, session } from '../state/session';

/** Pick a saved device (or add one) and connect; renders nothing extra once connected except a compact header. */
export function DevicePicker({ children, hideDisconnect }: { children?: unknown; hideDisconnect?: boolean }) {
  const s = session.use();
  const [devices, setDevices] = useState<SavedDevice[]>([]);
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => { void listDevices().then((l) => { setDevices(l); setSelected((cur) => cur ?? l[0]?.id); }); }, [s.status, s.saved]);

  const guard = async (fn: () => Promise<void>) => {
    setError(undefined);
    try { await fn(); } catch (e) { setError(errMsg(e)); }
  };

  const connected = s.status === 'connected' && s.device;
  return (
    <div class="card">
      <h2>Thiết bị</h2>
      {connected ? (
        <div class="row spread">
          <span><span class="ok">Đã kết nối</span> · {s.saved?.displayName}</span>
          {!hideDisconnect && <button onClick={() => guard(disconnectDevice)}>Ngắt kết nối</button>}
        </div>
      ) : (
        <>
          <div class="row">
            {devices.length > 0 && (
              <select class="grow" value={selected} onChange={(e) => setSelected(e.currentTarget.value)}>
                {devices.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}
              </select>
            )}
            {devices.length > 0 && (
              <button class="primary" disabled={s.status === 'connecting' || !selected} onClick={() => {
                const d = devices.find((x) => x.id === selected);
                if (d) void guard(() => connectSavedDevice(d));
              }}>{s.status === 'connecting' ? 'Đang kết nối…' : 'Kết nối'}</button>
            )}
            <button disabled={s.status === 'connecting'} onClick={() => guard(connectNewDevice)}>Thêm thiết bị</button>
          </div>
        </>
      )}
      {error && <p class="err">{error}</p>}
      {children as never}
    </div>
  );
}

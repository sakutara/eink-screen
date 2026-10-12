import { useState } from 'preact/hooks';
import { capabilities, connectSaved, type ConnectResult } from '../ble/connect';
import { listDevices, type SavedDevice } from '../devices/store';
import { openDevice } from '../state/session';
import { useAction } from './actions';

export function ReconnectCard() {
  const [busy, run] = useAction();
  const [report, setReport] = useState<string>();
  const caps = capabilities();

  const test = () => run('Kết nối lại thiết bị đã lưu', async () => {
    const saved: SavedDevice | undefined = (await listDevices())[0];
    if (!saved) throw new Error('Chưa có thiết bị đã lưu (hãy kết nối một lần trước)');
    const t0 = performance.now();
    let result: ConnectResult;
    try {
      result = await connectSaved(saved, { allowPicker: false });
    } catch (e) {
      setReport(`Không kết nối lại được nếu không có hộp chọn: ${e instanceof Error ? e.message : e}`);
      throw e;
    }
    const device = await openDevice(result);
    const total = Math.round(performance.now() - t0);
    await device.disconnect();
    const text = `Thiết bị "${saved.displayName}": đường ${result.path}, tìm ${result.discoveryMs} ms, tổng ${total} ms. ${result.notes.join('; ')}`;
    setReport(text);
    return text;
  }, 'Thử kết nối lại thiết bị đã lưu đầu tiên không qua hộp chọn (sẽ ngắt ngay sau đó)?');

  return (
    <div class="card">
      <h2>Kết nối lại thiết bị đã lưu</h2>
      <dl class="kv">
        <dt>navigator.bluetooth</dt><dd>{String(caps.bluetooth)}</dd>
        <dt>getDevices()</dt><dd>{String(caps.getDevices)}</dd>
        <dt>watchAdvertisements()</dt><dd>{String(caps.watchAdvertisements)}</dd>
      </dl>
      <p class="muted">
        Nếu getDevices không có, bật chrome://flags/#enable-web-bluetooth-new-permissions-backend rồi thử lại.
      </p>
      <button disabled={busy} onClick={test}>Thử kết nối lại</button>
      {report && <p class="muted">{report}</p>}
    </div>
  );
}

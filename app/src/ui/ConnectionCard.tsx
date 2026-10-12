import { useState } from 'preact/hooks';
import { toHex } from '../ble/protocol';
import { capabilities } from '../ble/connect';
import { connectNewDevice, disconnectDevice, session } from '../state/session';
import { modeName, useAction } from './actions';

export function ConnectionCard() {
  const s = session.use();
  const [busy, run] = useAction();
  const [sleepText, setSleepText] = useState('');
  const d = s.device;
  const cfg = d?.config;

  const probe = () => run('Hỏi trạng thái (D6 FF, D8 FF, FB FF)', async () => {
    const out: string[] = [];
    const cd = await d!.queryCountdown().catch((e) => e as Error);
    out.push(cd instanceof Error ? `D6: ${cd.message}` : `D6: st=${cd.status} ${cd.year}-${cd.month}-${cd.day} "${cd.label}"`);
    const caps = await d!.queryCountdownCaps().catch((e) => e as Error);
    out.push(caps instanceof Error ? `D8: ${caps.message}` : `D8: nhãn tối đa ${caps}`);
    const sleep = await d!.querySleep().catch((e) => e as Error);
    out.push(sleep instanceof Error ? `FB: ${sleep.message}` : `FB: ${JSON.stringify(sleep.schedule)} active=${sleep.active}`);
    setSleepText(out.join('\n'));
  });

  return (
    <div class="card">
      <h2>Kết nối</h2>
      {!capabilities().bluetooth && <p class="err">Không có Web Bluetooth trong trình duyệt này.</p>}
      <div class="row">
        {s.status !== 'connected' ? (
          <button class="primary" disabled={s.status === 'connecting'} onClick={() => run('Kết nối thiết bị mới', connectNewDevice)}>
            {s.status === 'connecting' ? 'Đang kết nối…' : 'Kết nối thiết bị'}
          </button>
        ) : (
          <>
            <button onClick={probe} disabled={busy}>Hỏi trạng thái</button>
            <button onClick={() => run('Ngắt kết nối', disconnectDevice)}>Ngắt kết nối</button>
          </>
        )}
      </div>
      {s.error && <p class="err">{s.error}</p>}
      {d && (
        <>
          <dl class="kv" style="margin-top:8px">
            <dt>Tên</dt><dd>{d.bluetooth.name} ({s.saved?.displayName})</dd>
            <dt>Device id</dt><dd>{d.bluetooth.id}</dd>
            <dt>Đường kết nối</dt><dd>{s.connection?.result.path} · tìm {s.connection?.result.discoveryMs} ms</dd>
            <dt>Thời gian</dt>
            <dd>
              GATT {s.connection?.timings.gattMs} + setup {s.connection?.timings.setupMs} + INIT {s.connection?.timings.initMs} = {s.connection?.timings.totalMs} ms
            </dd>
            <dt>Version</dt><dd>{d.version !== undefined ? `0x${d.version.toString(16)}` : '?'}</dd>
            <dt>MTU</dt><dd>{d.mtu ?? '?'} (chunk {d.chunkSize})</dd>
            <dt>Giờ thiết bị</dt><dd>{d.deviceTs ? new Date(d.deviceTs * 1000).toLocaleString('vi-VN') : '?'}</dd>
            <dt>Mode hiện tại</dt><dd>{modeName(d.mode)}</dd>
            <dt>Mode ban đầu</dt><dd>{modeName(s.initialSnapshot?.mode)}</dd>
          </dl>
          {cfg && (
            <>
              <h2 style="margin-top:12px">Config đã giải mã</h2>
              <dl class="kv">
                <dt>Raw</dt><dd>{toHex(cfg.raw)}</dd>
                <dt>Pins</dt><dd>{Object.entries(cfg.pins).map(([k, v]) => `${k}=${v}`).join(' ')}</dd>
                <dt>Model</dt><dd>{cfg.model}{cfg.panelProfile ? ` (panel 0x${cfg.panelProfile.toString(16)})` : ''}</dd>
                <dt>wakeup / led / en</dt><dd>{hexPin(cfg.wakeup)} / {hexPin(cfg.led)} / {hexPin(cfg.en)}</dd>
                <dt>Mode</dt><dd>{modeName(cfg.mode)}</dd>
                <dt>Đầu tuần</dt><dd>{cfg.weekStart === 1 ? 'Thứ 2' : cfg.weekStart === 0 ? 'Chủ Nhật' : '?'}</dd>
              </dl>
            </>
          )}
          <h2 style="margin-top:12px">GATT services</h2>
          <dl class="kv">
            {d.services.map((u) => (<><dt>service</dt><dd key={u}>{u}</dd></>))}
          </dl>
          {sleepText && <pre class="log">{sleepText}</pre>}
        </>
      )}
    </div>
  );
}

const hexPin = (p: number) => (p === 0xff ? 'none' : String(p));

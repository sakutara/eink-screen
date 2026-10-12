import { useEffect, useState } from 'preact/hooks';
import { errMsg } from '../ble/device';
import { listDevices } from '../devices/store';
import { mapsIntentUrl, mapsNavigationUrl, type TravelMode } from '../integrations/googleMaps';
import { getMiniApp } from '../miniapps/registry';
import { active } from '../modes/active';
import { loadMiniAppConfig, startMiniApp } from '../modes/launch';
import { connectSavedDevice, session } from '../state/session';
import { dismissShare, resolveShare, share } from '../state/share';

/** Shown after a place was shared from Google Maps: one tap connects, starts Chỉ đường and opens Maps navigation. */
export function ShareCard() {
  const sh = share.use();
  const s = session.use();
  const { runner } = active.use();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [mode, setMode] = useState<TravelMode>('DRIVE');
  const live = !!runner && runner.status.state.state !== 'stopped' && runner.status.state.state !== 'error';

  useEffect(() => { void resolveShare(); }, []);
  useEffect(() => {
    const mini = getMiniApp('directions');
    if (mini && sh.phase === 'ready') void loadMiniAppConfig(mini).then((c) => setMode(c.settings.mode as TravelMode));
  }, [sh.phase, sh.place?.placeId]);

  if (sh.phase === 'idle') return null;
  const place = sh.place;

  const go = async () => {
    if (!place) return;
    setBusy(true);
    setError(undefined);
    try {
      if (session.state.status !== 'connected') {
        const target = session.state.saved ?? (await listDevices())[0];
        if (!target) throw new Error('Chưa có thiết bị nào: thêm ở tab Thiết bị trước');
        await connectSavedDevice(target);
      }
      const mini = getMiniApp('directions')!;
      const cfg = await loadMiniAppConfig(mini);
      await startMiniApp(mini, { ...cfg.settings, destination: place }, cfg.quality);
      // Best effort: Chrome only allows intent navigation shortly after a tap; the link below is the fallback.
      location.href = mapsIntentUrl(place, mode);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="card">
      <h2>Địa điểm vừa chia sẻ</h2>
      {sh.phase === 'resolving' && <p class="muted">Đang tìm "{sh.query ?? '…'}" trên Google Maps…</p>}
      {sh.phase === 'error' && (
        <>
          <div class="err-box" role="alert">{sh.error}</div>
          <p class="muted">Cần bật Places API (New) và nhập API key ở tab <a href="#/links">Liên kết</a>.</p>
        </>
      )}
      {sh.phase === 'ready' && place && (
        <>
          <p><strong>{place.label}</strong></p>
          <p class="muted">Đã đặt làm điểm đến của Chỉ đường. Nút dưới đây kết nối màn, bắt đầu cập nhật rồi mở Google Maps để dẫn đường.</p>
          <div class="row">
            <button class="primary" disabled={busy || live} onClick={go}>
              {busy ? 'Đang bắt đầu…' : live ? 'Đang chạy' : s.status === 'connected' ? 'Bắt đầu chỉ đường' : 'Kết nối và bắt đầu'}
            </button>
            <a class="btn" href={mapsNavigationUrl(place, mode)} target="_blank" rel="noopener">Mở Google Maps</a>
          </div>
          <p class="muted">Giữ app này hiển thị khi đang chạy (chia đôi màn hình hoặc cửa sổ nổi của Maps): chạy nền có thể làm GPS và Bluetooth ngừng cập nhật.</p>
        </>
      )}
      {error && <div class="err-box" role="alert"><strong>Không bắt đầu được:</strong> {error}</div>}
      <div class="row"><button onClick={dismissShare}>Ẩn</button></div>
    </div>
  );
}

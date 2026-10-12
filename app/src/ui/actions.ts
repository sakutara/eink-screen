import { useState } from 'preact/hooks';
import { errMsg } from '../ble/device';
import { addLog } from '../state/log';

/**
 * Runs `fn` behind an optional confirm(), logging start/end and tracking busy state.
 * Returns [busy, run].
 */
export function useAction(): [boolean, (label: string, fn: () => Promise<string | void>, confirmText?: string) => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const run = async (label: string, fn: () => Promise<string | void>, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    const t0 = performance.now();
    addLog('info', `▶ ${label}`);
    try {
      const msg = await fn();
      addLog('info', `✔ ${label} (${Math.round(performance.now() - t0)} ms)${msg ? ` — ${msg}` : ''}`);
    } catch (e) {
      addLog('error', `✘ ${label}: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return [busy, run];
}

export const modeName = (m: number | undefined): string => {
  switch (m) {
    case 0: return '0 · Ảnh';
    case 1: return '1 · Lịch';
    case 2: return '2 · Đồng hồ 1';
    case 3: return '3 · Đồng hồ 2';
    case 7: return '7 · Đồng hồ + ảnh';
    case 8: return '8 · Đếm ngược';
    case undefined: return '?';
    default: return String(m);
  }
};

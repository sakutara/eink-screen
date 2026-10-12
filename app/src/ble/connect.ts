import { DFU_SERVICE, EPD_SERVICE } from './protocol';
import type { SavedDevice } from '../devices/store';

export type ConnectPath = 'getDevices' | 'getDevices+watchAdvertisements' | 'requestDevice(name)' | 'requestDevice(prefix)';

export interface ConnectResult {
  device: BluetoothDevice;
  path: ConnectPath;
  /** Time spent finding the device (before the GATT connection). */
  discoveryMs: number;
  notes: string[];
}

export interface Capabilities {
  bluetooth: boolean;
  getDevices: boolean;
  watchAdvertisements: boolean;
}

const OPTIONAL_SERVICES = [EPD_SERVICE, DFU_SERVICE];

export function capabilities(): Capabilities {
  const bt = typeof navigator !== 'undefined' ? navigator.bluetooth : undefined;
  return {
    bluetooth: !!bt,
    getDevices: !!bt && typeof bt.getDevices === 'function',
    watchAdvertisements:
      typeof (globalThis as { BluetoothDevice?: { prototype?: BluetoothDevice } }).BluetoothDevice?.prototype?.watchAdvertisements === 'function',
  };
}

export async function connectNew(): Promise<ConnectResult> {
  const t0 = performance.now();
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: 'NRF_EPD' }],
    optionalServices: OPTIONAL_SERVICES,
  });
  return { device, path: 'requestDevice(prefix)', discoveryMs: elapsed(t0), notes: [] };
}

export interface ConnectSavedOptions {
  /** Allow falling back to the chooser (needs a user gesture). Disabled for automated runs. */
  allowPicker?: boolean;
  advertisementTimeoutMs?: number;
}

/**
 * Reconnects without the chooser when possible:
 * getDevices() by id -> watchAdvertisements (when supported) -> GATT connect.
 * The GATT connection is left open so the caller can reuse it.
 */
export async function connectSaved(saved: SavedDevice, opts: ConnectSavedOptions = {}): Promise<ConnectResult> {
  const { allowPicker = true, advertisementTimeoutMs = 8000 } = opts;
  const t0 = performance.now();
  const notes: string[] = [];
  const caps = capabilities();

  if (caps.getDevices) {
    const known = (await navigator.bluetooth.getDevices()).find((d) => d.id === saved.id);
    if (known) {
      let path: ConnectPath = 'getDevices';
      if (caps.watchAdvertisements) {
        const seen = await waitForAdvertisement(known, advertisementTimeoutMs);
        notes.push(seen ? 'Đã thấy gói quảng bá' : 'Không thấy gói quảng bá trong thời gian chờ, vẫn thử kết nối');
        path = 'getDevices+watchAdvertisements';
      }
      const discoveryMs = elapsed(t0);
      try {
        await known.gatt?.connect();
        return { device: known, path, discoveryMs, notes };
      } catch (e) {
        notes.push(`gatt.connect thất bại: ${e instanceof Error ? e.message : e}`);
      }
    } else {
      notes.push('Không tìm thấy thiết bị trong getDevices()');
    }
  } else {
    notes.push('navigator.bluetooth.getDevices không được hỗ trợ');
  }

  if (!allowPicker) throw new Error(`Không kết nối lại được không cần chọn thiết bị. ${notes.join('; ')}`);
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ name: saved.advName }],
    optionalServices: OPTIONAL_SERVICES,
  });
  return { device, path: 'requestDevice(name)', discoveryMs: elapsed(t0), notes };
}

function waitForAdvertisement(device: BluetoothDevice, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const abort = new AbortController();
    const done = (seen: boolean) => {
      clearTimeout(timer);
      device.removeEventListener('advertisementreceived', onAdvert);
      abort.abort();
      resolve(seen);
    };
    const onAdvert = () => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    device.addEventListener('advertisementreceived', onAdvert);
    device.watchAdvertisements({ signal: abort.signal }).catch(() => done(false));
  });
}

const elapsed = (t0: number) => Math.round(performance.now() - t0);

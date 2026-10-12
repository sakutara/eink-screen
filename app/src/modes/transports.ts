import { connectSaved } from '../ble/connect';
import type { EpdDevice, ModeSnapshot, RestoreResult, UploadProgress, UploadTimings } from '../ble/device';
import type { CountdownParams } from '../ble/protocol';
import type { SavedDevice } from '../devices/store';
import type { Planes } from '../render/pack';
import { disconnectDevice, openDevice, session } from '../state/session';
import type { UpdateTransport } from './continuous';
import type { RefreshMethod } from './refreshMethod';

/** One frame: normal black+red refresh, or the black-only fast path (red plane ignored). */
function sendFrame(
  d: EpdDevice,
  planes: Planes,
  onProgress: ((p: UploadProgress) => void) | undefined,
  method: RefreshMethod,
  busy: { busyMs?: number; fastBusyMs?: number },
): Promise<UploadTimings> {
  return method === 'fast'
    ? d.uploadBlackFast(planes.black, { onProgress, busyMs: busy.fastBusyMs })
    : d.uploadImage(planes, { onProgress, busyMs: busy.busyMs });
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const snapshotOf = (d: EpdDevice): ModeSnapshot => ({ mode: d.mode, weekStart: d.config?.weekStart, config: d.config });

async function closeDevice(d: EpdDevice): Promise<void> {
  if (session.state.device === d) await disconnectDevice();
  else await d.disconnect();
}

async function connectFresh(saved: SavedDevice, allowPicker: boolean): Promise<EpdDevice> {
  return openDevice(await connectSaved(saved, { allowPicker }));
}

/** Retries with exponential backoff (1 s, 2 s, 4 s, 8 s). */
async function connectWithBackoff(saved: SavedDevice, attempts = 5): Promise<EpdDevice> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await delay(1000 * 2 ** (i - 1));
    try {
      return await connectFresh(saved, false);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/** One GATT session for the whole run; reconnects with backoff after a drop. */
export class KeepAliveTransport implements UpdateTransport {
  private device: EpdDevice | undefined;

  constructor(
    private readonly saved: SavedDevice,
    private readonly existing?: EpdDevice,
    private readonly busyMs?: number,
    private readonly fastBusyMs?: number,
  ) {}

  async open(): Promise<ModeSnapshot> {
    this.device = this.existing?.connected ? this.existing : await connectFresh(this.saved, true);
    return snapshotOf(this.device);
  }

  private async ensure(): Promise<EpdDevice> {
    if (this.device?.connected) return this.device;
    this.device = await connectWithBackoff(this.saved);
    return this.device;
  }

  async send(planes: Planes, onProgress?: (p: UploadProgress) => void, method: RefreshMethod = 'full'): Promise<UploadTimings> {
    const device = await this.ensure();
    return sendFrame(device, planes, onProgress, method, { busyMs: this.busyMs, fastBusyMs: this.fastBusyMs });
  }

  async restore(snapshot: ModeSnapshot | undefined, countdown?: CountdownParams): Promise<RestoreResult> {
    // Without a snapshot the device itself falls back to the calendar app, before we disconnect.
    const device = await this.ensure();
    return device.restoreMode(snapshot, countdown);
  }

  async dispose(): Promise<void> {
    if (this.device) await closeDevice(this.device).catch(() => undefined);
    this.device = undefined;
  }
}

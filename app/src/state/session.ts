import { EpdDevice, errMsg, type ConnectTimings, type ModeSnapshot } from '../ble/device';
import { connectNew, connectSaved, type ConnectResult } from '../ble/connect';
import { upsertDevice, type SavedDevice } from '../devices/store';
import { addLog, pushLog } from './log';
import { Store } from './store';

export interface SessionState {
  status: 'idle' | 'connecting' | 'connected';
  device: EpdDevice | undefined;
  saved: SavedDevice | undefined;
  connection: { result: ConnectResult; timings: ConnectTimings } | undefined;
  /** Mode captured the first time this physical device connected in this app session. */
  initialSnapshot: ModeSnapshot | undefined;
  error: string | undefined;
}

export const session = new Store<SessionState>({
  status: 'idle',
  device: undefined,
  saved: undefined,
  connection: undefined,
  initialSnapshot: undefined,
  error: undefined,
});

/** Wraps a freshly discovered BluetoothDevice in an EpdDevice and runs the connect handshake. */
export async function openDevice(result: ConnectResult): Promise<EpdDevice> {
  const device = new EpdDevice(result.device);
  device.on('log', pushLog);
  await device.connect();
  return device;
}

async function attach(result: ConnectResult): Promise<void> {
  session.set({ status: 'connecting', error: undefined });
  try {
    await session.state.device?.disconnect();
    const device = await openDevice(result);
    device.on('disconnect', () => {
      if (session.state.device === device) session.set({ status: 'idle', device: undefined });
    });

    const id = result.device.id;
    const saved = await upsertDevice({
      id,
      advName: result.device.name ?? 'NRF_EPD',
      version: device.version,
      model: device.config?.model,
      lastMode: device.snapshot?.mode,
      lastSeen: Date.now(),
    });
    const sameDevice = session.state.saved?.id === id;
    session.set({
      status: 'connected',
      device,
      saved,
      connection: { result, timings: device.timings as ConnectTimings },
      initialSnapshot: sameDevice && session.state.initialSnapshot ? session.state.initialSnapshot : device.snapshot,
    });
  } catch (e) {
    addLog('error', `Kết nối thất bại: ${errMsg(e)}`);
    session.set({ status: 'idle', device: undefined, error: errMsg(e) });
    throw e;
  }
}

export async function connectNewDevice(): Promise<void> {
  await attach(await connectNew());
}

export async function connectSavedDevice(saved: SavedDevice): Promise<void> {
  await attach(await connectSaved(saved));
}

export async function disconnectDevice(): Promise<void> {
  await session.state.device?.disconnect();
  session.set({ status: 'idle', device: undefined });
}

export async function rememberCountdown(params: SavedDevice['countdownParams']): Promise<void> {
  const saved = session.state.saved;
  if (!saved) return;
  session.set({ saved: await upsertDevice({ id: saved.id, countdownParams: params }) });
}

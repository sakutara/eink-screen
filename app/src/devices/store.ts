import { get, set } from 'idb-keyval';
import type { CountdownParams } from '../ble/protocol';

export interface SavedDevice {
  /** `BluetoothDevice.id`: stable per origin, not a MAC address. */
  id: string;
  advName: string;
  displayName: string;
  version?: number;
  model?: number;
  lastMode?: number;
  countdownParams?: CountdownParams;
  lastSeen: number;
}

const KEY = 'devices';

export async function listDevices(): Promise<SavedDevice[]> {
  return (await get<SavedDevice[]>(KEY)) ?? [];
}

export async function getDevice(id: string): Promise<SavedDevice | undefined> {
  return (await listDevices()).find((d) => d.id === id);
}

/** Inserts or merges by id; a new device defaults its display name to the advertised name. */
export async function upsertDevice(patch: Partial<SavedDevice> & Pick<SavedDevice, 'id'>): Promise<SavedDevice> {
  const all = await listDevices();
  const i = all.findIndex((d) => d.id === patch.id);
  const base: SavedDevice = i >= 0
    ? (all[i] as SavedDevice)
    : { id: patch.id, advName: patch.advName ?? 'NRF_EPD', displayName: patch.advName ?? 'NRF_EPD', lastSeen: Date.now() };
  const merged = { ...base, ...stripUndefined(patch) };
  if (i >= 0) all[i] = merged;
  else all.push(merged);
  await set(KEY, all);
  return merged;
}

export const renameDevice = (id: string, displayName: string) => upsertDevice({ id, displayName });

export async function removeDevice(id: string): Promise<void> {
  await set(KEY, (await listDevices()).filter((d) => d.id !== id));
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

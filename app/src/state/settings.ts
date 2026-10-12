import { del, get, set } from 'idb-keyval';

/** Thin typed wrapper over idb-keyval; every failure falls back to the default. */
export async function loadValue<T>(key: string, fallback: T): Promise<T> {
  try {
    return (await get<T>(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

export const saveValue = <T>(key: string, value: T): Promise<void> => set(key, value);
export const removeValue = (key: string): Promise<void> => del(key);

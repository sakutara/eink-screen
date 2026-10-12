import type { LogEntry } from '../ble/device';
import { Store } from './store';

const MAX = 500;

export const logStore = new Store<{ entries: LogEntry[] }>({ entries: [] });

export function addLog(dir: LogEntry['dir'], text: string): void {
  const entries = [...logStore.state.entries, { t: Date.now(), dir, text }];
  logStore.set({ entries: entries.slice(-MAX) });
}

export const pushLog = (entry: LogEntry): void => addLog(entry.dir, entry.text);

export const clearLog = (): void => logStore.set({ entries: [] });

export function logAsText(): string {
  return logStore.state.entries
    .map((e) => `${new Date(e.t).toISOString().slice(11, 23)} ${e.dir.padEnd(5)} ${e.text}`)
    .join('\n');
}

import { del } from 'idb-keyval';
import { loadValue, saveValue } from '../state/settings';
import type { StoredTokens, Values } from './types';

const cfgKey = (id: string) => `integration:${id}:config`;
const tokKey = (id: string) => `integration:${id}:tokens`;

export const loadConfig = (id: string): Promise<Values> => loadValue<Values>(cfgKey(id), {});
export const saveConfig = (id: string, cfg: Values): Promise<void> => saveValue(cfgKey(id), cfg);
export const loadTokens = (id: string): Promise<StoredTokens | undefined> => loadValue<StoredTokens | undefined>(tokKey(id), undefined);
export const saveTokens = (id: string, t: StoredTokens): Promise<void> => saveValue(tokKey(id), t);
export const clearTokens = (id: string): Promise<void> => del(tokKey(id));

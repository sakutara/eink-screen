import { errMsg } from '../ble/device';
import { GOOGLE_MAPS_ID, type GoogleMapsClient } from '../integrations/googleMaps';
import { getReadyClient } from '../integrations/registry';
import { parseSharedPlace, shareParamsFromSearch, type ShareParams } from '../integrations/share';
import type { PlaceValue } from '../integrations/types';
import { getMiniApp } from '../miniapps/registry';
import { loadMiniAppConfig } from '../modes/launch';
import { addLog } from './log';
import { saveValue } from './settings';
import { Store } from './store';

export type SharePhase = 'idle' | 'resolving' | 'ready' | 'error';

export interface ShareState {
  phase: SharePhase;
  /** What the person shared, for display while resolving or on error. */
  query?: string;
  place?: PlaceValue;
  error?: string;
}

/** A place shared from Google Maps (Web Share Target) waiting to become the Chỉ đường destination. */
export const share = new Store<ShareState>({ phase: 'idle' });

let incoming: ShareParams | null = null;

/**
 * Run once before the first render. Consumes `?title=&text=&url=` from the share target,
 * cleans the URL and routes to the Liên tục tab. Returns true when this load was a share.
 */
export function captureShare(): boolean {
  incoming = shareParamsFromSearch(location.search);
  if (!incoming) return false;
  history.replaceState(null, '', `${location.pathname}#/continuous`);
  share.set({ phase: 'resolving', query: parseSharedPlace(incoming)?.query });
  return true;
}

/** Resolves the captured share to a Places id and stores it as the directions destination. */
export async function resolveShare(): Promise<void> {
  const params = incoming;
  incoming = null;
  if (!params) return;
  try {
    const shared = parseSharedPlace(params);
    if (!shared) throw new Error('Không đọc được địa điểm từ nội dung chia sẻ. Hãy chọn một địa điểm có tên trong Google Maps rồi chia sẻ lại.');
    addLog('info', `Nhận địa điểm chia sẻ: ${shared.query}`);
    const maps = await getReadyClient<GoogleMapsClient>(GOOGLE_MAPS_ID);
    const found = await maps.searchPlace(shared.query, shared.coords);
    if (!found) throw new Error(`Không tìm thấy "${shared.query}" trên Google Maps`);
    const place: PlaceValue = { placeId: found.placeId, label: found.text };
    const mini = getMiniApp('directions');
    if (!mini) throw new Error('Không có miniapp Chỉ đường');
    const { settings } = await loadMiniAppConfig(mini);
    await saveValue(`miniapp:${mini.id}:settings`, { ...settings, destination: place });
    await saveValue('continuous:lastMiniapp', mini.id);
    share.set({ phase: 'ready', place, error: undefined });
  } catch (e) {
    addLog('error', `Chia sẻ địa điểm thất bại: ${errMsg(e)}`);
    share.set({ phase: 'error', error: errMsg(e) });
  }
}

export const dismissShare = (): void => share.set({ phase: 'idle', place: undefined, error: undefined, query: undefined });

import { Store } from '../state/store';
import { googleMaps } from './googleMaps';
import { spotify } from './spotify';
import { loadConfig, loadTokens } from './store';
import type { Integration } from './types';

/** Adding an integration = new file + one line here. */
export const integrations: Integration<unknown>[] = [googleMaps, spotify] as Integration<unknown>[];

export const getIntegration = (id: string): Integration<unknown> | undefined => integrations.find((i) => i.id === id);

/** Client for a configured integration, or throws a Vietnamese error pointing the user to the Links tab. */
export async function getReadyClient<T>(id: string): Promise<T> {
  const integ = getIntegration(id);
  if (!integ) throw new Error(`Không có liên kết "${id}"`);
  const [cfg, tokens] = await Promise.all([loadConfig(id), loadTokens(id)]);
  if (!integ.isReady(cfg, tokens)) throw new Error(`${integ.name} chưa sẵn sàng: cấu hình ở tab Liên kết`);
  return integ.getClient(cfg) as T;
}

export async function isIntegrationReady(id: string): Promise<boolean> {
  const integ = getIntegration(id);
  if (!integ) return false;
  const [cfg, tokens] = await Promise.all([loadConfig(id), loadTokens(id)]);
  return integ.isReady(cfg, tokens);
}

export const authNotice = new Store<{ message?: string; error?: boolean }>({});

/** Run once on app load: lets each integration consume an OAuth callback in the URL. */
export async function handleAuthRedirects(): Promise<void> {
  for (const integ of integrations) {
    if (!integ.handleRedirect) continue;
    try {
      if (await integ.handleRedirect(await loadConfig(integ.id))) {
        location.hash = '#/links';
        authNotice.set({ message: `Đã kết nối ${integ.name}` });
        return;
      }
    } catch (e) {
      location.hash = '#/links';
      authNotice.set({ message: e instanceof Error ? e.message : String(e), error: true });
      return;
    }
  }
}

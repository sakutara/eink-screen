import { migrateStoredQuality, normalizeQuality } from '../miniapps/quality';
import type { MiniApp, QualitySettings } from '../miniapps/types';
import type { Values } from '../integrations/types';
import { session } from '../state/session';
import { loadValue, saveValue } from '../state/settings';
import { setActiveRunner } from './active';
import { ContinuousRunner } from './continuous';
import { KeepAliveTransport } from './transports';

/** Stored settings and quality of a miniapp, merged with its defaults. */
export async function loadMiniAppConfig(mini: MiniApp): Promise<{ settings: Values; quality: QualitySettings }> {
  const settings = { ...mini.defaultSettings, ...(await loadValue<Values>(`miniapp:${mini.id}:settings`, {})) };
  const quality = normalizeQuality(migrateStoredQuality(await loadValue<Partial<QualitySettings>>(`miniapp:${mini.id}:quality`, {})));
  return { settings, quality };
}

/** Persists the config and starts a continuous run on the connected device. Throws a Vietnamese error otherwise. */
export async function startMiniApp(mini: MiniApp, settings: Values, quality: QualitySettings): Promise<ContinuousRunner> {
  const { status, saved, device } = session.state;
  if (status !== 'connected' || !saved) throw new Error('Hãy kết nối thiết bị trước');
  await saveValue(`miniapp:${mini.id}:settings`, settings);
  await saveValue(`miniapp:${mini.id}:quality`, quality);
  await saveValue('continuous:lastMiniapp', mini.id);
  const runner = new ContinuousRunner({
    miniapp: mini,
    settings,
    quality,
    transport: new KeepAliveTransport(saved, device),
    countdown: saved.countdownParams,
  });
  setActiveRunner(runner);
  await runner.start();
  return runner;
}

import { useEffect, useState } from 'preact/hooks';
import { errMsg } from '../ble/device';
import { authNotice, integrations } from '../integrations/registry';
import { clearTokens, loadConfig, loadTokens, saveConfig } from '../integrations/store';
import type { Integration, StoredTokens, Values } from '../integrations/types';
import { FieldForm } from './FieldForm';

export function LinksPage() {
  const notice = authNotice.use();
  return (
    <>
      <h1>Liên kết</h1>
      {notice.message && <div class={`card ${notice.error ? 'err' : 'ok'}`}>{notice.message}</div>}
      {integrations.map((i) => <IntegrationCard key={i.id} integ={i} />)}
    </>
  );
}

function IntegrationCard({ integ }: { integ: Integration<unknown> }) {
  const [cfg, setCfg] = useState<Values>({});
  const [tokens, setTokens] = useState<StoredTokens>();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; error: boolean }>();

  const reload = async () => {
    setCfg(await loadConfig(integ.id));
    setTokens(await loadTokens(integ.id));
    setLoaded(true);
  };
  useEffect(() => { void reload(); }, [integ.id]);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setResult(undefined);
    try {
      const text = await fn();
      if (text) setResult({ text, error: false });
    } catch (e) {
      setResult({ text: errMsg(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  const ready = loaded && integ.isReady(cfg, tokens);
  const oauth = integ.auth.kind === 'oauthPkce';

  return (
    <div class="card">
      <div class="row spread">
        <h2>{integ.name}</h2>
        <span class={ready ? 'ok' : 'muted'}>{ready ? 'Đã kết nối' : 'Chưa kết nối'}</span>
      </div>
      <p class="muted">{integ.description}</p>
      <FieldForm fields={integ.configFields} values={cfg} onChange={setCfg} disabled={busy} />
      {integ.info?.().map((row) => (
        <div class="info" key={row.label}>
          <span class="muted">{row.label}</span>
          <code>{row.value}</code>
        </div>
      ))}
      <div class="row" style="margin-top:8px">
        <button disabled={busy} onClick={() => run(async () => { await saveConfig(integ.id, cfg); await reload(); return 'Đã lưu'; })}>
          Lưu
        </button>
        {oauth && integ.connect && (
          <button class="primary" disabled={busy} onClick={() => run(async () => {
            await saveConfig(integ.id, cfg);
            await integ.connect?.(cfg); // redirects away
          })}>{tokens ? 'Kết nối lại' : 'Kết nối'}</button>
        )}
        {integ.test && (
          <button disabled={busy || !ready} onClick={() => run(() => integ.test!(cfg))}>Kiểm tra</button>
        )}
        <button class="danger" disabled={busy} onClick={() => {
          if (!confirm(`Xoá cấu hình và token của ${integ.name} trên máy này?`)) return;
          void run(async () => {
            await clearTokens(integ.id);
            await saveConfig(integ.id, {});
            await reload();
            return 'Đã ngắt kết nối';
          });
        }}>Ngắt kết nối</button>
      </div>
      {result && <pre class={`log ${result.error ? 'error' : ''}`} style="white-space:pre-wrap">{result.text}</pre>}
    </div>
  );
}

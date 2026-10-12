import { useEffect, useRef, useState } from 'preact/hooks';
import { errMsg } from '../ble/device';
import type { GoogleMapsClient } from '../integrations/googleMaps';
import { getReadyClient } from '../integrations/registry';
import type { FieldSpec, PlaceValue, Values } from '../integrations/types';

interface Props {
  fields: FieldSpec[];
  values: Values;
  onChange(next: Values): void;
  disabled?: boolean;
}

/** Generic form generated from FieldSpec[]; used by Links, Continuous and One-shot pages. */
export function FieldForm({ fields, values, onChange, disabled }: Props) {
  const set = (key: string, v: unknown) => onChange({ ...values, [key]: v });
  return (
    <div class="form">
      {fields.map((f) => (
        <label class="field" key={f.key}>
          <span>{f.label}{f.required ? ' *' : ''}{f.type === 'number' && f.unit ? ` (${f.unit})` : ''}</span>
          {f.type === 'select' ? (
            <select disabled={disabled} value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.currentTarget.value)}>
              {f.options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
            </select>
          ) : f.type === 'number' ? (
            <input
              type="number" inputMode="decimal" disabled={disabled} min={f.min} max={f.max} step={f.step}
              value={values[f.key] === undefined ? '' : String(values[f.key])}
              onInput={(e) => {
                const n = e.currentTarget.valueAsNumber;
                set(f.key, Number.isNaN(n) ? undefined : n);
              }}
            />
          ) : f.type === 'checkbox' ? (
            <input type="checkbox" disabled={disabled} checked={!!values[f.key]} onChange={(e) => set(f.key, e.currentTarget.checked)} />
          ) : f.type === 'place' ? (
            <PlaceField spec={f} value={values[f.key] as PlaceValue | null | undefined} onChange={(v) => set(f.key, v)} disabled={disabled} />
          ) : f.type === 'password' ? (
            <input
              type="password" disabled={disabled} placeholder={f.placeholder} autocomplete="off"
              value={String(values[f.key] ?? '')} onInput={(e) => set(f.key, e.currentTarget.value)}
            />
          ) : (
            <input
              type="text" disabled={disabled} placeholder={f.placeholder} autocomplete="off" autocapitalize="off" spellcheck={false}
              value={String(values[f.key] ?? '')} onInput={(e) => set(f.key, e.currentTarget.value)}
            />
          )}
          {f.help && <small class="muted">{f.help}</small>}
        </label>
      ))}
    </div>
  );
}

function PlaceField({ spec, value, onChange, disabled }: {
  spec: Extract<FieldSpec, { type: 'place' }>;
  value: PlaceValue | null | undefined;
  onChange(v: PlaceValue | null): void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value?.label ?? '');
  const [options, setOptions] = useState<{ placeId: string; text: string }[]>([]);
  const [error, setError] = useState<string>();
  const token = useRef(crypto.randomUUID());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const search = (q: string) => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setOptions([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const client = await getReadyClient<GoogleMapsClient>(spec.integration);
        setOptions(await client.autocomplete(q, token.current));
        setError(undefined);
      } catch (e) {
        setError(errMsg(e));
        setOptions([]);
      }
    }, 300);
  };

  return (
    <div class="place">
      <input
        disabled={disabled} value={text} placeholder="Gõ để tìm địa điểm…" autocomplete="off"
        onInput={(e) => { setText(e.currentTarget.value); search(e.currentTarget.value); }}
      />
      {value && <small class="ok">Đã chọn: {value.label}</small>}
      {error && <small class="err">{error}</small>}
      {options.length > 0 && (
        <ul class="suggest">
          {options.map((o) => (
            <li key={o.placeId}>
              <button type="button" onClick={() => {
                onChange({ placeId: o.placeId, label: o.text });
                setText(o.text);
                setOptions([]);
                token.current = crypto.randomUUID(); // a new session starts after a selection
              }}>{o.text}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

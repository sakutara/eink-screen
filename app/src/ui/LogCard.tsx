import { useEffect, useRef } from 'preact/hooks';
import { clearLog, logAsText, logStore } from '../state/log';

export function LogCard() {
  const { entries } = logStore.use();
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => { ref.current?.scrollTo(0, ref.current.scrollHeight); }, [entries.length]);
  return (
    <div class="card">
      <div class="row spread">
        <h2>Nhật ký (hex vào/ra)</h2>
        <div class="row">
          <button onClick={() => navigator.clipboard?.writeText(logAsText())}>Sao chép</button>
          <button onClick={clearLog}>Xoá</button>
        </div>
      </div>
      <pre class="log" ref={ref}>
        {entries.map((e, i) => (
          <div key={i} class={e.dir}>
            {new Date(e.t).toISOString().slice(11, 23)} {e.dir === 'out' ? '→' : e.dir === 'in' ? '←' : ' '} {e.text}
          </div>
        ))}
      </pre>
    </div>
  );
}

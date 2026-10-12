import type { ComponentChildren } from 'preact';
import { ContinuousPage } from './ContinuousPage';
import { DevicesPage } from './DevicesPage';
import { DiagnosticsPage } from './DiagnosticsPage';
import { LinksPage } from './LinksPage';
import { OneShotPage } from './OneShotPage';
import { SimulationPage } from './SimulationPage';
import { useHashRoute } from './useHashRoute';

const TABS = [
  { path: '/devices', label: 'Thiết bị' },
  { path: '/oneshot', label: 'Một lần' },
  { path: '/continuous', label: 'Liên tục' },
  { path: '/links', label: 'Liên kết' },
  { path: '/diagnostics', label: 'Chẩn đoán' },
];

export function App() {
  const route = useHashRoute();
  // Sub-pages keep their parent tab highlighted.
  const tab = TABS.find((t) => t.path === (route === '/simulation' ? '/continuous' : route)) ?? TABS[0]!;
  let page: ComponentChildren;
  switch (tab.path) {
    case '/devices': page = <DevicesPage />; break;
    case '/oneshot': page = <OneShotPage />; break;
    case '/continuous': page = route === '/simulation' ? <SimulationPage /> : <ContinuousPage />; break;
    case '/links': page = <LinksPage />; break;
    case '/diagnostics': page = <DiagnosticsPage />; break;
    default: page = <DevicesPage />;
  }
  return (
    <div class="shell">
      <main>{page}</main>
      <nav class="tabs">
        {TABS.map((t) => (
          <a key={t.path} href={`#${t.path}`} aria-current={t.path === tab.path ? 'page' : undefined}>{t.label}</a>
        ))}
      </nav>
    </div>
  );
}

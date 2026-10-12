import { BenchmarkCard } from './BenchmarkCard';
import { ConnectionCard } from './ConnectionCard';
import { FastRefreshCard } from './FastRefreshCard';
import { LogCard } from './LogCard';
import { ReconnectCard } from './ReconnectCard';
import { TestActions } from './TestActions';

export function DiagnosticsPage() {
  return (
    <>
      <h1>Chẩn đoán</h1>
      <ConnectionCard />
      <TestActions />
      <ReconnectCard />
      <BenchmarkCard />
      <FastRefreshCard />
      <LogCard />
    </>
  );
}

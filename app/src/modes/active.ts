import { Store } from '../state/store';
import type { ContinuousRunner } from './continuous';

/** The single running stream (survives tab navigation). */
export const active = new Store<{ runner: ContinuousRunner | undefined }>({ runner: undefined });

export function setActiveRunner(runner: ContinuousRunner | undefined): void {
  active.set({ runner });
}

// Best effort: hand the display back when the page goes away.
if (typeof addEventListener === 'function') {
  addEventListener('pagehide', () => {
    const r = active.state.runner;
    if (r?.running) void r.stop({ immediate: true });
  });
}

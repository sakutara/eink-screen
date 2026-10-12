export interface WakeLockHandle {
  acquire(): Promise<void>;
  release(): Promise<void>;
}

/** Screen Wake Lock that is re-acquired when the tab becomes visible again (the browser drops it when hidden). */
export function createWakeLock(): WakeLockHandle {
  let sentinel: WakeLockSentinel | undefined;
  let wanted = false;

  const request = async () => {
    try {
      sentinel = await navigator.wakeLock?.request('screen');
    } catch {
      sentinel = undefined; // denied (battery saver) or unsupported: streaming still works
    }
  };
  const onVisible = () => {
    if (wanted && document.visibilityState === 'visible') void request();
  };

  return {
    async acquire() {
      wanted = true;
      document.addEventListener('visibilitychange', onVisible);
      await request();
    },
    async release() {
      wanted = false;
      document.removeEventListener('visibilitychange', onVisible);
      try { await sentinel?.release(); } catch { /* already released */ }
      sentinel = undefined;
    },
  };
}

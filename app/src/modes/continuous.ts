import type { CountdownParams } from '../ble/protocol';
import type { ModeSnapshot, RestoreResult, UploadProgress, UploadTimings } from '../ble/device';
import { errMsg } from '../ble/device';
import { getReadyClient } from '../integrations/registry';
import type { MiniApp, MiniAppRun, QualitySettings } from '../miniapps/types';
import type { PixelImage, Planes } from '../render/pack';
import { addLog } from '../state/log';
import { Store } from '../state/store';
import { renderFrame as defaultRenderFrame, type Frame } from './frame';
import { chooseMethod, withoutRed, type RefreshMethod } from './refreshMethod';
import { createWakeLock, type WakeLockHandle } from './wakeLock';

/** How frames get to the panel. The connection stays open for the whole run; `restore` gives the firmware its mode back. */
export interface UpdateTransport {
  /** Prepares the link and returns the mode to give back to the firmware when streaming ends. */
  open(): Promise<ModeSnapshot | undefined>;
  /** `method` 'fast' = black plane only fast path (only chosen for palette bw); default 'full'. */
  send(planes: Planes, onProgress?: (p: UploadProgress) => void, method?: RefreshMethod): Promise<UploadTimings | undefined>;
  /** Restores the firmware mode and disconnects. */
  restore(snapshot: ModeSnapshot | undefined, countdown?: CountdownParams): Promise<RestoreResult>;
  /** Drops the link without restoring (error paths). */
  dispose(): Promise<void>;
}

export type RunnerState = 'idle' | 'starting' | 'running' | 'uploading' | 'stopping' | 'stopped' | 'error';

export interface RunnerStatus {
  state: RunnerState;
  uploads: number;
  errors: number;
  lastError?: string;
  lastUpdateAt?: number;
  lastKey?: string;
  /** Earliest time the next upload may start (min interval). */
  nextAllowedAt?: number;
  hasPending: boolean;
  lastTimings?: UploadTimings;
  progress?: UploadProgress;
  message?: string;
  preview?: PixelImage;
}

export interface RunnerDeps {
  renderFrame(miniapp: MiniApp, data: unknown, settings: Record<string, unknown>, quality: QualitySettings): Frame;
  wakeLock: WakeLockHandle;
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  client<T>(integrationId: string): Promise<T>;
}

export interface RunnerOptions {
  miniapp: MiniApp;
  settings: Record<string, unknown>;
  quality: QualitySettings;
  transport: UpdateTransport;
  /** Needed to restore mode 8 (countdown). */
  countdown?: CountdownParams;
  deps?: Partial<RunnerDeps>;
}

/** After a failed upload we retry sooner than the full min interval. */
const RETRY_AFTER_MS = 10_000;

const abortableSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });

export class ContinuousRunner {
  readonly status = new Store<RunnerStatus>({ state: 'idle', uploads: 0, errors: 0, hasPending: false });

  private readonly deps: RunnerDeps;
  private readonly abort = new AbortController();
  private miniRun: MiniAppRun<unknown> | undefined;
  private snapshot: ModeSnapshot | undefined;
  private loop: Promise<void> | undefined;
  private stopPromise: Promise<void> | undefined;
  private pending: { data: unknown; key: string } | undefined;
  private lastSentKey: string | undefined;
  private lastAttemptAt = -Infinity;
  /** Fast frames sent since the last full refresh (ghost clearing cadence). */
  private fastSinceClear = 0;
  /** True until the first frame of this run has been sent: palette bw starts with a full refresh. */
  private first = true;

  constructor(private readonly o: RunnerOptions) {
    this.deps = {
      renderFrame: defaultRenderFrame,
      wakeLock: createWakeLock(),
      now: () => Date.now(),
      sleep: abortableSleep,
      client: getReadyClient,
      ...o.deps,
    };
  }

  get running(): boolean {
    return !!this.loop && !this.stopPromise;
  }

  async start(): Promise<void> {
    if (this.loop) throw new Error('Đã chạy rồi');
    this.status.set({ state: 'starting', message: 'Đang chuẩn bị…', errors: 0, uploads: 0, lastError: undefined });
    try {
      await this.deps.wakeLock.acquire();
      this.snapshot = await this.o.transport.open();
      this.miniRun = await this.o.miniapp.start({
        settings: this.o.settings,
        signal: this.abort.signal,
        client: this.deps.client,
        log: (t) => addLog('info', `[${this.o.miniapp.id}] ${t}`),
      });
    } catch (e) {
      this.miniRun?.stop();
      await this.o.transport.dispose().catch(() => undefined);
      await this.deps.wakeLock.release();
      this.status.set({ state: 'error', message: undefined, lastError: errMsg(e) });
      throw e;
    }
    this.status.set({ state: 'running', message: undefined });
    this.loop = this.runLoop();
  }

  /**
   * Stops streaming, gives the display back to the firmware, then disconnects.
   * `immediate` (page hiding) does not wait for an in-flight upload.
   */
  stop(opts: { immediate?: boolean } = {}): Promise<void> {
    this.stopPromise ??= this.doStop(!!opts.immediate);
    return this.stopPromise;
  }

  private async doStop(immediate: boolean): Promise<void> {
    if (this.status.state.state === 'idle' || this.status.state.state === 'error') {
      this.abort.abort();
      return;
    }
    this.status.set({
      state: 'stopping',
      message: immediate ? 'Đang trả quyền hiển thị…' : 'Đang dừng, chờ màn làm mới xong rồi trả quyền hiển thị…',
    });
    this.abort.abort();
    if (!immediate) await this.loop;
    this.miniRun?.stop();
    let message: string;
    try {
      const r = await this.o.transport.restore(this.snapshot, this.o.countdown);
      message = r.message;
      if (!r.restored) this.status.set({ lastError: r.message });
    } catch (e) {
      message = `Không khôi phục được mode: ${errMsg(e)}`;
      this.status.set({ lastError: message });
    }
    await this.o.transport.dispose().catch(() => undefined);
    await this.deps.wakeLock.release();
    this.status.set({ state: 'stopped', message, hasPending: false, progress: undefined });
  }

  private async runLoop(): Promise<void> {
    const { signal } = this.abort;
    const { miniapp, settings, quality } = this.o;
    const pollMs = Math.max(1000, miniapp.pollIntervalMs(settings));
    const minMs = quality.minIntervalSec * 1000;

    while (!signal.aborted) {
      let waitMs = pollMs;
      try {
        const data = await (this.miniRun as MiniAppRun<unknown>).tick();
        if (data !== null && data !== undefined) {
          const key = miniapp.key(data);
          this.pending = key === this.lastSentKey ? undefined : { data, key };
        }
        if (this.status.state.lastError?.startsWith('Nguồn dữ liệu')) this.status.set({ lastError: undefined });
      } catch (e) {
        this.fail(`Nguồn dữ liệu: ${errMsg(e)}`);
      }
      if (signal.aborted) break;

      if (this.pending) {
        const remaining = this.lastAttemptAt + minMs - this.deps.now();
        if (remaining <= 0) await this.upload(this.pending, minMs);
        else waitMs = Math.min(pollMs, remaining);
      }
      this.status.set({
        hasPending: !!this.pending,
        nextAllowedAt: Number.isFinite(this.lastAttemptAt) ? this.lastAttemptAt + minMs : undefined,
      });
      if (signal.aborted) break;
      await this.deps.sleep(waitMs, signal);
    }
  }

  private async upload(p: { data: unknown; key: string }, minMs: number): Promise<void> {
    this.lastAttemptAt = this.deps.now();
    this.status.set({ state: 'uploading', progress: undefined });
    try {
      const frame = this.deps.renderFrame(this.o.miniapp, p.data, this.o.settings, this.o.quality);
      this.status.set({ preview: frame.preview });
      addLog('info', `Đã dựng khung ${this.status.state.uploads + 1} (${p.key})`);
      const { palette, ghostClearEvery } = this.o.quality;
      const choice = chooseMethod(palette, ghostClearEvery, this.fastSinceClear, this.first);
      if (choice.ghostClear) {
        addLog('info', this.first ? 'Full refresh trước khi bắt đầu chạy nhanh' : `Xoá ghost: full refresh sau ${this.fastSinceClear} khung nhanh`);
      }
      // A ghost-clearing full refresh sends the same image with an all "not red" red plane.
      const planes = choice.ghostClear ? withoutRed(frame.planes) : frame.planes;
      addLog('info', `Bắt đầu gửi khung ${this.status.state.uploads + 1} (${choice.method})`);
      const timings = await this.o.transport.send(planes, (progress) => this.status.set({ progress }), choice.method);
      if (timings) addLog('info', `Gửi xong khung ${this.status.state.uploads + 1}: chuẩn bị ${timings.prepareMs} + gửi ${timings.sendMs} + chờ ${timings.busyMs} ms`);
      else addLog('info', `Gửi xong khung ${this.status.state.uploads + 1}`);
      this.fastSinceClear = choice.method === 'fast' ? this.fastSinceClear + 1 : 0;
      this.first = false;
      this.lastSentKey = p.key;
      if (this.pending?.key === p.key) this.pending = undefined;
      this.status.set({
        uploads: this.status.state.uploads + 1,
        lastUpdateAt: this.deps.now(),
        lastKey: p.key,
        lastTimings: timings,
        lastError: undefined,
      });
    } catch (e) {
      this.fail(`Gửi ảnh thất bại: ${errMsg(e)}`);
      this.lastAttemptAt = this.deps.now() - minMs + RETRY_AFTER_MS;
    } finally {
      if (this.status.state.state === 'uploading') this.status.set({ state: 'running', progress: undefined });
    }
  }

  private fail(message: string): void {
    addLog('error', message);
    this.status.set({ errors: this.status.state.errors + 1, lastError: message });
  }
}

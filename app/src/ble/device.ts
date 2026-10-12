import { Emitter } from './emitter';
import * as P from './protocol';
import type { CountdownParams, CountdownState, EpdConfig, Notification, SleepSchedule } from './protocol';
import type { Planes } from '../render/pack';
import { buildRawSteps, fastLutOptions, type FastRefreshOptions } from '../diagnostics/fastRefresh';

// Panel busy-wait defaults, measured on the real 2.9" BWR panel (stopwatch, firmware untouched),
// each rounded up from measured x 1.25:
//  - normal flow (plane black + plane red + mode 3 + `05`): 15.3 s  -> 20 s
//  - raw OTP fast path (black plane, bypass red RAM, `03 22`=F7, `03 20`, then `06`): 8.1-8.7 s -> 11 s
//  - raw custom-LUT fast path (LUT `fast25` via `0x32`, `03 22`=C7): 1.4 s hand-timed -> 2 s
//    (ADR-10). Too short a wait would let `06` cut the update, so keep the margin.
export const BUSY_MS_BWR = 20_000;
export const BUSY_MS_BW_FAST = 2_000;

export interface LogEntry {
  t: number;
  dir: 'out' | 'in' | 'info' | 'error';
  text: string;
}

type DeviceEvents = {
  notify: { data: Uint8Array; message: Notification };
  log: LogEntry;
  disconnect: undefined;
};

export interface ModeSnapshot {
  mode: number | undefined;
  weekStart: number | undefined;
  config: EpdConfig | undefined;
}

export interface ConnectTimings {
  gattMs: number;
  setupMs: number;
  initMs: number;
  totalMs: number;
}

export interface UploadProgress {
  phase: 'prepare' | 'black' | 'red' | 'refresh' | 'busy' | 'done';
  /** 0..1 within the phase. */
  fraction: number;
}

export interface UploadOptions {
  onProgress?: (p: UploadProgress) => void;
  /** How long to wait for the full 3-colour refresh. Default {@link BUSY_MS_BWR}. */
  busyMs?: number;
  /** Delay between image chunks (ms). Default 8. */
  chunkDelayMs?: number;
  /** Disconnect right after REFRESH instead of waiting (benchmark experiment). */
  skipBusyWait?: boolean;
}

export interface FastUploadOptions extends Omit<UploadOptions, 'skipBusyWait'> {
  /** Busy wait before `06`. Default {@link BUSY_MS_BW_FAST}. */
  busyMs?: number;
  /** Raw refresh options. Default: custom LUT `fast25` + 0xC7, bypass red RAM, no border. */
  refresh?: FastRefreshOptions;
}

export interface UploadTimings {
  prepareMs: number;
  sendMs: number;
  busyMs: number;
  totalMs: number;
}

export interface RestoreResult {
  restored: boolean;
  message: string;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const now = () => performance.now();

interface Waiter {
  match: (m: Notification) => unknown;
  resolve: (v: never) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class EpdDevice extends Emitter<DeviceEvents> {
  version: number | undefined;
  config: EpdConfig | undefined;
  mtu: number | undefined;
  deviceTs: number | undefined;
  snapshot: ModeSnapshot | undefined;
  timings: ConnectTimings | undefined;
  /** Last mode we know the device is in (updated by our own commands). */
  mode: number | undefined;
  services: string[] = [];

  private characteristic: BluetoothRemoteGATTCharacteristic | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private waiters = new Set<Waiter>();
  private closed = false;

  constructor(readonly bluetooth: BluetoothDevice) {
    super();
  }

  get connected(): boolean {
    return !this.closed && !!this.bluetooth.gatt?.connected;
  }

  get chunkSize(): number {
    return P.chunkSizeForMtu(this.mtu ?? 244);
  }

  /** Connects, subscribes, runs INIT and waits for `mtu=`/`t=`. */
  async connect(opts: { initTimeoutMs?: number } = {}): Promise<ConnectTimings> {
    const t0 = now();
    const gatt = this.bluetooth.gatt;
    if (!gatt) throw new Error('Thiết bị không có GATT');
    this.bluetooth.addEventListener('gattserverdisconnected', this.onDisconnected);

    const server = gatt.connected ? gatt : await gatt.connect();
    const tGatt = now();
    this.info(`GATT đã kết nối (${Math.round(tGatt - t0)} ms)`);

    const service = await server.getPrimaryService(P.EPD_SERVICE);
    this.characteristic = await service.getCharacteristic(P.EPD_CHARACTERISTIC);
    try {
      const versionChar = await service.getCharacteristic(P.EPD_VERSION_CHARACTERISTIC);
      this.version = (await versionChar.readValue()).getUint8(0);
      this.info(`Phiên bản firmware: 0x${this.version.toString(16)}`);
    } catch (e) {
      this.log('error', `Không đọc được phiên bản: ${errMsg(e)}`);
    }
    try {
      this.services = (await server.getPrimaryServices()).map((s) => s.uuid);
    } catch {
      this.services = [P.EPD_SERVICE];
    }

    // Listener first: the firmware pushes its config as soon as notifications are enabled.
    this.characteristic.addEventListener('characteristicvaluechanged', this.onValue);
    await this.characteristic.startNotifications();
    const tNotify = now();
    await delay(150); // let the config packet arrive

    this.snapshot = {
      mode: this.config?.mode,
      weekStart: this.config?.weekStart,
      config: this.config,
    };
    this.mode = this.config?.mode;

    await this.runInit(opts.initTimeoutMs ?? 5000);
    const tInit = now();
    this.timings = {
      gattMs: Math.round(tGatt - t0),
      setupMs: Math.round(tNotify - tGatt),
      initMs: Math.round(tInit - tNotify),
      totalMs: Math.round(tInit - t0),
    };
    this.info(`Sẵn sàng sau ${this.timings.totalMs} ms (mtu=${this.mtu ?? '?'})`);
    return this.timings;
  }

  /** INIT resets the transfer guard; the firmware answers `mtu=N` then `t=<ts>`. */
  async runInit(timeoutMs = 5000): Promise<void> {
    await this.request(P.init(), isKind('time'), timeoutMs);
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    this.characteristic?.removeEventListener('characteristicvaluechanged', this.onValue);
    this.bluetooth.removeEventListener('gattserverdisconnected', this.onDisconnected);
    this.rejectWaiters(new Error('Đã ngắt kết nối'));
    if (this.bluetooth.gatt?.connected) this.bluetooth.gatt.disconnect();
    this.info('Đã ngắt kết nối');
  }

  // ------------------------------------------------------------ low level

  /** Serialized `writeValueWithResponse`. */
  write(packet: Uint8Array, quiet = false): Promise<void> {
    const job = this.queue.then(async () => {
      if (!this.characteristic || !this.connected) throw new Error('Chưa kết nối thiết bị');
      if (!quiet) this.log('out', P.toHex(packet));
      await this.characteristic.writeValueWithResponse(packet as BufferSource);
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  /** Waits for a notification matching `match`; the waiter is registered before the packet is sent. */
  async request<T extends Notification>(
    packet: Uint8Array,
    match: (m: Notification) => m is T,
    timeoutMs: number,
  ): Promise<T> {
    const reply = this.expect(match, timeoutMs) as Promise<T>;
    reply.catch(() => undefined); // avoid unhandled rejection when write fails first
    try {
      await this.write(packet);
    } catch (e) {
      this.cancelLatestWaiter();
      throw e;
    }
    return reply;
  }

  private expect(match: (m: Notification) => unknown, timeoutMs: number): Promise<Notification> {
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        match,
        resolve: resolve as (v: never) => void,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error('Thiết bị không phản hồi (hết thời gian chờ)'));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  private cancelLatestWaiter(): void {
    const last = Array.from(this.waiters).pop();
    if (!last) return;
    clearTimeout(last.timer);
    this.waiters.delete(last);
  }

  private rejectWaiters(error: Error): void {
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(error);
    }
    this.waiters.clear();
  }

  private onValue = (event: Event): void => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;
    const data = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    const message = P.classifyNotification(data);
    this.log('in', `${P.toHex(data)}  (${describe(message)})`);
    if (message.kind === 'config') this.config = message.config;
    else if (message.kind === 'mtu') this.mtu = message.mtu;
    else if (message.kind === 'time') this.deviceTs = message.ts;
    this.emit('notify', { data, message });
    for (const w of Array.from(this.waiters)) {
      if (w.match(message)) {
        clearTimeout(w.timer);
        this.waiters.delete(w);
        w.resolve(message as never);
      }
    }
  };

  private onDisconnected = (): void => {
    this.info('Mất kết nối GATT');
    this.rejectWaiters(new Error('Thiết bị đã ngắt kết nối'));
    this.emit('disconnect', undefined);
  };

  private log(dir: LogEntry['dir'], text: string): void {
    this.emit('log', { t: Date.now(), dir, text });
  }
  private info(text: string): void {
    this.log('info', text);
  }

  // ------------------------------------------------------------ commands

  async setMode(mode: number): Promise<void> {
    const ts = Math.floor(Date.now() / 1000);
    await this.write(P.setTime(ts, localTzHours(), mode));
    this.mode = mode & 0x7f;
  }

  async setWeekStart(value: 0 | 1): Promise<void> {
    await this.write(P.weekStart(value));
  }

  queryCountdown(timeoutMs = 3500): Promise<CountdownState> {
    return this.request(P.countdownQuery(), isKind('countdown'), timeoutMs).then((m) => m.state);
  }

  queryCountdownCaps(timeoutMs = 1800): Promise<number> {
    return this.request(P.countdownCaps(), isKind('countdownCaps'), timeoutMs).then((m) => m.maxLabel);
  }

  querySleep(timeoutMs = 3000): Promise<{ schedule: SleepSchedule; active: number | null; state: number }> {
    return this.request(P.sleepQuery(), isKind('sleep'), timeoutMs);
  }

  /** Mirrors the reference flow: probe D6, check label caps, send, poll while the device is saving. */
  async setCountdown(params: CountdownParams): Promise<CountdownState> {
    await this.queryCountdown();
    let maxLabel = 8;
    if (params.label.length > 8) {
      try {
        maxLabel = await this.queryCountdownCaps();
      } catch {
        throw new Error('Firmware chỉ hỗ trợ tên sự kiện tối đa 8 ký tự');
      }
    }
    const label = P.sanitizeLabel(params.label, maxLabel);
    const packet = P.countdownSet(
      { ...params, label, ts: Math.floor(Date.now() / 1000), tz: localTzHours() },
      maxLabel,
    );
    let reply = (await this.request(packet, isKind('countdown'), 3500)).state;
    assertCountdownOk(reply);
    const deadline = Date.now() + 20000;
    while (reply.status === 1 && Date.now() < deadline) {
      await delay(600);
      reply = await this.queryCountdown();
      assertCountdownOk(reply);
    }
    const same = reply.year === params.year && reply.month === params.month &&
      reply.day === params.day && reply.label === label;
    if (reply.status !== 0 || !same) throw new Error('Chưa xác nhận được cấu hình đã lưu; thử lại');
    this.mode = P.Mode.COUNTDOWN;
    return reply;
  }

  async stopCountdown(): Promise<void> {
    await this.queryCountdown();
    await this.request(P.countdownStop(), isKind('countdownStop'), 3500);
    this.mode = P.Mode.CLOCK_1;
  }

  /**
   * Full picture sequence from the reference tool:
   * mode 0 -> INIT (wait t=) -> black plane -> red plane -> mode 3 -> REFRESH -> wait for the panel.
   */
  async uploadImage(planes: Planes, opts: UploadOptions = {}): Promise<UploadTimings> {
    const progress = opts.onProgress ?? (() => undefined);
    const chunkDelay = opts.chunkDelayMs ?? 8;
    const t0 = now();

    progress({ phase: 'prepare', fraction: 0 });
    await this.setMode(P.Mode.PICTURE);
    await delay(150);
    await this.runInit();
    const tPrepared = now();
    progress({ phase: 'prepare', fraction: 1 });

    for (const plane of ['black', 'red'] as const) {
      const packets = P.writeImageChunks(plane, planes[plane], this.chunkSize);
      for (let i = 0; i < packets.length; i++) {
        await this.write(packets[i] as Uint8Array, i !== 0 && i !== packets.length - 1);
        progress({ phase: plane, fraction: (i + 1) / packets.length });
        await delay(chunkDelay);
      }
      this.info(`Đã gửi lớp ${plane}: ${packets.length} gói`);
    }
    const tSent = now();

    // An unflagged mode command clears the clock-image guard; REFRESH then persists picture mode.
    await this.setMode(3);
    progress({ phase: 'refresh', fraction: 0 });
    await this.write(P.refresh());
    this.mode = P.Mode.PICTURE;

    const tBusy0 = now();
    await this.waitBusy(opts.skipBusyWait ? 0 : opts.busyMs ?? BUSY_MS_BWR, progress);
    const t1 = now();
    progress({ phase: 'done', fraction: 1 });
    return {
      prepareMs: Math.round(tPrepared - t0),
      sendMs: Math.round(tSent - tPrepared),
      busyMs: Math.round(t1 - tBusy0),
      totalMs: Math.round(t1 - t0),
    };
  }

  private async waitBusy(busyTotal: number, progress: (p: UploadProgress) => void): Promise<void> {
    for (let waited = 0; waited < busyTotal; waited += 500) {
      progress({ phase: 'busy', fraction: waited / busyTotal });
      await delay(Math.min(500, busyTotal - waited));
    }
  }

  /**
   * Black/white fast path (no red plane): mode 0 -> INIT -> black plane -> `03 21`/`04 40 00` (bypass red RAM)
   * -> `03 22`/`04 F7` -> `03 20` -> wait -> `06` (controller sleep). Never touches LUT/voltage registers.
   * Repeated use accumulates ghosting; clear it with a normal {@link uploadImage} now and then.
   */
  async uploadBlackFast(black: Uint8Array, opts: FastUploadOptions = {}): Promise<UploadTimings> {
    const progress = opts.onProgress ?? (() => undefined);
    const t0 = now();
    try {
      const sent = await this.uploadBlackPlane(black, { onProgress: progress, chunkDelayMs: opts.chunkDelayMs });
      progress({ phase: 'refresh', fraction: 0 });
      for (const step of buildRawSteps(opts.refresh ?? fastLutOptions(), this.mtu ?? 244)) {
        for (const packet of step.packets) await this.write(packet);
      }
      this.mode = P.Mode.PICTURE;
      const tBusy0 = now();
      await this.waitBusy(opts.busyMs ?? BUSY_MS_BW_FAST, progress);
      const t1 = now();
      await this.epdSleep();
      progress({ phase: 'done', fraction: 1 });
      return {
        prepareMs: sent.prepareMs,
        sendMs: sent.sendMs,
        busyMs: Math.round(t1 - tBusy0),
        totalMs: Math.round(now() - t0),
      };
    } catch (e) {
      // Never leave the controller powered after a failed/aborted sequence.
      await this.epdSleep().catch(() => undefined);
      throw e;
    }
  }

  /**
   * Raw controller register write through the firmware passthrough: `03 cmd`, then `04 data`
   * split to mtu-1 bytes. The caller is responsible for only sending vetted registers.
   */
  async rawCommand(cmd: number, data?: Uint8Array): Promise<void> {
    for (const packet of P.rawRegisterPackets(cmd, data, this.mtu ?? 244)) await this.write(packet);
  }

  /** Firmware opcode 06: put the display controller into deep sleep. */
  async epdSleep(): Promise<void> {
    await this.write(P.epdSleep());
  }

  /**
   * Black plane only, through the normal WRITE_IMAGE path: mode 0 -> INIT (wait t=) -> plane.
   * No red plane, no mode 3, no REFRESH: the caller triggers the update itself.
   */
  async uploadBlackPlane(
    black: Uint8Array,
    opts: Pick<UploadOptions, 'onProgress' | 'chunkDelayMs'> = {},
  ): Promise<{ prepareMs: number; sendMs: number }> {
    const progress = opts.onProgress ?? (() => undefined);
    const chunkDelay = opts.chunkDelayMs ?? 8;
    const t0 = now();
    progress({ phase: 'prepare', fraction: 0 });
    await this.setMode(P.Mode.PICTURE);
    await delay(150);
    await this.runInit();
    const tPrepared = now();
    progress({ phase: 'prepare', fraction: 1 });
    const packets = P.writeImageChunks('black', black, this.chunkSize);
    for (let i = 0; i < packets.length; i++) {
      await this.write(packets[i] as Uint8Array, i !== 0 && i !== packets.length - 1);
      progress({ phase: 'black', fraction: (i + 1) / packets.length });
      await delay(chunkDelay);
    }
    this.info(`Đã gửi lớp black: ${packets.length} gói`);
    return { prepareMs: Math.round(tPrepared - t0), sendMs: Math.round(now() - tPrepared) };
  }

  /**
   * Gives display control back to the firmware. Mode 8 needs the countdown
   * parameters (the device cannot report them back reliably), otherwise the caller must ask the user.
   */
  async restoreMode(snapshot: ModeSnapshot | undefined, countdown?: CountdownParams): Promise<RestoreResult> {
    let reason: string;
    try {
      const r = await this.restoreOriginalMode(snapshot, countdown);
      if (r.restored) return r;
      reason = r.message;
    } catch (e) {
      reason = `Gửi lại mode ban đầu thất bại: ${errMsg(e)}.`;
    }
    // The original app cannot be given back: leave the panel on the calendar app instead of the picture mode.
    try {
      await this.setMode(P.Mode.CALENDAR);
      return { restored: true, message: `${reason} Đã chuyển sang app lịch.` };
    } catch (e) {
      return { restored: false, message: `${reason} Chuyển sang app lịch cũng thất bại: ${errMsg(e)}` };
    }
  }

  private async restoreOriginalMode(snapshot: ModeSnapshot | undefined, countdown?: CountdownParams): Promise<RestoreResult> {
    const mode = snapshot?.mode;
    if (snapshot === undefined || mode === undefined) return { restored: false, message: 'Không có snapshot mode ban đầu.' };
    if (mode === P.Mode.COUNTDOWN) {
      if (!countdown) {
        return { restored: false, message: 'Mode ban đầu là đếm ngược nhưng chưa lưu ngày/nhãn.' };
      }
      await this.setCountdown(countdown);
      return { restored: true, message: 'Đã gửi lại đếm ngược' };
    }
    await this.setMode(mode);
    if (snapshot.weekStart === 0 || snapshot.weekStart === 1) await this.setWeekStart(snapshot.weekStart);
    return { restored: true, message: `Đã gửi lại mode ${mode}` };
  }
}

const isKind =
  <K extends Notification['kind']>(kind: K) =>
  (m: Notification): m is Extract<Notification, { kind: K }> => m.kind === kind;

function assertCountdownOk(s: CountdownState): void {
  const errors: Record<number, string> = {
    2: 'Thiết bị chưa lưu được cấu hình. Chờ vài giây rồi thử lại.',
    3: 'Ngày hoặc tên sự kiện không hợp lệ.',
    4: 'Thiết bị đang bận ghi cấu hình hoặc nhận ảnh.',
  };
  const message = errors[s.status];
  if (message) throw new Error(message);
}

export const localTzHours = (): number => Math.round(-new Date().getTimezoneOffset() / 60);

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function describe(m: Notification): string {
  switch (m.kind) {
    case 'text': return m.text;
    case 'time': return `t=${m.ts}`;
    case 'mtu': return `mtu=${m.mtu}`;
    default: return m.kind;
  }
}

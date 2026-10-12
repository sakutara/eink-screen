// Pure encoders/decoders for the NRF_EPD (fork of tsl0922/EPD-nRF5) GATT protocol.
// No Bluetooth or DOM access here so everything is unit-testable.

export const EPD_SERVICE = '62750001-d828-918d-fb46-b6c11c675aec';
export const EPD_CHARACTERISTIC = '62750002-d828-918d-fb46-b6c11c675aec';
export const EPD_VERSION_CHARACTERISTIC = '62750003-d828-918d-fb46-b6c11c675aec';
/** Buttonless Secure DFU service (16-bit 0xFE59); only requested so it is accessible, never used. */
export const DFU_SERVICE = 0xfe59;

export const Op = {
  INIT: 0x01,
  SEND_COMMAND: 0x03,
  SEND_DATA: 0x04,
  REFRESH: 0x05,
  /** Puts the display controller into deep sleep (not the 0xFB sleep schedule). */
  EPD_SLEEP: 0x06,
  SET_TIME: 0x20,
  WEEK_START: 0x21,
  WRITE_IMAGE: 0x30,
  COUNTDOWN: 0xd6,
  COUNTDOWN_STOP: 0xd7,
  COUNTDOWN_CAPS: 0xd8,
  SLEEP: 0xfb,
} as const;

/** Values for the `mode` byte of SET_TIME. */
export const Mode = {
  PICTURE: 0,
  CALENDAR: 1,
  CLOCK_1: 2,
  CLOCK_2: 3,
  COUNTDOWN: 8,
} as const;

export const PANEL = { width: 296, height: 128 } as const;

export type ImagePlane = 'black' | 'red';

const u32be = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

export const init = (): Uint8Array => Uint8Array.of(Op.INIT);
export const refresh = (): Uint8Array => Uint8Array.of(Op.REFRESH);
export const rawCommand = (reg: number, ...args: number[]): Uint8Array => Uint8Array.of(Op.SEND_COMMAND, reg, ...args);
export const rawData = (...data: number[]): Uint8Array => Uint8Array.of(Op.SEND_DATA, ...data);
export const epdSleep = (): Uint8Array => Uint8Array.of(Op.EPD_SLEEP);

/** Max `04` payload for a given mtu: the packet (opcode + data) must fit in `mtu` bytes. */
export const rawDataSize = (mtu: number): number => Math.max(1, mtu - 1);

/** `03 cmd` followed by `04 data` split into mtu-1 byte pieces (no `04` packet when data is empty). */
export function rawRegisterPackets(cmd: number, data: Uint8Array | undefined, mtu: number): Uint8Array[] {
  const packets = [rawCommand(cmd)];
  const size = rawDataSize(mtu);
  for (let offset = 0; data && offset < data.length; offset += size) {
    packets.push(rawData(...data.subarray(offset, offset + size)));
  }
  return packets;
}

/** SET_TIME: `20 ts(u32 BE, UTC) tz(int8 hours) mode`. */
export function setTime(ts: number, tzHours: number, mode: number): Uint8Array {
  return Uint8Array.of(Op.SET_TIME, ...u32be(ts), tzHours & 0xff, mode);
}

/** Week start: 0 = Sunday, 1 = Monday. */
export const weekStart = (value: 0 | 1): Uint8Array => Uint8Array.of(Op.WEEK_START, value);

/** The firmware only renders ASCII: strip diacritics, drop everything outside printable ASCII. */
export function sanitizeLabel(label: string, maxLength = 16): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7e]/g, '')
    .trimEnd()
    .slice(0, maxLength);
}

export interface CountdownParams {
  year: number;
  month: number;
  day: number;
  label: string;
}

export interface CountdownSetInput extends CountdownParams {
  /** Current UTC seconds, synced to the device together with the target. */
  ts: number;
  tz: number;
  /** Visual style byte; the reference tool always sends 0. */
  style?: number;
}

/** `D6 style YL YH MM DD LEN ascii[LEN] ts[4] tz`. */
export function countdownSet(input: CountdownSetInput, maxLabelLength = 16): Uint8Array {
  const { year, month, day, ts, tz, style = 0 } = input;
  if (year < 2000 || year > 2099) throw new RangeError('Năm phải trong khoảng 2000–2099');
  if (month < 1 || month > 12 || day < 1 || day > 31) throw new RangeError('Ngày hoặc tháng không hợp lệ');
  const label = sanitizeLabel(input.label, maxLabelLength);
  const ascii = Array.from(label, (c) => c.charCodeAt(0));
  return Uint8Array.of(
    Op.COUNTDOWN, style, year & 0xff, (year >> 8) & 0xff, month, day, ascii.length, ...ascii, ...u32be(ts), tz & 0xff,
  );
}

export const countdownQuery = (): Uint8Array => Uint8Array.of(Op.COUNTDOWN, 0xff);
export const countdownStop = (): Uint8Array => Uint8Array.of(Op.COUNTDOWN_STOP);
export const countdownCaps = (): Uint8Array => Uint8Array.of(Op.COUNTDOWN_CAPS, 0xff);

export const sleepQuery = (): Uint8Array => Uint8Array.of(Op.SLEEP, 0xff);

export interface SleepSchedule {
  enabled: boolean;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

export function sleepSet(s: SleepSchedule): Uint8Array {
  return Uint8Array.of(Op.SLEEP, s.enabled ? 1 : 0, s.startHour, s.startMinute, s.endHour, s.endMinute);
}

/**
 * Splits one plane into WRITE_IMAGE packets `30 flag data[chunkSize]`.
 * Black plane: flag 0x0F first, 0xFF afterwards. Red plane: 0x00 first, 0xF0 afterwards.
 * `chunkSize` is the payload size (mtu - 2).
 */
export function writeImageChunks(plane: ImagePlane, bytes: Uint8Array, chunkSize: number): Uint8Array[] {
  if (chunkSize < 1) throw new RangeError('chunkSize phải >= 1');
  const planeBits = plane === 'black' ? 0x0f : 0x00;
  const packets: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    const flag = (offset === 0 ? 0x00 : 0xf0) | planeBits;
    const packet = new Uint8Array(chunk.length + 2);
    packet[0] = Op.WRITE_IMAGE;
    packet[1] = flag;
    packet.set(chunk, 2);
    packets.push(packet);
  }
  return packets;
}

/** Image payload size for a given `mtu=N` reply (same clamp as the reference tool). */
export const chunkSizeForMtu = (mtu: number): number => Math.max(18, Math.min(244, mtu - 2));

// ---------------------------------------------------------------- decoders

export interface EpdConfig {
  /** Pins in firmware order: mosi, sclk, cs, dc, rst, busy, bs. */
  pins: { mosi: number; sclk: number; cs: number; dc: number; rst: number; busy: number; bs: number };
  model: number;
  wakeup: number;
  led: number;
  en: number;
  /** Current display mode (see {@link Mode}); absent on legacy firmware. */
  mode?: number;
  weekStart?: number;
  /** 0x21 marks the 2.13" panel profile on model 2. */
  panelProfile?: number;
  raw: Uint8Array;
}

const CONFIG_MODELS = [1, 2, 3, 4, 5, 7];

export function isConfigPacket(d: Uint8Array): boolean {
  return d.length >= 8 && d.length <= 64 && CONFIG_MODELS.includes(d[7] ?? -1);
}

export function decodeConfig(d: Uint8Array): EpdConfig | null {
  if (!isConfigPacket(d)) return null;
  const at = (i: number) => d[i] as number;
  const config: EpdConfig = {
    pins: { mosi: at(0), sclk: at(1), cs: at(2), dc: at(3), rst: at(4), busy: at(5), bs: at(6) },
    model: at(7),
    wakeup: d.length > 8 ? at(8) : 0xff,
    led: d.length > 9 ? at(9) : 0xff,
    en: d.length > 10 ? at(10) : 0xff,
    raw: d,
  };
  if (d.length > 11) config.mode = at(11);
  if (d.length > 12) config.weekStart = at(12);
  if (config.model === 2 && d.length > 13 && at(13) === 0x21) config.panelProfile = 0x21;
  return config;
}

export interface CountdownState {
  /** 0 ok, 1 saving, 2 save failed, 3 invalid, 4 busy. */
  status: number;
  year: number;
  month: number;
  day: number;
  label: string;
}

export type Notification =
  | { kind: 'countdown'; state: CountdownState }
  | { kind: 'countdownStop' }
  | { kind: 'countdownCaps'; maxLabel: number }
  | { kind: 'weekStart'; state: number; weekStart: number }
  | { kind: 'sleep'; state: number; schedule: SleepSchedule; active: number | null }
  | { kind: 'mtu'; mtu: number }
  | { kind: 'time'; ts: number }
  | { kind: 'config'; config: EpdConfig }
  | { kind: 'text'; text: string }
  | { kind: 'unknown'; raw: Uint8Array };

const asciiText = (d: Uint8Array) => new TextDecoder().decode(d);

/** Same discrimination order and checks as the reference tool's notification handler. */
export function classifyNotification(d: Uint8Array): Notification {
  const b = (i: number) => d[i] as number;

  if (d.length >= 8 && b(0) === Op.COUNTDOWN && b(1) <= 5 && b(2) === 0 && b(7) <= 16 && d.length === 8 + b(7)) {
    return {
      kind: 'countdown',
      state: {
        status: b(1),
        year: b(3) | (b(4) << 8),
        month: b(5),
        day: b(6),
        label: asciiText(d.subarray(8)),
      },
    };
  }
  if (d.length === 2 && b(0) === Op.COUNTDOWN_STOP && b(1) === 0) return { kind: 'countdownStop' };
  if (d.length === 3 && b(0) === Op.COUNTDOWN_CAPS && b(1) === 0 && b(2) >= 8 && b(2) <= 16) {
    return { kind: 'countdownCaps', maxLabel: b(2) };
  }
  if (d.length === 3 && b(0) === Op.WEEK_START && b(1) <= 2 && b(2) <= 1) {
    return { kind: 'weekStart', state: b(1), weekStart: b(2) };
  }
  if (
    (d.length === 7 || d.length === 8) && b(0) === Op.SLEEP &&
    b(1) <= 2 && b(2) <= 1 && b(3) < 24 && b(4) < 60 && b(5) < 24 && b(6) < 60
  ) {
    return {
      kind: 'sleep',
      state: b(1),
      schedule: { enabled: b(2) === 1, startHour: b(3), startMinute: b(4), endHour: b(5), endMinute: b(6) },
      active: d.length === 8 ? b(7) : null,
    };
  }

  const text = asciiText(d);
  const time = /^t=(\d+)\s*$/.exec(text);
  if (time) return { kind: 'time', ts: Number(time[1]) };
  if (text.startsWith('mtu=')) {
    const mtu = parseInt(text.slice(4), 10);
    if (Number.isFinite(mtu) && mtu > 2) return { kind: 'mtu', mtu };
  }

  const config = decodeConfig(d);
  if (config) return { kind: 'config', config };
  if (/^[\x20-\x7e\r\n]+$/.test(text)) return { kind: 'text', text: text.trim() };
  return { kind: 'unknown', raw: d };
}

export const toHex = (d: Uint8Array): string =>
  Array.from(d, (x) => x.toString(16).padStart(2, '0')).join(' ');

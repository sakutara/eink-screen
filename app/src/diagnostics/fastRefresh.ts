// Pure builders for the "fast B/W refresh" experiment. No Bluetooth or DOM access.
//
// Only a whitelist of standard SSD1680 registers/values is ever produced:
//   0x21 Display Update Control 1, 0x3C Border Waveform, 0x22 Display Update Control 2,
//   0x20 Master Activation, and (ADR-10) 0x32 Write LUT Register with one of the
//   fixed LUTs built below. The RAM write goes through the firmware's WRITE_IMAGE (0x30),
//   never through raw 03/04. Voltage registers (0x03 gate, 0x04 source, 0x2C VCOM, 0x3F EOPT)
//   are never written, so the LUT can only select among the voltages the OTP already holds.

import * as P from '../ble/protocol';

/** Display Update Control 2 values the experiment may send (SSD1680 datasheet). */
export const UPDATE_VALUES = [0xf7, 0xc7, 0xfc, 0xff] as const;
export type UpdateValue = (typeof UPDATE_VALUES)[number];

/** Raw registers (command bytes) the experiment is allowed to send via `03`. */
export const ALLOWED_REGISTERS = [0x21, 0x3c, 0x32, 0x22, 0x20] as const;

/** Display Update Control 2 used with a custom LUT: enable clock+analog, mode 1, no OTP LUT/temperature load. */
export const LUT_UPDATE_VALUE = 0xc7;

/** Bytes written by `0x32`: VS 5x12 + TP/SR/RP 12x7 + frame rate/XON 9. */
export const LUT_BYTES = 153;
/** Upper bound of frames per phase so a typo cannot hold the panel under DC drive for long. */
export const LUT_MAX_FRAMES = 0x40;

export type LutId = 'fast50' | 'fast25' | 'fast15' | 'fast8';

/** Single-phase B/W LUTs derived from the public Waveshare 2.9" V2 `WF_FULL` (about 1.0 s at 25+25 frames). */
export const LUT_PRESETS: Record<LutId, { label: string; frames: number }> = {
  fast50: { label: 'fast50 · gấp đôi tham chiếu, ~2,0 s (thử độ rõ)', frames: 0x32 },
  fast25: { label: 'fast25 · tham chiếu Waveshare WF_FULL, ~1,0 s', frames: 0x19 },
  fast15: { label: 'fast15 · rút ngắn còn ~0,6 s', frames: 0x0f },
  fast8: { label: 'fast8 · ~0,3 s (dễ nhạt/ghost)', frames: 0x08 },
};

export const isLutId = (v: unknown): v is LutId => typeof v === 'string' && v in LUT_PRESETS;

/**
 * One-group B/W LUT. Rows L0/L2 and L1/L3 are identical, so the result depends only on the new BW bit
 * and not on the (stale) RED/old RAM. Phase A and B each last `frames` frames:
 *   L0/L2 = 0x90 (VSL then VSH1), L1/L3 = 0x60 (VSH1 then VSL), L4 (VCOM) = 0.
 * Frame rate / XON bytes are those of the reference LUT. Bytes 153.. (EOPT, gate, source, VCOM) are not part of it.
 */
export function buildLut(frames: number): Uint8Array {
  if (!Number.isInteger(frames) || frames < 1 || frames > LUT_MAX_FRAMES) {
    throw new RangeError(`Số frame mỗi pha phải trong khoảng 1..${LUT_MAX_FRAMES}`);
  }
  const lut = new Uint8Array(LUT_BYTES);
  lut[0] = 0x90;
  lut[12] = 0x60;
  lut[24] = 0x90;
  lut[36] = 0x60;
  // Group 0 timing: TP[A] TP[B] TP[C] TP[D] SR[AB] SR[CD] RP
  lut[60] = frames;
  lut[61] = frames;
  // FR/XON
  lut.set([0x24, 0x42, 0x22, 0x22, 0x23, 0x32, 0x00, 0x00, 0x00], 144);
  return lut;
}

export const UPDATE_INFO: Record<UpdateValue, string> = {
  0xf7: 'F7 · chuẩn: nạp nhiệt độ + LUT OTP, hiển thị, tắt analog/clock (đối chứng)',
  0xc7: 'C7 · như F7 nhưng không nạp lại nhiệt độ/LUT',
  0xfc: 'FC · nạp nhiệt độ + LUT, hiển thị, KHÔNG tắt analog/clock (cần ngủ sau đó)',
  0xff: 'FF · nạp nhiệt độ + LUT, display mode 2, tắt analog/clock',
};

export interface FastRefreshOptions {
  updateValue: number;
  /** `03 21` + `04 40 00`: treat RED RAM as 0 so a B/W update ignores stale red data. */
  bypassRed: boolean;
  /** `03 3C` + `04 05`: border waveform. */
  border: boolean;
  /** Write this fixed LUT via `0x32` and refresh with `LUT_UPDATE_VALUE` (ignores `updateValue`). */
  lut?: LutId;
}

export interface RawStep {
  label: string;
  cmd: number;
  data: Uint8Array | undefined;
  /** Exact `03`/`04` packets for this register write. */
  packets: Uint8Array[];
  /** True for the `03 20` master activation: t_trigger is taken when it is acknowledged. */
  trigger: boolean;
}

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');

export const isAllowedUpdateValue = (v: number): v is UpdateValue =>
  (UPDATE_VALUES as readonly number[]).includes(v);

export function defaultOptions(): FastRefreshOptions {
  return { updateValue: 0xf7, bypassRed: true, border: false };
}

/** Production fast path (ADR-10): custom B/W LUT `fast25`, ~1.0 s waveform. */
export function fastLutOptions(): FastRefreshOptions {
  return { updateValue: LUT_UPDATE_VALUE, bypassRed: true, border: false, lut: 'fast25' };
}

/** Raw register steps that replace `05 REFRESH`, in send order. Throws for non-whitelisted values. */
export function buildRawSteps(opts: FastRefreshOptions, mtu: number): RawStep[] {
  if (opts.lut !== undefined && !isLutId(opts.lut)) throw new RangeError(`LUT "${String(opts.lut)}" không nằm trong danh sách cho phép`);
  if (!isAllowedUpdateValue(opts.updateValue)) {
    throw new RangeError(`Giá trị cập nhật 0x${hex2(opts.updateValue)} không nằm trong danh sách cho phép`);
  }
  const updateValue = opts.lut ? LUT_UPDATE_VALUE : opts.updateValue;
  const step = (label: string, cmd: number, data?: number[], trigger = false): RawStep => {
    const bytes = data ? Uint8Array.from(data) : undefined;
    return { label, cmd, data: bytes, packets: P.rawRegisterPackets(cmd, bytes, mtu), trigger };
  };
  const steps: RawStep[] = [];
  if (opts.bypassRed) steps.push(step('Display Update Control 1: bỏ qua RAM đỏ (coi như 0)', 0x21, [0x40, 0x00]));
  if (opts.border) steps.push(step('Border waveform', 0x3c, [0x05]));
  if (opts.lut) {
    const { frames } = LUT_PRESETS[opts.lut];
    steps.push(step(`Write LUT ${opts.lut} (${LUT_BYTES} byte, ${frames}+${frames} frame)`, 0x32, Array.from(buildLut(frames))));
  }
  steps.push(step(`Display Update Control 2 = 0x${hex2(updateValue)}`, 0x22, [updateValue]));
  steps.push(step('Master Activation (bắt đầu cập nhật)', 0x20, undefined, true));
  return steps;
}

export interface PlanLine {
  label: string;
  hex: string;
}

const summariseHex = (p: Uint8Array) =>
  p.length > 24 ? `${P.toHex(p.subarray(0, 8))} … (${p.length - 1} byte dữ liệu)` : P.toHex(p);

/** Human-readable packet list shown in the confirm dialog (WRITE_IMAGE bytes summarised). */
export function describePlan(opts: FastRefreshOptions, mtu: number, blackPacketCount: number, chunkSize: number): PlanLine[] {
  const lines: PlanLine[] = [
    { label: 'Chuyển mode 0 (ảnh)', hex: '20 <ts:4> <tz> 00' },
    { label: 'INIT, chờ t=', hex: P.toHex(P.init()) },
    {
      label: `WRITE_IMG lớp đen (${blackPacketCount} gói, tối đa ${chunkSize} byte/gói)`,
      hex: `30 0f <...>` + (blackPacketCount > 1 ? ` · 30 ff <...> ×${blackPacketCount - 1}` : ''),
    },
  ];
  for (const s of buildRawSteps(opts, mtu)) {
    s.packets.forEach((p, i) => lines.push({ label: i === 0 ? s.label : '  dữ liệu', hex: summariseHex(p) }));
  }
  lines.push({ label: 'Ngủ sâu bộ điều khiển (sau khi bạn xác nhận)', hex: P.toHex(P.epdSleep()) });
  return lines;
}

// ------------------------------------------------------------------ results

export type Ghost = 'none' | 'light' | 'heavy';
export const GHOST_LABEL: Record<Ghost, string> = { none: 'không', light: 'nhẹ', heavy: 'nặng' };

export interface RunResult {
  id: number;
  image: string;
  updateValue: number;
  bypassRed: boolean;
  border: boolean;
  /** Stopwatch reading in ms between the 0x20 acknowledgement and the user's button press. */
  durationMs: number;
  /** 1 (nhạt) .. 5 (đậm). */
  density: number;
  ghost: Ghost;
  note: string;
  /** Custom LUT preset used (raw refresh only). */
  lut?: LutId;
  /** Set for baseline rows of the normal `05` refresh (no raw registers); shown instead of 0x22/đỏ/border. */
  baseline?: string;
}

export const BASELINE_FULL = 'chuẩn 05 (đỏ+đen)';
export const BASELINE_BLACK = 'chuẩn 05, chỉ plane đen';

/** Suggested busyMs in seconds: ceil(slowest baseline * 1.25 / 1000). Undefined without baseline rows. */
export function suggestBusySeconds(results: RunResult[]): number | undefined {
  const ms = results.filter((r) => r.baseline && r.durationMs > 0).map((r) => r.durationMs);
  if (ms.length === 0) return undefined;
  return Math.ceil((Math.max(...ms) * 1.25) / 1000);
}

/** Value shown in the 0x22 column: `0xC7 + LUT fast25` for custom-LUT runs. */
export const updateLabel = (r: Pick<RunResult, 'updateValue' | 'lut'>): string =>
  r.lut ? `0x${hex2(LUT_UPDATE_VALUE)} + LUT ${r.lut}` : `0x${hex2(r.updateValue)}`;

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function resultsToMarkdown(results: RunResult[], meta: Record<string, string | number> = {}): string {
  const metaLines = Object.entries(meta).map(([k, v]) => `- ${k}: ${v}`);
  const rows = results.map((r) =>
    `| ${r.id} | ${cell(r.image)} | ${r.baseline ? cell(r.baseline) : updateLabel(r)} | ${r.baseline ? '-' : r.bypassRed ? 'có' : 'không'} | ${r.baseline ? '-' : r.border ? 'có' : 'không'} | ${(r.durationMs / 1000).toFixed(1)} | ${r.density} | ${GHOST_LABEL[r.ghost]} | ${cell(r.note)} |`);
  const suggested = suggestBusySeconds(results);
  return [
    '### Thử nghiệm refresh đen trắng nhanh',
    ...metaLines,
    ...(suggested !== undefined ? [`- busyMs gợi ý: ${suggested} s (baseline chậm nhất × 1.25)`] : []),
    '',
    '| # | Ảnh | Giá trị 0x22 | Bỏ qua đỏ | Border | Thời gian (s) | Độ đậm (1-5) | Ghost | Ghi chú |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

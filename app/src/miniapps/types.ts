import type { DitherAlgorithm, PaletteName } from '../render/dither';
import type { Ctx2D } from '../render/canvas';
import type { FieldSpec, Values } from '../integrations/types';

export type LayoutName = 'full' | 'clockImage';

/** Quality settings shared by all miniapps; applied by the runner, not by the miniapp. */
export interface QualitySettings {
  palette: PaletteName;
  algorithm: DitherAlgorithm;
  contrast: number;
  /** Minimum seconds between two panel updates (default follows the palette, see quality.ts). */
  minIntervalSec: number;
  /** Palette 'bw' only: every N-th frame is a normal full refresh that clears ghosting. 0 = off. */
  ghostClearEvery: number;
  layout: LayoutName;
}

export interface RenderArea {
  width: number;
  height: number;
  palette: PaletteName;
}

export interface MiniAppContext<S> {
  settings: S;
  signal: AbortSignal;
  /** Resolves a configured integration client (throws a Vietnamese error when not ready). */
  client<T>(integrationId: string): Promise<T>;
  log(text: string): void;
}

/** One running instance (holds watchers, caches). */
export interface MiniAppRun<D> {
  /** Fetch the latest data; null = nothing to show yet (the previous frame stays on the panel). */
  tick(): Promise<D | null>;
  stop(): void;
}

export interface MiniApp<S extends Values = Values, D = unknown> {
  id: string;
  name: string;
  description: string;
  /** Integration ids that must be ready. */
  requires: string[];
  settingsSchema: FieldSpec[];
  defaultSettings: S;
  /** How often the runner calls tick(). */
  pollIntervalMs(settings: S): number;
  start(ctx: MiniAppContext<S>): Promise<MiniAppRun<D>>;
  /** Change detection: the panel is only refreshed when this string changes. */
  key(data: D): string;
  render(ctx: Ctx2D, data: D, area: RenderArea, settings: S): void;
}

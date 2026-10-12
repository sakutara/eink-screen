import { PANEL } from '../ble/protocol';
import type { MiniApp, QualitySettings } from '../miniapps/types';
import { canvasToPlanes, createCanvas, get2d } from '../render/canvas';
import type { PixelImage, Planes } from '../render/pack';

export interface Frame {
  planes: Planes;
  /** Dithered pixels, exactly what the panel will show. */
  preview: PixelImage;
}

/** miniapp.render -> canvas -> dither(palette) -> packPlanes. */
export function renderFrame(miniapp: MiniApp, data: unknown, settings: Record<string, unknown>, quality: QualitySettings): Frame {
  const canvas = createCanvas(PANEL.width, PANEL.height);
  miniapp.render(get2d(canvas), data, { width: PANEL.width, height: PANEL.height, palette: quality.palette }, settings);
  return canvasToPlanes(canvas, { palette: quality.palette, algorithm: quality.algorithm, contrast: quality.contrast, threshold: quality.threshold });
}

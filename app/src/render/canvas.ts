import { PANEL } from '../ble/protocol';
import { dither, type DitherOptions } from './dither';
import { packPlanes, type PixelImage, type Planes } from './pack';

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function createCanvas(width = PANEL.width, height = PANEL.height): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function get2d(canvas: AnyCanvas): Ctx2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Không tạo được canvas 2D');
  return ctx as Ctx2D;
}

export function readPixels(canvas: AnyCanvas): ImageData {
  return get2d(canvas).getImageData(0, 0, canvas.width, canvas.height);
}

export function putPixels(canvas: AnyCanvas, img: PixelImage): void {
  const data = new Uint8ClampedArray(img.data);
  get2d(canvas).putImageData(new ImageData(data, img.width, img.height), 0, 0);
}

/** Draws `source` scaled to cover the whole canvas (centre-cropped) on a white background. */
export function drawCover(ctx: Ctx2D, source: CanvasImageSource & { width: number; height: number }, w: number, h: number): void {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  const scale = Math.max(w / source.width, h / source.height);
  const dw = source.width * scale, dh = source.height * scale;
  ctx.drawImage(source, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/** Canvas -> quantized pixels -> panel planes. */
export function canvasToPlanes(canvas: AnyCanvas, opts: DitherOptions): { planes: Planes; preview: PixelImage } {
  const preview = dither(readPixels(canvas), opts);
  return { planes: packPlanes(preview), preview };
}

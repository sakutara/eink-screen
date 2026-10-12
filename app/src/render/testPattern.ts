import { PANEL } from '../ble/protocol';
import { createCanvas, get2d } from './canvas';

/**
 * BWR orientation test: label text, arrows pointing to each edge and a red
 * corner marker in the top-left. If the image shows mirrored/rotated, the
 * packing order is wrong.
 */
export function drawTestPattern(canvas: HTMLCanvasElement = createCanvas()): HTMLCanvasElement {
  const { width: w, height: h } = PANEL;
  const ctx = get2d(canvas);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);

  ctx.fillStyle = '#e00';
  ctx.fillRect(4, 4, 28, 28);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText('TL', 18, 18);

  ctx.fillStyle = '#000';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('Màn E-Ink 296x128', w / 2, 40);
  ctx.fillStyle = '#e00';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('ĐỎ  Test  RED', w / 2, 68);
  ctx.fillStyle = '#000';
  ctx.font = '12px sans-serif';
  ctx.fillText('Lên ↑   Xuống ↓   Trái ←   Phải →', w / 2, 92);

  const arrow = (x: number, y: number, dx: number, dy: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    const px = -dy, py = dx;
    ctx.moveTo(x + dx * 10, y + dy * 10);
    ctx.lineTo(x - dx * 6 + px * 8, y - dy * 6 + py * 8);
    ctx.lineTo(x - dx * 6 - px * 8, y - dy * 6 - py * 8);
    ctx.closePath();
    ctx.fill();
  };
  arrow(w / 2, 10, 0, -1, '#000');
  arrow(w / 2, h - 10, 0, 1, '#000');
  arrow(w - 10, h / 2 + 8, 1, 0, '#e00');
  arrow(44, h / 2 + 8, -1, 0, '#000');
  return canvas;
}

/**
 * Contrast / ghosting probe: fine text at several sizes, a large solid black block
 * and a horizontal gradient (to be dithered) so contrast and leftover ghosts are easy to judge.
 */
export function drawContrastPattern(canvas: HTMLCanvasElement = createCanvas()): HTMLCanvasElement {
  const { width: w, height: h } = PANEL;
  const ctx = get2d(canvas);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = '8px sans-serif';
  ctx.fillText('Chữ nhỏ 8px: The quick brown fox 0123456789', 4, 4);
  ctx.font = '10px sans-serif';
  ctx.fillText('Chữ 10px: Màn E-Ink làm tươi nhanh', 4, 16);
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText('Chữ đậm 14px', 4, 30);

  ctx.fillRect(4, 50, 120, 74);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText('Khối đen lớn', 12, 80);

  const gx = 134, gw = w - gx - 4;
  const gradient = ctx.createLinearGradient(gx, 0, gx + gw, 0);
  gradient.addColorStop(0, '#000');
  gradient.addColorStop(1, '#fff');
  ctx.fillStyle = gradient;
  ctx.fillRect(gx, 50, gw, 36);
  ctx.fillStyle = '#808080';
  ctx.fillRect(gx, 90, gw, 34);

  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  for (let x = gx; x < gx + gw; x += 4) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 30);
    ctx.lineTo(x + 0.5, 46);
    ctx.stroke();
  }
  return canvas;
}

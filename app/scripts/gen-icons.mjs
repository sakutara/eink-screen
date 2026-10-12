// Generates simple PNG icons (no dependencies) into public/icons.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

function png(size, maskable) {
  const px = Buffer.alloc(size * size * 3);
  const s = size / 512;
  // Maskable icons keep content inside the central safe zone.
  const k = maskable ? 0.7 : 1;
  const rect = (x, y, w, h) => [x, y, w, h].map((v, i) => (i < 2 ? (256 + (v - 256) * k) * s : v * k * s));
  const shapes = [
    [rect(64, 144, 384, 224), [244, 244, 240]],
    [rect(96, 176, 150, 24), [17, 17, 17]],
    [rect(96, 224, 220, 24), [17, 17, 17]],
    [rect(96, 272, 120, 64), [198, 40, 40]],
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let c = [17, 17, 17];
      for (const [[rx, ry, rw, rh], col] of shapes) {
        if (x >= rx && x < rx + rw && y >= ry && y < ry + rh) c = col;
      }
      px.set(c, (y * size + x) * 3);
    }
  }
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync('public/icons/icon-192.png', png(192, false));
writeFileSync('public/icons/icon-512.png', png(512, false));
writeFileSync('public/icons/icon-maskable-512.png', png(512, true));

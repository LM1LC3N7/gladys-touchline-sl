// Generates cover.png (800x534) for gladys-touchline-sl: plain Node, no
// dependency. A floor seen from above with the serpentine of an underfloor
// heating pipe (warm to cool), a room thermostat with its display and a
// cloud, on a warm-to-blue gradient (no brand logo).
// Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const t = (x / W + y / H) / 2;
    set(x, y, [210 - 170 * t, 100 + 10 * t, 70 + 110 * t]);
  }
}
const white = [255, 255, 255];
const dark = [30, 36, 60];
const floor = [235, 225, 210];
const glass = [190, 215, 240];
const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
// Rounded rectangle, anti-aliased corners.
const box = (x0, y0, x1, y1, r, color, alpha = 1) => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const line = (x0, y0, x1, y1, width, color) => {
  const minX = Math.floor(Math.min(x0, x1) - width);
  const maxX = Math.ceil(Math.max(x0, x1) + width);
  const minY = Math.floor(Math.min(y0, y1) - width);
  const maxY = Math.ceil(Math.max(y0, y1) + width);
  const len2 = (x1 - x0) ** 2 + (y1 - y0) ** 2 || 1;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / len2));
      const d = Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0)));
      const a = Math.max(0, Math.min(1, width / 2 - d + 0.5));
      if (a > 0) set(x, y, color, a);
    }
  }
};
// Warm red at the start of the pipe, cool blue at its end.
const pipeColor = (t) => [235 - 140 * t, 80 + 60 * t, 60 + 180 * t];

// Soft halo.
disc(400, 270, 260, white, 0.06);

// The floor (a room seen from above) and the serpentine pipe.
box(70, 80, 470, 460, 26, floor);
const rows = 8;
const left = 110;
const right = 430;
const top = 115;
const step = (425 - top) / (rows - 1);
const segments = [];
for (let i = 0; i < rows; i += 1) {
  const y = top + i * step;
  segments.push(i % 2 === 0 ? [left, y, right, y] : [right, y, left, y]);
  if (i < rows - 1) {
    const x = i % 2 === 0 ? right : left;
    segments.push([x, y, x, y + step]);
  }
}
segments.forEach(([x0, y0, x1, y1], i) => {
  line(x0, y0, x1, y1, 12, pipeColor(i / (segments.length - 1)));
});

// The room thermostat: its body, its display, two buttons.
box(520, 170, 700, 400, 28, white);
box(545, 200, 675, 280, 12, dark);
box(560, 215, 660, 265, 6, glass);
// "21" on the display, drawn with strokes.
line(575, 225, 595, 225, 6, dark);
line(595, 225, 595, 240, 6, dark);
line(595, 240, 575, 240, 6, dark);
line(575, 240, 575, 255, 6, dark);
line(575, 255, 595, 255, 6, dark);
line(615, 225, 615, 255, 6, dark);
disc(575, 330, 22, [235, 80, 60]);
disc(645, 330, 22, [90, 170, 240]);
line(565, 330, 585, 330, 5, white);
line(635, 330, 655, 330, 5, white);
line(645, 320, 645, 340, 5, white);

// A cloud above the thermostat (the Roth API).
disc(580, 110, 30, white);
disc(620, 95, 38, white);
disc(660, 112, 28, white);
box(560, 105, 680, 140, 16, white);

// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
console.log('cover', png.length, 'bytes');

// Deterministic Marketplace icon generator — no image libraries needed.
// Draws a decision graph (a decision point forking to a rejected and an
// accepted path) at 4x, box-downsamples to 128x128 and encodes the PNG with
// Node's built-in zlib.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = 128;
const SCALE = 4;
const S = OUT * SCALE;
const px = new Float64Array(S * S * 4);

function put(x, y, [r, g, b], a = 1) {
  if (x < 0 || y < 0 || x >= S || y >= S || a <= 0) return;
  const i = (y * S + x) * 4;
  const da = px[i + 3];
  const oa = a + da * (1 - a);
  px[i] = (r * a + px[i] * da * (1 - a)) / oa;
  px[i + 1] = (g * a + px[i + 1] * da * (1 - a)) / oa;
  px[i + 2] = (b * a + px[i + 2] * da * (1 - a)) / oa;
  px[i + 3] = oa;
}

function roundedRect(x0, y0, w, h, radius, color) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const dx = Math.max(x0 + radius - x, x - (x0 + w - 1 - radius), 0);
      const dy = Math.max(y0 + radius - y, y - (y0 + h - 1 - radius), 0);
      if (Math.hypot(dx, dy) <= radius) put(x, y, color);
    }
  }
}

function disc(cx, cy, r, color) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (Math.hypot(x - cx, y - cy) <= r) put(x, y, color);
    }
  }
}

function ring(cx, cy, r, width, color) {
  for (let y = Math.floor(cy - r - width); y <= cy + r + width; y++) {
    for (let x = Math.floor(cx - r - width); x <= cx + r + width; x++) {
      if (Math.abs(Math.hypot(x - cx, y - cy) - r) <= width / 2) put(x, y, color);
    }
  }
}

function line(x1, y1, x2, y2, width, color, dash = 0) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.ceil(len);
  const r = width / 2;
  for (let s = 0; s <= steps; s++) {
    if (dash && Math.floor(s / dash) % 2 === 1) continue;
    const cx = x1 + ((x2 - x1) * s) / steps;
    const cy = y1 + ((y2 - y1) * s) / steps;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (Math.hypot(x - cx, y - cy) <= r) put(x, y, color);
      }
    }
  }
}

// ---- compose (coordinates in the 512 canvas) ------------------------------
const BG = [22, 32, 44];
const TEAL = [45, 212, 191];
const GREEN = [52, 211, 153];
const MUTED = [100, 116, 139];
const WHITE = [255, 255, 255];

roundedRect(16, 16, S - 32, S - 32, 96, BG);

const top = [256, 132];
const left = [148, 372];
const right = [364, 372];

// trunk + fork
line(top[0], top[1], top[0], 238, 26, TEAL);
line(top[0], 238, left[0], left[1] - 48, 22, MUTED, 22);
line(top[0], 238, right[0], right[1] - 56, 26, GREEN);

// decision point
disc(top[0], top[1], 50, TEAL);
disc(top[0], top[1], 22, BG);

// rejected alternative: hollow ring with a cross
ring(left[0], left[1], 46, 18, MUTED);
line(left[0] - 18, left[1] - 18, left[0] + 18, left[1] + 18, 14, MUTED);
line(left[0] + 18, left[1] - 18, left[0] - 18, left[1] + 18, 14, MUTED);

// accepted path: solid disc with a check
disc(right[0], right[1], 62, GREEN);
line(right[0] - 30, right[1] + 2, right[0] - 8, right[1] + 26, 18, WHITE);
line(right[0] - 8, right[1] + 26, right[0] + 32, right[1] - 22, 18, WHITE);

// ---- downsample + encode ------------------------------------------------
const out = Buffer.alloc(OUT * (OUT * 4 + 1));
for (let y = 0; y < OUT; y++) {
  out[y * (OUT * 4 + 1)] = 0;
  for (let x = 0; x < OUT; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SCALE; sy++) {
      for (let sx = 0; sx < SCALE; sx++) {
        const i = ((y * SCALE + sy) * S + (x * SCALE + sx)) * 4;
        const pa = px[i + 3];
        r += px[i] * pa;
        g += px[i + 1] * pa;
        b += px[i + 2] * pa;
        a += pa;
      }
    }
    const o = y * (OUT * 4 + 1) + 1 + x * 4;
    out[o] = a ? Math.round(r / a) : 0;
    out[o + 1] = a ? Math.round(g / a) : 0;
    out[o + 2] = a ? Math.round(b / a) : 0;
    out[o + 3] = Math.round((a / (SCALE * SCALE)) * 255);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(OUT, 0);
ihdr.writeUInt32BE(OUT, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(out, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'media', 'icon.png');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, png);
process.stdout.write(`Wrote ${target} (${png.length} bytes)\n`);

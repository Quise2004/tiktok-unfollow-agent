// generate-icons.js — produces simple PNG icons for the extension.
// No external deps. Draws a rounded square with a "U" glyph using a tiny
// bitmap rasterizer, then encodes as PNG via zlib.
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePNG(width, height, rgba) {
  // rgba: Uint8Array length width*height*4
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // raw scanlines with filter byte 0
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw[p++] = rgba[i];
      raw[p++] = rgba[i + 1];
      raw[p++] = rgba[i + 2];
      raw[p++] = rgba[i + 3];
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// 5x7 bitmap font for "U"
const GLYPH_U = [
  [1, 0, 0, 0, 1],
  [1, 0, 0, 0, 1],
  [1, 0, 0, 0, 1],
  [1, 0, 0, 0, 1],
  [1, 0, 0, 0, 1],
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
];

function drawIcon(size) {
  const rgba = new Uint8Array(size * size * 4);
  const bg = [254, 44, 85]; // TikTok red/pink
  const white = [255, 255, 255];

  const radius = Math.round(size * 0.22);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // rounded square test
      let inside = true;
      const corners = [
        [radius, radius],
        [size - 1 - radius, radius],
        [radius, size - 1 - radius],
        [size - 1 - radius, size - 1 - radius],
      ];
      for (const [cx, cy] of corners) {
        const dx = x - cx, dy = y - cy;
        const inCornerX = (x < radius && cx === radius) || (x > size - 1 - radius && cx === size - 1 - radius);
        const inCornerY = (y < radius && cy === radius) || (y > size - 1 - radius && cy === size - 1 - radius);
        if (inCornerX && inCornerY) {
          if (dx * dx + dy * dy > radius * radius) inside = false;
        }
      }
      if (!inside) {
        rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] = 0;
        continue;
      }
      rgba[i] = bg[0]; rgba[i + 1] = bg[1]; rgba[i + 2] = bg[2]; rgba[i + 3] = 255;
    }
  }

  // draw "U" centered, scaled
  const gw = 5, gh = 7;
  const scale = Math.max(1, Math.floor(size / 11));
  const ox = Math.floor((size - gw * scale) / 2);
  const oy = Math.floor((size - gh * scale) / 2);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      if (!GLYPH_U[gy][gx]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = ox + gx * scale + dx;
          const py = oy + gy * scale + dy;
          if (px < 0 || py < 0 || px >= size || py >= size) continue;
          const i = (py * size + px) * 4;
          rgba[i] = white[0]; rgba[i + 1] = white[1]; rgba[i + 2] = white[2]; rgba[i + 3] = 255;
        }
      }
    }
  }
  return makePNG(size, size, rgba);
}

const outDir = path.join(__dirname, "icons");
for (const s of [16, 32, 48, 128]) {
  const png = drawIcon(s);
  fs.writeFileSync(path.join(outDir, `icon${s}.png`), png);
  console.log(`wrote icon${s}.png (${png.length} bytes)`);
}

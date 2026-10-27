// SPDX-License-Identifier: GPL-2.0-or-later
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join } from "node:path";

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function renderPluginIconPng(size: number): Buffer {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const scale = size / 256;

  for (let y = 0; y < size; y++) {
    const rowOffset = y * (size * 4 + 1);
    raw[rowOffset] = 0; // filter type 0 (None)
    const ny = y / size;

    for (let x = 0; x < size; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const sx = x / scale;
      const sy = y / scale;

      // Dark Playlister slate background (#0B1020 -> #111827)
      let r = Math.round(11 + ny * 6);
      let g = Math.round(16 + ny * 8);
      let b = Math.round(32 + ny * 7);

      // Three vertical fader tracks at x = 64, 128, 192
      const tracks = [
        { cx: 64, capY: 84 },
        { cx: 128, capY: 148 },
        { cx: 192, capY: 68 }
      ];

      for (const t of tracks) {
        // Track groove (sy in 36..220, width 14)
        if (sy >= 36 && sy <= 220 && Math.abs(sx - t.cx) <= 7) {
          if (sy >= t.capY) {
            // Filled active portion: Playlister Blue (#2563EB) to Violet (#7C3AED)
            const mix = (sy - 36) / 184;
            r = Math.round(37 + mix * (124 - 37));
            g = Math.round(99 + mix * (58 - 99));
            b = Math.round(235 + mix * (237 - 235));
          } else {
            r = 30;
            g = 41;
            b = 59;
          }
        }
        // Fader cap (width 40, height 22) in Orange (#F97316) with White center line
        if (Math.abs(sx - t.cx) <= 20 && Math.abs(sy - t.capY) <= 11) {
          if (Math.abs(sy - t.capY) <= 2) {
            r = 248;
            g = 250;
            b = 252;
          } else {
            r = 249;
            g = 115;
            b = 22;
          }
        }
      }

      raw[pxOffset] = r;
      raw[pxOffset + 1] = g;
      raw[pxOffset + 2] = b;
      raw[pxOffset + 3] = 255;
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", idat),
    makeChunk("IEND", Buffer.alloc(0))
  ]);
}

const outDir = join(process.cwd(), "com.jbrick2070.fadester-for-obs.sdPlugin", "imgs", "plugin");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "plugin-icon.png"), renderPluginIconPng(256));
writeFileSync(join(outDir, "plugin-icon@2x.png"), renderPluginIconPng(512));
console.log("Generated plugin-icon.png (256x256) and plugin-icon@2x.png (512x512).");

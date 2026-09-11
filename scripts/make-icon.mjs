#!/usr/bin/env node
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Draw the app icon — `build/icon.png`.
 *
 * The mark is the ledger: four rows, one of them flagged. That is the whole product in one
 * image — a list of work where the only question that matters is which row needs you (§19.3),
 * and the flagged row is the same `⚑` the ledger and the CLI both use for the needs-you set.
 *
 * Drawn in code rather than committed as a binary blob, for the same reason the rest of this
 * repo prefers a generator: a PNG in git is a thing nobody can review or adjust. The palette is
 * `tokens.css`, so the icon and the interface cannot drift apart.
 *
 * Written by hand — a PNG is a zlib stream in four chunks, and pulling in an image library to
 * draw eight rectangles would be a worse trade than thirty lines of encoder.
 *
 *   node scripts/make-icon.mjs
 */

const SIZE = 1024;

// tokens.css — light palette, because an icon sits on someone else's background.
const PAPER = [0x16, 0x19, 0x17];
const ROW = [0x2b, 0x30, 0x2d];
const ROW_LIT = [0xe8, 0xeb, 0xe7];
const FLAG = [0xd9, 0x90, 0x3f];

function canvas(size, fill) {
  const px = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i += 1) {
    px[i * 3] = fill[0];
    px[i * 3 + 1] = fill[1];
    px[i * 3 + 2] = fill[2];
  }
  return px;
}

function rect(px, size, x0f, y0f, wf, hf, colour, radiusf = 0) {
  // Rounded to whole pixels first. A fractional coordinate makes a fractional buffer index,
  // which `Buffer` ignores without complaint — the first version of this drew nothing at all and
  // still wrote a perfectly valid PNG.
  const x0 = Math.round(x0f);
  const y0 = Math.round(y0f);
  const w = Math.round(wf);
  const h = Math.round(hf);
  const radius = Math.round(radiusf);

  for (let y = Math.max(0, y0); y < Math.min(size, y0 + h); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(size, x0 + w); x += 1) {
      if (radius > 0) {
        // Round the corners: skip pixels outside the corner circles.
        const dx = Math.min(x - x0, x0 + w - 1 - x);
        const dy = Math.min(y - y0, y0 + h - 1 - y);
        if (dx < radius && dy < radius) {
          const ox = radius - dx;
          const oy = radius - dy;
          if (ox * ox + oy * oy > radius * radius) continue;
        }
      }
      const i = (y * size + x) * 3;
      px[i] = colour[0];
      px[i + 1] = colour[1];
      px[i + 2] = colour[2];
    }
  }
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

function png(px, size) {
  // Each scanline is prefixed with its filter byte; 0 means "none".
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 3 + 1)] = 0;
    px.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function draw() {
  const px = canvas(SIZE, PAPER);
  const u = SIZE / 32;

  // Four ledger rows. The second is the one that needs you: lit, and flagged.
  const rows = [
    { y: 7, lit: false },
    { y: 13, lit: true },
    { y: 19, lit: false },
    { y: 25, lit: false },
  ];

  for (const { y, lit } of rows) {
    // The gutter glyph: a flag for the row that needs you, a rule for the rest (§19.3 — fixed
    // width, fixed position, so the set scans peripherally).
    if (lit) {
      rect(px, SIZE, 5 * u, y * u - u * 0.4, u * 0.55, u * 3.2, FLAG, u * 0.2);
      rect(px, SIZE, 5 * u, y * u - u * 0.4, u * 2.6, u * 1.7, FLAG, u * 0.25);
    } else {
      rect(px, SIZE, 5 * u, y * u + u * 0.6, u * 1.4, u * 1.4, ROW, u * 0.7);
    }

    const width = lit ? 20 : 15;
    rect(px, SIZE, 9.5 * u, y * u + u * 0.55, width * u, u * 1.5, lit ? ROW_LIT : ROW, u * 0.75);
  }

  return px;
}

const out = join(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'build');
mkdirSync(out, { recursive: true });
const file = join(out, 'icon.png');
writeFileSync(file, png(draw(), SIZE));
process.stdout.write(`wrote ${file} (${SIZE}x${SIZE})\n`);

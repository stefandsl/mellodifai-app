// @vitest-environment node
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { diffPngPixels } from "./png-diff";

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 4, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crcBuf]);
}

function encodeRgbaPng(
  width: number,
  height: number,
  rgba: Uint8Array,
  filterType: 0 | 1 | 2 | 4 = 0,
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const rowBytes = width * 4;
  const raw = Buffer.alloc(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) {
    const outRow = y * (rowBytes + 1);
    raw[outRow] = filterType;
    for (let x = 0; x < rowBytes; x++) {
      const val = rgba[y * rowBytes + x];
      const left = x >= 4 ? rgba[y * rowBytes + x - 4] : 0;
      const up = y > 0 ? rgba[(y - 1) * rowBytes + x] : 0;
      if (filterType === 0) raw[outRow + 1 + x] = val;
      else if (filterType === 1) raw[outRow + 1 + x] = (val - left) & 0xff;
      else if (filterType === 2) raw[outRow + 1 + x] = (val - up) & 0xff;
      else {
        const upLeft = y > 0 && x >= 4 ? rgba[(y - 1) * rowBytes + x - 4] : 0;
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        raw[outRow + 1 + x] = (val - pred) & 0xff;
      }
    }
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", deflateSync(raw)),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("diffPngPixels", () => {
  it("reports 0 changed pixels for identical RGBA pixels even when PNG filters differ", () => {
    const rgba = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 19) & 0xff;
    const pngNone = encodeRgbaPng(4, 4, rgba, 0);
    const pngPaeth = encodeRgbaPng(4, 4, rgba, 4);
    expect(Buffer.compare(pngNone, pngPaeth)).not.toBe(0);

    const diff = diffPngPixels(pngNone, pngPaeth);
    expect(diff.changedPixels).toBe(0);
    expect(diff.changedBox).toBeNull();
  });

  it("counts changed pixels, reports their bounding box, and respects video masks", () => {
    const a = new Uint8Array(6 * 6 * 4).fill(120);
    const b = new Uint8Array(a);
    // Flip pixel (2, 3) and pixel (4, 5).
    b[(3 * 6 + 2) * 4] = 200;
    b[(5 * 6 + 4) * 4] = 200;
    const pngA = encodeRgbaPng(6, 6, a, 1);
    const pngB = encodeRgbaPng(6, 6, b, 2);

    const unmasked = diffPngPixels(pngA, pngB);
    expect(unmasked.changedPixels).toBe(2);
    expect(unmasked.changedBox).toEqual({ x: 2, y: 3, width: 3, height: 3 });

    const masked = diffPngPixels(pngA, pngB, [
      { x: 2, y: 3, width: 3, height: 3 },
    ]);
    expect(masked.changedPixels).toBe(0);
    expect(masked.changedBox).toBeNull();
  });
});

import { inflateSync } from "node:zlib";

export type DecodedPng = {
  width: number;
  height: number;
  rgba: Uint8Array;
};

export type PixelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PixelDiffResult = {
  width: number;
  height: number;
  changedPixels: number;
  totalPixels: number;
  changedBox: PixelRect | null;
};

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(buf: Buffer): DecodedPng {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error("Input buffer is not a valid PNG");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idats: Buffer[] = [];

  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idats.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + len;
  }

  if (bitDepth !== 8 || interlace !== 0) {
    throw new Error(
      `Unsupported PNG format (bitDepth=${bitDepth}, interlace=${interlace})`,
    );
  }

  const channels =
    colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!channels) {
    throw new Error(`Unsupported PNG colorType=${colorType}`);
  }

  const raw = inflateSync(Buffer.concat(idats));
  const rowBytes = width * channels;
  const stride = rowBytes + 1;
  const recon = new Uint8Array(height * rowBytes);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride];
    const rowStart = y * rowBytes;
    const prevStart = (y - 1) * rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const val = raw[y * stride + 1 + x];
      const left = x >= channels ? recon[rowStart + x - channels] : 0;
      const up = y > 0 ? recon[prevStart + x] : 0;
      const upLeft =
        y > 0 && x >= channels ? recon[prevStart + x - channels] : 0;
      let out = val;
      if (filter === 0) out = val;
      else if (filter === 1) out = (val + left) & 0xff;
      else if (filter === 2) out = (val + up) & 0xff;
      else if (filter === 3) out = (val + ((left + up) >> 1)) & 0xff;
      else if (filter === 4)
        out = (val + paethPredictor(left, up, upLeft)) & 0xff;
      else throw new Error(`Unsupported PNG filter=${filter}`);
      recon[rowStart + x] = out;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const dst = i * 4;
    if (channels === 4) {
      const src = i * 4;
      rgba[dst] = recon[src];
      rgba[dst + 1] = recon[src + 1];
      rgba[dst + 2] = recon[src + 2];
      rgba[dst + 3] = recon[src + 3];
    } else if (channels === 3) {
      const src = i * 3;
      rgba[dst] = recon[src];
      rgba[dst + 1] = recon[src + 1];
      rgba[dst + 2] = recon[src + 2];
      rgba[dst + 3] = 255;
    } else {
      const g = recon[i];
      rgba[dst] = g;
      rgba[dst + 1] = g;
      rgba[dst + 2] = g;
      rgba[dst + 3] = 255;
    }
  }

  return { width, height, rgba };
}

export function diffPngPixels(
  beforeBuf: Buffer,
  afterBuf: Buffer,
  maskRects: readonly PixelRect[] = [],
): PixelDiffResult {
  const a = decodePng(beforeBuf);
  const b = decodePng(afterBuf);
  if (a.width !== b.width || a.height !== b.height) {
    return {
      width: a.width,
      height: a.height,
      changedPixels: Math.max(a.width * a.height, b.width * b.height),
      totalPixels: a.width * a.height,
      changedBox: { x: 0, y: 0, width: a.width, height: a.height },
    };
  }

  let changedPixels = 0;
  let minX = a.width;
  let minY = a.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      let masked = false;
      for (const r of maskRects) {
        if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) {
          masked = true;
          break;
        }
      }
      if (masked) continue;
      const o = (y * a.width + x) * 4;
      if (
        a.rgba[o] !== b.rgba[o] ||
        a.rgba[o + 1] !== b.rgba[o + 1] ||
        a.rgba[o + 2] !== b.rgba[o + 2] ||
        a.rgba[o + 3] !== b.rgba[o + 3]
      ) {
        changedPixels++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  return {
    width: a.width,
    height: a.height,
    changedPixels,
    totalPixels: a.width * a.height,
    changedBox:
      changedPixels > 0
        ? {
            x: minX,
            y: minY,
            width: maxX - minX + 1,
            height: maxY - minY + 1,
          }
        : null,
  };
}

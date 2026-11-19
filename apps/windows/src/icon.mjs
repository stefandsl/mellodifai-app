// PNG (8-bit RGBA, non-interlaced) to a Windows .ico whose entries are all classic DIBs.
// NSIS drops PNG-compressed .ico entries, which ships an installer with no icon at all.
import { inflateSync } from "node:zlib";

export function decodePng(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature)
    throw new Error("Not a PNG file");
  let offset = 8;
  let header = null;
  const data = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR")
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        color: body[9],
        interlace: body[12],
      };
    else if (type === "IDAT") data.push(body);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (!header) throw new Error("PNG has no header");
  if (header.depth !== 8 || header.color !== 6 || header.interlace !== 0)
    throw new Error("Only 8-bit RGBA non-interlaced PNG is supported");
  const { width, height } = header;
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? pixels[(y - 1) * stride + x - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error("Invalid PNG filter");
      pixels[y * stride + x] = (line[x] + predictor) & 0xff;
    }
  }
  return { width, height, pixels };
}

/** Area-average downscale with premultiplied alpha, so edges do not darken. */
export function resize(image, size) {
  const out = Buffer.alloc(size * size * 4);
  const scaleX = image.width / size;
  const scaleY = image.height / size;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * scaleX));
      const y0 = Math.floor(y * scaleY);
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * scaleY));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++)
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * image.width + sx) * 4;
          const alpha = image.pixels[i + 3];
          r += image.pixels[i] * alpha;
          g += image.pixels[i + 1] * alpha;
          b += image.pixels[i + 2] * alpha;
          a += alpha;
          n++;
        }
      const o = (y * size + x) * 4;
      out[o] = a ? Math.round(r / a) : 0;
      out[o + 1] = a ? Math.round(g / a) : 0;
      out[o + 2] = a ? Math.round(b / a) : 0;
      out[o + 3] = Math.round(a / n);
    }
  return { width: size, height: size, pixels: out };
}

/** One 32-bit BGRA DIB: BITMAPINFOHEADER, bottom-up rows, then the AND mask. */
export function dibEntry(image) {
  const { width, height, pixels } = image;
  const maskStride = Math.ceil(width / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(width * height * 4 + maskStride * height, 20);
  const color = Buffer.alloc(width * height * 4);
  const mask = Buffer.alloc(maskStride * height);
  for (let y = 0; y < height; y++) {
    const row = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const o = (row * width + x) * 4;
      color[o] = pixels[i + 2];
      color[o + 1] = pixels[i + 1];
      color[o + 2] = pixels[i];
      color[o + 3] = pixels[i + 3];
      if (pixels[i + 3] === 0)
        mask[row * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, color, mask]);
}

export function writeIco(images) {
  const entries = images.map(dibEntry);
  const directory = Buffer.alloc(6 + 16 * images.length);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach((image, index) => {
    const at = 6 + index * 16;
    directory[at] = image.width >= 256 ? 0 : image.width;
    directory[at + 1] = image.height >= 256 ? 0 : image.height;
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(entries[index].length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entries[index].length;
  });
  return Buffer.concat([directory, ...entries]);
}

export const ICON_SIZES = [256, 48, 32, 16];

export function pngToIco(buffer, sizes = ICON_SIZES) {
  const image = decodePng(buffer);
  return writeIco(sizes.map((size) => resize(image, size)));
}

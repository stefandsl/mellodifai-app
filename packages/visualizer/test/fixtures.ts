import { deflateSync } from "node:zlib";

// Neutral test pictures, drawn here pixel by pixel: no MellodifAI or channel artwork in the frame
// comparison or the look checks.

type Pixel = [number, number, number] | [number, number, number, number];

// A PNG from a pixel function: RGB, or RGBA when `alpha` (transparency kept for the logos).
export function png(
  width: number,
  height: number,
  at: (x: number, y: number) => Pixel,
  alpha = false,
): Buffer {
  const channels = alpha ? 4 : 3;
  const row = width * channels + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < width; x++) {
      const px = at(x, y);
      const o = y * row + 1 + x * channels;
      for (let k = 0; k < channels; k++) raw[o + k] = px[k] ?? 255;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf)
      c = (crcTable[(c ^ byte) & 255] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(Buffer.concat([Buffer.from(type), body])));
    return Buffer.concat([head, Buffer.from(type), body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

// A 16:9 backdrop: a dusk gradient with soft hills and a few lit windows, busy enough to show
// the background dimming and the drift.
export function testBackground(width = 960, height = 540): Buffer {
  return png(width, height, (x, y) => {
    const t = y / height;
    const hill =
      height * (0.62 + 0.08 * Math.sin(x / 90) + 0.04 * Math.sin(x / 23));
    if (y > hill) {
      const lit = (Math.floor(x / 18) * 7 + Math.floor(y / 14) * 13) % 29 === 0;
      return lit ? [250, 205, 120] : [18 + 10 * t, 22 + 8 * t, 40];
    }
    return [clamp(40 + 120 * t), clamp(50 + 60 * t), clamp(120 - 40 * t)];
  });
}

// A square centre picture: concentric bands round an off-centre disc, so a crop shows.
export function testCenter(size = 512): Buffer {
  return png(size, size, (x, y) => {
    const d = Math.hypot(x - size * 0.42, y - size * 0.46);
    if (d < size * 0.18) return [235, 120, 60];
    const band = Math.floor(Math.hypot(x - size / 2, y - size / 2) / 22) % 2;
    return band ? [40, 110, 140] : [20, 40, 70];
  });
}

// A 16:9 picture with its subject (a red block) off to the left, for the subject crop.
export function testCenterWide(): Buffer {
  return png(640, 360, (x, y) => {
    const inBlock = x > 90 && x < 250 && y > 80 && y < 280;
    const stripe = (x + y) % 40 < 4;
    return inBlock ? [240, 40, 50] : stripe ? [40, 90, 110] : [14, 14, 22];
  });
}

// A neutral wide logo on a transparent ground: a ring with a dot and three bars, white with a
// teal ring, anti-aliased edges. 3:1, as a wordmark would be.
export function testLogo(width = 480, height = 160): Buffer {
  const cy = height / 2;
  const r = height * 0.36;
  const cx = r + height * 0.08;
  const cover = (
    inside: (x: number, y: number) => boolean,
    x: number,
    y: number,
  ) => {
    let n = 0;
    for (const dx of [0.25, 0.75])
      for (const dy of [0.25, 0.75]) if (inside(x + dx, y + dy)) n++;
    return n / 4;
  };
  return png(
    width,
    height,
    (x, y) => {
      const ring = cover(
        (a, b) => {
          const d = Math.hypot(a - cx, b - cy);
          return d < r && d > r * 0.72;
        },
        x,
        y,
      );
      const dot = cover((a, b) => Math.hypot(a - cx, b - cy) < r * 0.3, x, y);
      const bars = cover(
        (a, b) => {
          const left = cx + r + height * 0.18;
          for (let k = 0; k < 3; k++) {
            const top = height * (0.22 + k * 0.22);
            const len = (width - left - height * 0.08) * (1 - k * 0.25);
            if (
              a > left &&
              a < left + len &&
              b > top &&
              b < top + height * 0.12
            )
              return true;
          }
          return false;
        },
        x,
        y,
      );
      if (ring > 0) return [46, 230, 214, clamp(255 * ring)];
      const white = Math.max(dot, bars);
      return [255, 255, 255, clamp(255 * white)];
    },
    true,
  );
}

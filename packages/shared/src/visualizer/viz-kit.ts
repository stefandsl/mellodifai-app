import { type AnalysisFrame, BAND_COUNT } from "./viz-audio.js";
import type { VisualizerParams } from "./viz-params.js";

// The drawing kit every preset shares: the canvas interface, the scene, colours, pictures, text
// and the small pieces of motion maths. Pure functions of the scene, so the preview and the
// render draw the same frame.

// The part of CanvasRenderingContext2D the visualizer uses. The browser preview passes its
// canvas context, the Remotion composition its own; tests pass a recorder.
export interface Gradient {
  addColorStop(offset: number, color: string): void;
}
export interface Canvas2D {
  globalAlpha: number;
  globalCompositeOperation: string;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  shadowBlur: number;
  shadowColor: string;
  // CSS filter list (blur for the "contain" cover fit); "none" when unused.
  filter: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  arc(
    x: number,
    y: number,
    r: number,
    start: number,
    end: number,
    ccw?: boolean,
  ): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(): void;
  stroke(): void;
  clip(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: never, ...args: number[]): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  strokeText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): { width: number };
  createLinearGradient(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): Gradient;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): Gradient;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  setTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void;
  createImageData(width: number, height: number): { data: Uint8ClampedArray };
  putImageData(data: never, x: number, y: number): void;
}
export interface ScratchCanvas {
  width: number;
  height: number;
  getContext(type: "2d"): unknown;
}

// A picture the frame draws: an <img>, an ImageBitmap or the current frame of a video.
export type Picture = {
  source: unknown;
  width: number;
  height: number;
  // Where the subject sits, 0..1 of the picture (see `withFocus`). Absent: the centre.
  focus?: { x: number; y: number };
};

export type VisualizerScene = {
  params: VisualizerParams;
  width: number;
  height: number;
  // Seconds into the song, and its length (the end card needs it).
  time: number;
  duration: number;
  // 0..1 smoothed bands and -1..1 wave (audio.ts).
  bands: ArrayLike<number>;
  wave: ArrayLike<number>;
  // The frames before this one, one per video frame (1/30 s): history[0] is this frame,
  // history[k] the frame k video frames earlier (viz-audio HISTORY_FRAMES). The render reads
  // them from the analysis, the preview keeps them as it plays; without it the presets that
  // trail the audio (peaks, echoes, contours) use this frame for every step.
  history?: readonly AnalysisFrame[];
  title: string;
  // The resolved pictures: background (stock, upload, video frame or cover), centre image,
  // and the user's logos, one per entry of `params.logos` (null while one loads or is missing).
  images: {
    background?: Picture | null;
    center?: Picture | null;
    logos?: readonly (Picture | null | undefined)[];
  };
  fontFamily?: string;
};

export const VISUALIZER_FONT = "Oswald";
const FONT_STACK = `"${VISUALIZER_FONT}", "Arial Narrow", Arial, sans-serif`;
export const BASE = "#06060b";

// Deterministic noise: the same frame number gives the same grain and glitch in the preview
// and in the render.
export function hash01(n: number): number {
  let x = Math.trunc(n) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function frameIndex(time: number, fps = 30): number {
  return Math.max(0, Math.floor(time * fps + 1e-6));
}

// Size unit: 1 at 1080 px on the short side, so text and strokes keep their proportion at the
// preview's size.
export function unitOf(width: number, height: number): number {
  return Math.min(width, height) / 1080;
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const c = x.map((v, i) => Math.round(v + ((y[i] as number) - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// Draws `pic` to cover the box, optionally zoomed. The crop is centred, or follows the
// picture's `focus` (the subject) as far as the picture still covers the box. Never stretched.
export function drawCover(
  ctx: Canvas2D,
  pic: Picture,
  x: number,
  y: number,
  w: number,
  h: number,
  zoom = 1,
): void {
  if (!pic.width || !pic.height) return;
  const scale = Math.max(w / pic.width, h / pic.height) * zoom;
  const dw = pic.width * scale;
  const dh = pic.height * scale;
  const place = (box: number, size: number, focus: number) =>
    size <= box
      ? (box - size) / 2
      : Math.min(0, Math.max(box - size, box / 2 - focus * size));
  ctx.drawImage(
    pic.source as never,
    x + place(w, dw, pic.focus?.x ?? 0.5),
    y + place(h, dh, pic.focus?.y ?? 0.5),
    dw,
    dh,
  );
}

export function drawContain(
  ctx: Canvas2D,
  pic: Picture,
  cx: number,
  cy: number,
  size: number,
): void {
  if (!pic.width || !pic.height) return;
  const scale = size / Math.max(pic.width, pic.height);
  const dw = pic.width * scale;
  const dh = pic.height * scale;
  ctx.drawImage(pic.source as never, cx - dw / 2, cy - dh / 2, dw, dh);
}

// Bar heights of a spectrum preset: `count` bars from the bands, 0..1. Bars beyond the bands
// read between two bands so wide frames stay smooth.
export function barValues(bands: ArrayLike<number>, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const at = (i / Math.max(1, count - 1)) * (BAND_COUNT - 1);
    const lo = Math.floor(at);
    const hi = Math.min(BAND_COUNT - 1, lo + 1);
    const t = at - lo;
    out.push(
      ((bands[lo] ?? 0) as number) * (1 - t) + ((bands[hi] ?? 0) as number) * t,
    );
  }
  return out;
}

// Bar values with contrast against the frame's own mean: a loud, dense master still shows
// peaks and valleys instead of a solid wall, and a quiet passage stays small.
export function shapedBars(bands: ArrayLike<number>, count: number): number[] {
  const values = barValues(bands, count);
  const mean = values.reduce((sum, v) => sum + v, 0) / (values.length || 1);
  const floor = 0.7 * mean;
  const span = Math.max(0.2, 1 - floor);
  return values.map((v) => Math.max(0, Math.min(1, (v - floor) / span)));
}

// Position of particle `i` at `time`: drifts upward and sideways, wrapping round the frame.
// A pure function of time, so a frame looks the same however it was reached.
export function particleAt(
  i: number,
  time: number,
  width: number,
  height: number,
): { x: number; y: number; size: number; alpha: number; hue: number } {
  const a = hash01(i * 4 + 1);
  const b = hash01(i * 4 + 2);
  const c = hash01(i * 4 + 3);
  const d = hash01(i * 4 + 4);
  const speed = 0.012 + c * 0.035;
  const y = 1.05 - ((b + time * speed) % 1.1);
  const x = (a + 0.03 * Math.sin(time * (0.3 + d) + i)) % 1;
  return {
    x: ((x + 1) % 1) * width,
    y: y * height,
    size: 0.6 + d * 2.4,
    alpha: 0.25 + 0.6 * c,
    hue: d,
  };
}

export function particleCount(amount: number): number {
  return Math.round((Math.max(0, Math.min(100, amount)) / 100) * 140);
}

export function roundRectPath(
  ctx: Canvas2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

export function font(
  scene: VisualizerScene,
  px: number,
  weight: number | string = 400,
): string {
  const family = scene.fontFamily
    ? `"${scene.fontFamily}", ${FONT_STACK}`
    : FONT_STACK;
  return `${weight} ${Math.max(1, Math.round(px))}px ${family}`;
}

export function fitText(ctx: Canvas2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}...`).width > maxWidth)
    cut = cut.slice(0, -1);
  return `${cut.trimEnd()}...`;
}

// The round centre image at a place, pulsing a little with the bass, with an optional glowing
// ring in the primary colour.
export function roundImageAt(
  ctx: Canvas2D,
  scene: VisualizerScene,
  at: { cx: number; cy: number; r: number },
  level: number,
  ring: boolean,
): void {
  const { params } = scene;
  const { cx, cy, r } = at;
  const u = unitOf(scene.width, scene.height);
  const pic = params.centerImage.mode === "none" ? null : scene.images.center;
  const radius = r * (1 + level * 0.045);
  if (ring) {
    ctx.save();
    ctx.shadowColor = params.colors.primary;
    ctx.shadowBlur = (18 + level * 40) * u;
    ctx.strokeStyle = params.colors.primary;
    ctx.lineWidth = (4 + level * 10) * u;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 6 * u, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (!pic) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  drawFitted(
    ctx,
    pic,
    cx - radius,
    cy - radius,
    radius * 2,
    radius * 2,
    params.centerImage.fit,
    "circle",
  );
  ctx.restore();
}

// ---- the type scale every preset shares -------------------------------------------------------

// Sizes in pixels for the song's text, from the short side of the frame so 16:9 and 9:16 read
// the same on a phone: the title is 6% of the short side (65 px at 1080; 3.6% of the height of
// a 1920x1080 frame even at its smallest shrink), the artist 3.2%, captions and times 2.6%.
export type TypeScale = { title: number; artist: number; caption: number };
export function typeScale(size: { width: number; height: number }): TypeScale {
  const s = Math.min(size.width, size.height);
  return { title: s * 0.06, artist: s * 0.032, caption: s * 0.026 };
}

// The safe area: 5% of each side stays free of text.
export const SAFE_MARGIN = 0.05;
export function safeArea(size: { width: number; height: number }): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  return {
    left: size.width * SAFE_MARGIN,
    top: size.height * SAFE_MARGIN,
    right: size.width * (1 - SAFE_MARGIN),
    bottom: size.height * (1 - SAFE_MARGIN),
  };
}

// The song title, centred, in capitals, at the shared title size, cut to fit the safe width and
// kept inside the safe height.
export function drawTitle(
  ctx: Canvas2D,
  scene: VisualizerScene,
  y: number,
): void {
  if (!scene.title.trim()) return;
  const u = unitOf(scene.width, scene.height);
  const px = typeScale(scene).title;
  const safe = safeArea(scene);
  ctx.save();
  ctx.font = font(scene, px, 500);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.65)";
  ctx.shadowBlur = 16 * u;
  ctx.fillText(
    fitText(ctx, scene.title.trim().toUpperCase(), scene.width * 0.86),
    scene.width / 2,
    Math.min(safe.bottom - px * 0.6, Math.max(safe.top + px * 0.6, y)),
  );
  ctx.restore();
}

// Lifts quiet bands so a soft song still moves: v^0.75.
export function ease(v: number): number {
  return Math.max(0, Math.min(1, v)) ** 0.75;
}

// A beat accent, 0..1: how far the bass level is above its usual swing.
export function kickOf(level: number): number {
  return Math.max(0, level - 0.55) / 0.45;
}

// Ease-out cubic for slides and fades, 0..1 in, 0..1 out.
export function easeOut(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return 1 - (1 - x) ** 3;
}

// The frame k video frames before this one (history[0] is this one); the oldest kept frame
// stands in for older ones, this frame when there is no history.
export function pastFrame(
  scene: VisualizerScene,
  k: number,
): { bands: ArrayLike<number>; wave: ArrayLike<number> } {
  const history = scene.history;
  if (!history || history.length === 0)
    return { bands: scene.bands, wave: scene.wave };
  return history[Math.max(0, Math.min(history.length - 1, Math.floor(k)))] as {
    bands: ArrayLike<number>;
    wave: ArrayLike<number>;
  };
}

// Peak-hold caps: per bar, the highest value of the last `frames` frames, falling by `fall`
// per frame since it was reached. Pure: computed from the history every time.
export function peakValues(
  scene: VisualizerScene,
  count: number,
  frames: number,
  fall: number,
  read: (bands: ArrayLike<number>, count: number) => number[] = barValues,
): number[] {
  const out = read(scene.bands, count);
  for (let k = 1; k < frames; k++) {
    const past = read(pastFrame(scene, k).bands, count);
    for (let i = 0; i < count; i++)
      out[i] = Math.max(out[i] as number, (past[i] as number) - fall * k);
  }
  return out;
}

// m:ss of a time in seconds, never negative.
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Text with letter spacing (`tracking` in pixels between glyphs), drawn glyph by glyph so the
// preview and the render space it the same way. Returns the width drawn.
export function spacedText(
  ctx: Canvas2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
  align: "left" | "center" | "right" = "left",
  stroke = false,
): number {
  const glyphs = [...text];
  const widths = glyphs.map((g) => ctx.measureText(g).width);
  const total =
    widths.reduce((sum, w) => sum + w, 0) +
    tracking * Math.max(0, glyphs.length - 1);
  let at =
    align === "left" ? x : align === "center" ? x - total / 2 : x - total;
  const saved = ctx.textAlign;
  ctx.textAlign = "left";
  glyphs.forEach((g, i) => {
    if (stroke) ctx.strokeText(g, at, y);
    else ctx.fillText(g, at, y);
    at += (widths[i] as number) + tracking;
  });
  ctx.textAlign = saved;
  return total;
}

// The width `spacedText` would draw.
export function spacedWidth(
  ctx: Canvas2D,
  text: string,
  tracking: number,
): number {
  const glyphs = [...text];
  return (
    glyphs.reduce((sum, g) => sum + ctx.measureText(g).width, 0) +
    tracking * Math.max(0, glyphs.length - 1)
  );
}

// Artist and album lines the player-style presets show: the Testo tab's fields (the same ones
// MellodifAI Classico uses), in capitals.
export function songLines(scene: VisualizerScene): {
  title: string;
  artist: string;
  album: string;
} {
  const c = scene.params.classico;
  return {
    title: scene.title.trim().toUpperCase(),
    artist: c.artist.trim().toUpperCase(),
    album: c.album.trim().toUpperCase(),
  };
}

// A column of text lines read top to bottom from `top`, the top edge of the first line: the
// centre of each line and `end`, the bottom of the last one drawn. Each line sits `gap` below
// the line drawn before it; an empty line takes no room, so it leaves no hole.
export function stackDown(
  top: number,
  lines: readonly { text: string; size: number; gap?: number }[],
): { centres: number[]; end: number } {
  let y = top;
  let first = true;
  const centres = lines.map((line) => {
    if (!line.text) return y;
    if (!first) y += line.gap ?? 0;
    first = false;
    const centre = y + line.size / 2;
    y += line.size;
    return centre;
  });
  return { centres, end: y };
}

// Song progress 0..1.
export function progressOf(scene: VisualizerScene): number {
  return scene.duration > 0
    ? Math.min(1, Math.max(0, scene.time / scene.duration))
    : 0;
}

// The largest size, from `px` down to `min`, at which `text` fits `maxWidth` on one line; at
// the smallest size it is cut with an ellipsis.
export function fitSize(
  ctx: Canvas2D,
  scene: VisualizerScene,
  text: string,
  px: number,
  min: number,
  maxWidth: number,
  weight: number | string = 500,
): { text: string; px: number } {
  let size = px;
  while (size > min) {
    ctx.font = font(scene, size, weight);
    if (ctx.measureText(text).width <= maxWidth) return { text, px: size };
    size = Math.max(min, size * 0.9);
  }
  ctx.font = font(scene, min, weight);
  return { text: fitText(ctx, text, maxWidth), px: min };
}

// ---- the centre picture inside a round or square frame ----------------------------------------

export const COVER_FITS = ["cover", "contain"] as const;
export type CoverFit = (typeof COVER_FITS)[number];

// Draws `pic` into the box (the caller clips it round or square). "cover" fills the box with
// the picture's square crop, centred on its subject; "contain" shows the whole picture over a
// blurred copy of itself. A square picture looks the same either way. Never stretched.
export function drawFitted(
  ctx: Canvas2D,
  pic: Picture,
  x: number,
  y: number,
  w: number,
  h: number,
  fit: CoverFit,
  shape: "circle" | "square",
): void {
  if (!pic.width || !pic.height) return;
  const ratio = pic.width / pic.height;
  if (fit === "cover" || Math.abs(ratio / (w / h) - 1) < 0.02) {
    drawCover(ctx, pic, x, y, w, h);
    return;
  }
  ctx.save();
  ctx.filter = `blur(${Math.max(1, Math.round(Math.min(w, h) * 0.06))}px)`;
  drawCover(ctx, pic, x, y, w, h, 1.3);
  ctx.restore();
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fillRect(x, y, w, h);
  // The whole picture: inside the box, or inside the circle for a round frame.
  const scale =
    shape === "circle"
      ? Math.min(w, h) / Math.hypot(pic.width, pic.height)
      : Math.min(w / pic.width, h / pic.height);
  const dw = pic.width * scale;
  const dh = pic.height * scale;
  ctx.drawImage(
    pic.source as never,
    x + (w - dw) / 2,
    y + (h - dh) / 2,
    dw,
    dh,
  );
}

// Where the subject of a picture sits, from its RGBA pixels (any size, a thumbnail is plenty):
// the share of the long side, 0..1, centring the square crop on the busiest part of the
// picture. Busy is local contrast plus distance from the mean colour, weighed towards the
// centre so a flat picture crops in the middle. No model, no network; the same pixels give the
// same answer in the preview and in the render.
export function focusOfPixels(
  data: ArrayLike<number>,
  width: number,
  height: number,
): { x: number; y: number } {
  const centre = { x: 0.5, y: 0.5 };
  if (width < 2 || height < 2 || Math.abs(width - height) < 2) return centre;
  const luma = (i: number) =>
    0.299 * (data[i * 4] as number) +
    0.587 * (data[i * 4 + 1] as number) +
    0.114 * (data[i * 4 + 2] as number);
  const mean = [0, 0, 0];
  for (let i = 0; i < width * height; i++)
    for (let k = 0; k < 3; k++)
      mean[k] = (mean[k] as number) + (data[i * 4 + k] as number);
  for (let k = 0; k < 3; k++) mean[k] = (mean[k] as number) / (width * height);
  const wide = width > height;
  const along = wide ? width : height;
  const side = Math.min(width, height);
  const line = new Array<number>(along).fill(0);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const l = luma(i);
      const edge =
        Math.abs(l - luma(x + 1 < width ? i + 1 : i)) +
        Math.abs(l - luma(y + 1 < height ? i + width : i));
      let far = 0;
      for (let k = 0; k < 3; k++)
        far += Math.abs((data[i * 4 + k] as number) - (mean[k] as number));
      const at = wide ? x : y;
      line[at] = (line[at] as number) + edge + (far * far) / 255;
    }
  // The densest blob of interest: the profile smoothed over a third of the crop, pulled a
  // little to the centre; the crop is then centred on it as far as the picture allows.
  const sigma = Math.max(1, side * 0.18);
  let best = along / 2;
  let bestScore = -1;
  for (let x = 0; x < along; x++) {
    let sum = 0;
    for (let dx = -Math.ceil(sigma * 3); dx <= Math.ceil(sigma * 3); dx++) {
      const at = x + dx;
      if (at >= 0 && at < along)
        sum +=
          (line[at] as number) * Math.exp(-(dx * dx) / (2 * sigma * sigma));
    }
    const score =
      sum * (1 - 0.3 * (Math.abs(x + 0.5 - along / 2) / (along / 2)));
    if (score > bestScore) {
      bestScore = score;
      best = x + 0.5;
    }
  }
  const at = best / along;
  return wide ? { x: at, y: 0.5 } : { x: 0.5, y: at };
}

type ReadableCanvas = {
  width: number;
  height: number;
  getContext(kind: "2d"): unknown;
};

// `pic` with its `focus`, read from a thumbnail of it. Square pictures, and pictures a canvas
// cannot read (cross-origin), come back as they were: cropped in the middle.
export function withFocus(
  pic: Picture,
  make: (width: number, height: number) => ReadableCanvas,
): Picture {
  if (!pic.width || !pic.height || Math.abs(pic.width - pic.height) < 2)
    return pic;
  try {
    const sw = pic.width;
    const sh = pic.height;
    const g = make(sw, sh).getContext("2d") as {
      drawImage(image: never, x: number, y: number, w: number, h: number): void;
      getImageData(
        x: number,
        y: number,
        w: number,
        h: number,
      ): { data: ArrayLike<number> };
    } | null;
    if (!g) return pic;
    // Draw 1:1 and average in code: browsers scale images differently on the GPU and the
    // CPU, so a scaled draw could give the preview and the render different crops.
    g.drawImage(pic.source as never, 0, 0, sw, sh);
    const full = g.getImageData(0, 0, sw, sh).data;
    const k = 64 / Math.max(sw, sh);
    const w = Math.max(2, Math.round(sw * k));
    const h = Math.max(2, Math.round(sh * k));
    const sums = new Float64Array(w * h * 3);
    const counts = new Float64Array(w * h);
    for (let y = 0; y < sh; y++) {
      const row = Math.min(h - 1, Math.floor((y * h) / sh)) * w;
      for (let x = 0; x < sw; x++) {
        const t = row + Math.min(w - 1, Math.floor((x * w) / sw));
        const i = (y * sw + x) * 4;
        for (let c = 0; c < 3; c++)
          sums[t * 3 + c] =
            (sums[t * 3 + c] as number) + (full[i + c] as number);
        counts[t] = (counts[t] as number) + 1;
      }
    }
    const thumb = new Float64Array(w * h * 4);
    for (let t = 0; t < w * h; t++)
      for (let c = 0; c < 3; c++)
        thumb[t * 4 + c] = (sums[t * 3 + c] as number) / (counts[t] as number);
    return { ...pic, focus: focusOfPixels(thumb, w, h) };
  } catch {
    return pic;
  }
}

// ---- line colour that holds against the picture behind it -------------------------------------

export type Rgb = [number, number, number];

export function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// WCAG contrast ratio, 1..21.
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// A dark halo under thin lines: the share of the black base laid under a line.
export const LINE_HALO = 0.65;

// The brightest picture the scene can put behind a line, as the frame draws it: a white
// picture, dimmed by the background dimming, under the dark halo.
export function lineBackdrop(params: VisualizerParams): Rgb {
  const v = 255 * (1 - params.background.dimming / 100);
  return hexToRgb(BASE).map((b) =>
    Math.round(v * (1 - LINE_HALO) + b * LINE_HALO),
  ) as Rgb;
}

// `color` at `alpha`, lightened towards white until it holds `ratio` against the backdrop.
export function inkOver(
  color: string,
  alpha: number,
  backdrop: Rgb,
  ratio: number,
): Rgb {
  const base = hexToRgb(color);
  const composite = (c: Rgb): Rgb =>
    c.map((v, i) =>
      Math.round(v * alpha + (backdrop[i] as number) * (1 - alpha)),
    ) as Rgb;
  let c: Rgb = base;
  for (let t = 0; t <= 1.0001; t += 0.04) {
    c = base.map((v) => Math.round(v + (255 - v) * t)) as Rgb;
    if (contrastRatio(composite(c), backdrop) >= ratio) return c;
  }
  return c;
}

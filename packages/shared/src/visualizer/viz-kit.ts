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
export type Picture = { source: unknown; width: number; height: number };

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
  // and the two brand marks of MellodifAI Classico.
  images: {
    background?: Picture | null;
    center?: Picture | null;
    trumpet?: Picture | null;
    gramophone?: Picture | null;
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

// Draws `pic` to cover the box, centred, optionally zoomed.
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
  ctx.drawImage(
    pic.source as never,
    x + (w - dw) / 2,
    y + (h - dh) / 2,
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
  drawCover(ctx, pic, cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.restore();
}

// The song title, centred, in capitals, cut to fit the frame.
export function drawTitle(
  ctx: Canvas2D,
  scene: VisualizerScene,
  y: number,
  px: number,
): void {
  if (!scene.title.trim()) return;
  const u = unitOf(scene.width, scene.height);
  ctx.save();
  ctx.font = font(scene, px * u, 500);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.65)";
  ctx.shadowBlur = 16 * u;
  ctx.fillText(
    fitText(ctx, scene.title.trim().toUpperCase(), scene.width * 0.86),
    scene.width / 2,
    y,
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

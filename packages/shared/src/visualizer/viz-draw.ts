import { BAND_COUNT, levelOf, silentFrame, WAVE_POINTS } from "./viz-audio.js";
import {
  classicoLines,
  effectOf,
  TEXT_SIZE,
  VISUALIZER_EFFECTS,
  type VisualizerEffect,
  type VisualizerParams,
} from "./viz-params.js";

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
const BASE = "#06060b";

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

function drawContain(
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

// Where the round centre image sits, per preset and aspect.
export function centerLayout(
  params: VisualizerParams,
  width: number,
  height: number,
): { cx: number; cy: number; r: number } {
  const short = Math.min(width, height);
  const tall = height > width;
  switch (params.preset) {
    case "circle":
      return {
        cx: width / 2,
        cy: height * (tall ? 0.42 : 0.45),
        r: short * 0.2,
      };
    case "particles":
      return {
        cx: width / 2,
        cy: height * (tall ? 0.42 : 0.47),
        r: short * 0.15,
      };
    case "mirror":
      return { cx: width / 2, cy: height * 0.5, r: short * 0.095 };
    case "spectrum":
      return {
        cx: width / 2,
        cy: height * (tall ? 0.3 : 0.32),
        r: short * 0.13,
      };
    case "waveform":
      return {
        cx: width / 2,
        cy: height * (tall ? 0.28 : 0.27),
        r: short * 0.11,
      };
    case "minimal":
      return {
        cx: width / 2,
        cy: height * (tall ? 0.36 : 0.34),
        r: short * 0.12,
      };
    case "classico":
      return { cx: width / 2, cy: height * 0.13, r: short * 0.075 };
  }
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

function roundRectPath(
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

function font(
  scene: VisualizerScene,
  px: number,
  weight: number | string = 400,
): string {
  const family = scene.fontFamily
    ? `"${scene.fontFamily}", ${FONT_STACK}`
    : FONT_STACK;
  return `${weight} ${Math.max(1, Math.round(px))}px ${family}`;
}

// One line of the Classico text stack: shrunk a little if it is too wide, then broken over two
// lines at the space nearest the middle, and only then shortened.
export function stackLine(
  ctx: Canvas2D,
  scene: VisualizerScene,
  text: string,
  px: number,
  maxWidth: number,
): { text: string; px: number; width: number }[] {
  const measure = (t: string, size: number) => {
    ctx.font = font(scene, size, 300);
    return ctx.measureText(t).width;
  };
  if (measure(text, px) <= maxWidth)
    return [{ text, px, width: measure(text, px) }];
  const smaller = px * 0.82;
  if (measure(text, smaller) <= maxWidth)
    return [{ text, px: smaller, width: measure(text, smaller) }];
  const spaces = [...text.matchAll(/ /gu)].map((m) => m.index ?? 0);
  if (spaces.length === 0) {
    ctx.font = font(scene, smaller, 300);
    const cut = fitText(ctx, text, maxWidth);
    return [{ text: cut, px: smaller, width: ctx.measureText(cut).width }];
  }
  const middle = text.length / 2;
  const at = spaces.reduce((best, i) =>
    Math.abs(i - middle) < Math.abs(best - middle) ? i : best,
  );
  return [text.slice(0, at), text.slice(at + 1)].map((part) => {
    ctx.font = font(scene, smaller, 300);
    const cut = fitText(ctx, part, maxWidth);
    return { text: cut, px: smaller, width: ctx.measureText(cut).width };
  });
}

function fitText(ctx: Canvas2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}...`).width > maxWidth)
    cut = cut.slice(0, -1);
  return `${cut.trimEnd()}...`;
}

function drawBackground(ctx: Canvas2D, scene: VisualizerScene): void {
  const { width: w, height: h, params, time } = scene;
  ctx.fillStyle = BASE;
  ctx.fillRect(0, 0, w, h);
  const bg = scene.images.background;
  if (bg) {
    // A slow drift keeps a still picture alive, as the channel's looping backgrounds do.
    const zoom = 1.06 + 0.04 * Math.sin(time / 9);
    ctx.save();
    ctx.translate(
      Math.sin(time / 13) * w * 0.012,
      Math.cos(time / 11) * h * 0.01,
    );
    drawCover(ctx, bg, 0, 0, w, h, zoom);
    ctx.restore();
  } else {
    const g = ctx.createRadialGradient(
      w / 2,
      h * 0.45,
      0,
      w / 2,
      h * 0.45,
      Math.hypot(w, h) * 0.6,
    );
    g.addColorStop(0, rgba(params.colors.secondary, 0.55));
    g.addColorStop(0.55, rgba(params.colors.primary, 0.18));
    g.addColorStop(1, BASE);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  const dim = params.background.dimming / 100;
  if (dim > 0) {
    ctx.fillStyle = `rgba(0,0,0,${dim})`;
    ctx.fillRect(0, 0, w, h);
  }
}

function drawRoundImage(
  ctx: Canvas2D,
  scene: VisualizerScene,
  level: number,
  ring: boolean,
): void {
  const { params } = scene;
  const { cx, cy, r } = centerLayout(params, scene.width, scene.height);
  const u = unitOf(scene.width, scene.height);
  const pic = params.centerImage.mode === "none" ? null : scene.images.center;
  const pulse = 1 + level * 0.045;
  const radius = r * pulse;
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

function drawTitle(
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

function barGradient(
  ctx: Canvas2D,
  params: VisualizerParams,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Gradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, params.colors.secondary);
  g.addColorStop(1, params.colors.primary);
  return g;
}

function presetCircle(ctx: Canvas2D, scene: VisualizerScene, level: number) {
  const { params, width: w, height: h } = scene;
  const { cx, cy, r } = centerLayout(params, w, h);
  const u = unitOf(w, h);
  const bars = 120;
  const values = barValues(scene.bands, bars / 2);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 7 * u;
  ctx.shadowBlur = 14 * u;
  ctx.shadowColor = params.colors.primary;
  for (let i = 0; i < bars; i++) {
    // Mirrored left and right, bass at the top.
    const v = values[i < bars / 2 ? i : bars - 1 - i] as number;
    const angle = -Math.PI / 2 + (i / bars) * Math.PI * 2;
    const inner = r * (1 + level * 0.045) + 16 * u;
    const len = 8 * u + v * Math.min(w, h) * 0.2;
    ctx.strokeStyle = mix(
      params.colors.primary,
      params.colors.secondary,
      i < bars / 2 ? i / (bars / 2) : (bars - i) / (bars / 2),
    );
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(
      cx + Math.cos(angle) * (inner + len),
      cy + Math.sin(angle) * (inner + len),
    );
    ctx.stroke();
  }
  ctx.restore();
  drawRoundImage(ctx, scene, level, true);
  drawTitle(ctx, scene, cy + r + Math.min(w, h) * 0.27, 52);
}

function presetSpectrum(ctx: Canvas2D, scene: VisualizerScene, level: number) {
  const { params, width: w, height: h } = scene;
  const u = unitOf(w, h);
  const count = h > w ? 40 : 72;
  const values = barValues(scene.bands, count);
  const margin = w * 0.06;
  const slot = (w - margin * 2) / count;
  const base = h * (h > w ? 0.86 : 0.88);
  const maxH = h * (h > w ? 0.34 : 0.42);
  ctx.save();
  ctx.fillStyle = barGradient(ctx, params, 0, base, 0, base - maxH);
  ctx.shadowColor = params.colors.primary;
  ctx.shadowBlur = 10 * u;
  for (let i = 0; i < count; i++) {
    const bh = 6 * u + (values[i] as number) * maxH;
    roundRectPath(
      ctx,
      margin + i * slot + slot * 0.18,
      base - bh,
      slot * 0.64,
      bh,
      slot * 0.3,
    );
    ctx.fill();
  }
  // A faint reflection under the bars.
  ctx.globalAlpha = 0.18;
  ctx.shadowBlur = 0;
  for (let i = 0; i < count; i++) {
    const bh = (values[i] as number) * maxH * 0.25;
    ctx.fillRect(
      margin + i * slot + slot * 0.18,
      base + 4 * u,
      slot * 0.64,
      bh,
    );
  }
  ctx.restore();
  drawRoundImage(ctx, scene, level, true);
  const { cy, r } = centerLayout(params, w, h);
  drawTitle(ctx, scene, cy + r + 70 * u, 48);
}

function presetMirror(ctx: Canvas2D, scene: VisualizerScene, level: number) {
  const { params, width: w, height: h } = scene;
  const u = unitOf(w, h);
  const half = h > w ? 22 : 40;
  const values = barValues(scene.bands, half);
  const slot = w / (half * 2);
  const mid = h / 2;
  const maxH = h * (h > w ? 0.2 : 0.36);
  ctx.save();
  ctx.shadowColor = params.colors.secondary;
  ctx.shadowBlur = 12 * u;
  for (let i = 0; i < half * 2; i++) {
    // Bass in the middle, treble at both edges.
    const v = values[i < half ? half - 1 - i : i - half] as number;
    const bh = 4 * u + v * maxH;
    const x = i * slot + slot * 0.2;
    ctx.fillStyle = mix(
      params.colors.primary,
      params.colors.secondary,
      Math.abs(i - half) / half,
    );
    roundRectPath(ctx, x, mid - bh, slot * 0.6, bh * 2, slot * 0.3);
    ctx.fill();
  }
  ctx.restore();
  drawRoundImage(ctx, scene, level, true);
  drawTitle(ctx, scene, h * (h > w ? 0.2 : 0.12), 54);
}

function presetWaveform(ctx: Canvas2D, scene: VisualizerScene, level: number) {
  const { params, width: w, height: h } = scene;
  const u = unitOf(w, h);
  const mid = h * (h > w ? 0.62 : 0.64);
  const amp = h * (h > w ? 0.12 : 0.22);
  const line = (
    color: string,
    scale: number,
    offset: number,
    width: number,
  ) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width * u;
    ctx.beginPath();
    for (let i = 0; i < WAVE_POINTS; i++) {
      const x = (i / (WAVE_POINTS - 1)) * w;
      const v = (scene.wave[(i + offset) % WAVE_POINTS] ?? 0) as number;
      const y = mid + v * amp * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  ctx.save();
  ctx.lineJoin = "round";
  ctx.shadowBlur = 22 * u;
  ctx.shadowColor = params.colors.secondary;
  line(rgba(params.colors.secondary, 0.55), 1.25, 9, 3);
  ctx.shadowColor = params.colors.primary;
  line(params.colors.primary, 1, 0, 4 + level * 3);
  ctx.restore();
  drawRoundImage(ctx, scene, level, true);
  const { cy, r } = centerLayout(params, w, h);
  drawTitle(ctx, scene, cy + r + 60 * u, 48);
}

function presetParticles(ctx: Canvas2D, scene: VisualizerScene, level: number) {
  const { params, width: w, height: h, time } = scene;
  const { cx, cy, r } = centerLayout(params, w, h);
  const u = unitOf(w, h);
  const count = 90 + particleCount(params.particles);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < count; i++) {
    const angle = hash01(i * 7 + 11) * Math.PI * 2;
    const speed = 0.12 + hash01(i * 7 + 12) * 0.25;
    const phase = (hash01(i * 7 + 13) + time * speed) % 1;
    const band = (scene.bands[i % BAND_COUNT] ?? 0) as number;
    const dist = r + 20 * u + phase * Math.hypot(w, h) * 0.55;
    const size = (1.5 + hash01(i * 7 + 14) * 3 + band * 6) * u;
    ctx.globalAlpha = (1 - phase) * (0.35 + band * 0.65);
    ctx.fillStyle = i % 2 ? params.colors.primary : params.colors.secondary;
    ctx.beginPath();
    ctx.arc(
      cx + Math.cos(angle) * dist,
      cy + Math.sin(angle) * dist,
      size,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
  drawRoundImage(ctx, scene, level, true);
  drawTitle(ctx, scene, cy + r + 80 * u, 50);
}

function presetMinimal(ctx: Canvas2D, scene: VisualizerScene, level: number) {
  const { params, width: w, height: h } = scene;
  const u = unitOf(w, h);
  drawRoundImage(ctx, scene, level, false);
  const { cy, r } = centerLayout(params, w, h);
  const titleY = cy + r + 90 * u;
  drawTitle(ctx, scene, titleY, 64);
  const count = 48;
  const values = barValues(scene.bands, count);
  const span = Math.min(w * 0.6, 900 * u);
  const x0 = (w - span) / 2;
  const base = titleY + 110 * u;
  ctx.save();
  ctx.fillStyle = params.colors.primary;
  for (let i = 0; i < count; i++) {
    const bh = 3 * u + (values[i] as number) * 70 * u;
    ctx.fillRect(x0 + (i / count) * span, base - bh / 2, 3 * u, bh);
  }
  ctx.restore();
}

// MellodifAI Classico: the channel's house template (channel-report.md section 3), laid out
// again for the tall frame instead of letterboxing it.
export function classicoLayout(width: number, height: number) {
  const tall = height > width;
  const short = Math.min(width, height);
  return {
    tall,
    badge: { x: width / 2, y: height * (tall ? 0.1 : 0.13), d: short * 0.15 },
    textTop: height * (tall ? 0.16 : 0.235),
    wave: {
      y: height * (tall ? 0.74 : 0.72),
      amp: height * (tall ? 0.05 : 0.085),
    },
    trumpet: tall
      ? { x: width * 0.24, y: height * 0.53, size: short * 0.46 }
      : { x: width * 0.18, y: height * 0.43, size: height * 0.32 },
    gramophone: tall
      ? { x: width * 0.84, y: height * 0.33, size: short * 0.24 }
      : { x: width * 0.88, y: height * 0.25, size: height * 0.17 },
    // Tall frames have room under the wave; there the ruler cannot touch the trumpet player.
    ruler: tall
      ? { y: height * 0.815, x0: width * 0.3, x1: width * 0.7 }
      : { y: height * 0.6, x0: width * 0.36, x1: width * 0.64 },
  };
}

// When the subscribe callout shows: about 1:30, or a bit before the middle of a short song.
export function subscribeWindow(duration: number): [number, number] {
  const at = duration >= 110 ? 90 : Math.max(8, duration * 0.45);
  return [at, at + 6];
}

function easeWindow(time: number, start: number, end: number, fade = 0.6) {
  if (time < start || time > end) return 0;
  return Math.min(1, (time - start) / fade, (end - time) / fade);
}

function tinted(
  scratch: ScratchCanvas | null,
  pic: Picture,
  color: string,
  size: number,
): Picture | null {
  if (!scratch) return null;
  const s = Math.max(1, Math.round(size));
  scratch.width = s;
  scratch.height = s;
  const c = scratch.getContext("2d") as Canvas2D | null;
  if (!c) return null;
  c.clearRect(0, 0, s, s);
  c.globalCompositeOperation = "source-over";
  drawContain(c, pic, s / 2, s / 2, s);
  c.globalCompositeOperation = "source-in";
  c.fillStyle = color;
  c.fillRect(0, 0, s, s);
  c.globalCompositeOperation = "source-over";
  return { source: scratch, width: s, height: s };
}

function presetClassico(
  ctx: Canvas2D,
  scene: VisualizerScene,
  level: number,
  scratch: ScratchCanvas | null,
) {
  const { params, width: w, height: h, time, duration } = scene;
  const u = unitOf(w, h);
  const L = classicoLayout(w, h);
  // Waveform: one full-width line mirrored around a bright core, bass at the left.
  const points = 96;
  const values = barValues(scene.bands, points);
  ctx.save();
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, params.colors.primary);
  grad.addColorStop(1, params.colors.secondary);
  ctx.fillStyle = grad;
  ctx.shadowColor = params.colors.secondary;
  ctx.shadowBlur = 22 * u;
  ctx.beginPath();
  ctx.moveTo(0, L.wave.y);
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * w;
    ctx.lineTo(x, L.wave.y - (values[i] as number) * L.wave.amp - 1.5 * u);
  }
  for (let i = points - 1; i >= 0; i--) {
    const x = (i / (points - 1)) * w;
    ctx.lineTo(x, L.wave.y + (values[i] as number) * L.wave.amp + 1.5 * u);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 8 * u;
  ctx.shadowColor = "#ffffff";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillRect(0, L.wave.y - 1.2 * u, w, 2.4 * u);
  ctx.restore();

  // Progress ruler: the channel's tick scale, with the red marker moving through the song.
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 2 * u;
  const ticks = 24;
  for (let i = 0; i <= ticks; i++) {
    const x = L.ruler.x0 + ((L.ruler.x1 - L.ruler.x0) * i) / ticks;
    const tall = i % 4 === 0 ? 14 : 7;
    ctx.beginPath();
    ctx.moveTo(x, L.ruler.y - tall * u);
    ctx.lineTo(x, L.ruler.y);
    ctx.stroke();
  }
  const progress = duration > 0 ? Math.min(1, Math.max(0, time / duration)) : 0;
  ctx.fillStyle = "#ff1a1a";
  ctx.beginPath();
  ctx.arc(
    L.ruler.x0 + (L.ruler.x1 - L.ruler.x0) * progress,
    L.ruler.y - 7 * u,
    8 * u,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  // Brand marks: the red trumpet player left, the gramophone top right (red or black).
  if (scene.images.trumpet)
    drawContain(
      ctx,
      scene.images.trumpet,
      L.trumpet.x,
      L.trumpet.y,
      L.trumpet.size,
    );
  if (scene.images.gramophone) {
    const pic =
      params.classico.gramophone === "black"
        ? tinted(scratch, scene.images.gramophone, "#0b0b0b", L.gramophone.size)
        : scene.images.gramophone;
    if (pic)
      drawContain(ctx, pic, L.gramophone.x, L.gramophone.y, L.gramophone.size);
  }

  // Play badge with the teal glow, pulsing with the bass.
  const { x: bx, y: by, d } = L.badge;
  const r = (d / 2) * (1 + level * 0.05);
  ctx.save();
  ctx.shadowColor = "#2ee6d6";
  ctx.shadowBlur = (26 + level * 30) * u;
  const badge = ctx.createLinearGradient(bx, by - r, bx, by + r);
  badge.addColorStop(0, "#ee0000");
  badge.addColorStop(1, "#c32a3c");
  ctx.fillStyle = badge;
  ctx.beginPath();
  ctx.arc(bx, by, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(bx - r * 0.3, by - r * 0.42);
  ctx.lineTo(bx + r * 0.5, by);
  ctx.lineTo(bx - r * 0.3, by + r * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Text stack under the badge on a soft plate, so no line sits unreadable on a lit tower.
  const lines = classicoLines(params, scene.title);
  if (lines.length) {
    const base = (L.tall ? 64 : 58) * u;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    let y = L.textTop;
    const metrics = lines.flatMap((line) =>
      stackLine(ctx, scene, line.text, base * line.size, w * 0.8),
    );
    const plateW = Math.max(...metrics.map((m) => m.width)) + 56 * u;
    const plateH = metrics.reduce((sum, m) => sum + m.px * 1.22, 0) + 28 * u;
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    roundRectPath(ctx, w / 2 - plateW / 2, y - 14 * u, plateW, plateH, 18 * u);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    for (const m of metrics) {
      ctx.font = font(scene, m.px, 300);
      ctx.fillText(m.text, w / 2, y);
      y += m.px * 1.22;
    }
    ctx.restore();
  }

  if (!params.classico.cards) return;
  const artist = params.classico.artist.trim().toUpperCase() || "MELLODIFAI";
  // Intro lower third: ARTIST / PRESENTS with the gold bar, the first five seconds.
  const intro = easeWindow(time, 0.2, 5.2);
  if (intro > 0) {
    ctx.save();
    ctx.globalAlpha = intro;
    const x = w * 0.06 - (1 - intro) * 60 * u;
    const y = h * (L.tall ? 0.865 : 0.8);
    ctx.fillStyle = "#f2a516";
    ctx.fillRect(x, y, 10 * u, 112 * u);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#ffffff";
    ctx.font = font(scene, 56 * u, 600);
    ctx.fillText(artist, x + 28 * u, y);
    ctx.font = font(scene, 34 * u, 300);
    ctx.fillStyle = "#f2d38a";
    ctx.fillText("PRESENTS", x + 30 * u, y + 66 * u);
    ctx.restore();
  }
  // Subscribe callout beside the badge, with the purple bars.
  const [s0, s1] = subscribeWindow(duration);
  const sub = easeWindow(time, s0, s1);
  if (sub > 0) {
    ctx.save();
    ctx.globalAlpha = sub;
    const x = bx + d * 0.75;
    const y = by - 30 * u;
    ctx.fillStyle = "#7b3fe4";
    ctx.fillRect(x, y, 240 * u * sub, 10 * u);
    ctx.fillRect(x, y + 50 * u, 200 * u * sub, 10 * u);
    ctx.font = font(scene, 34 * u, 600);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("SUBSCRIBE", x, y + 30 * u);
    ctx.restore();
  }
  // End card: the last six seconds fade to a subscribe button.
  const end =
    duration > 12 ? easeWindow(time, duration - 6, duration + 1, 1) : 0;
  if (end > 0) {
    ctx.save();
    ctx.globalAlpha = end * 0.7;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = end;
    const bw = 420 * u;
    const bh = 96 * u;
    const y = h * 0.5 - bh / 2;
    ctx.fillStyle = "#ff0000";
    roundRectPath(ctx, w / 2 - bw / 2, y, bw, bh, 14 * u);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = font(scene, 44 * u, 600);
    ctx.fillText("SUBSCRIBE", w / 2, y + bh / 2);
    ctx.font = font(scene, 40 * u, 300);
    ctx.fillText(artist, w / 2, y - 60 * u);
    ctx.restore();
  }
}

function drawParticles(ctx: Canvas2D, scene: VisualizerScene, level: number) {
  const count = particleCount(scene.params.particles);
  if (!count || scene.params.preset === "particles") return;
  const u = unitOf(scene.width, scene.height);
  ctx.save();
  for (let i = 0; i < count; i++) {
    const p = particleAt(i, scene.time, scene.width, scene.height);
    ctx.globalAlpha = p.alpha * (0.6 + level * 0.4);
    ctx.fillStyle =
      p.hue > 0.5 ? scene.params.colors.primary : scene.params.colors.secondary;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * u * (1 + level * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawTextLayers(ctx: Canvas2D, scene: VisualizerScene) {
  const u = unitOf(scene.width, scene.height);
  for (const layer of scene.params.textLayers) {
    if (!layer.text.trim()) continue;
    const size = Math.max(TEXT_SIZE.min, Math.min(TEXT_SIZE.max, layer.size));
    ctx.save();
    ctx.font = font(scene, size * u, 500);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = layer.color;
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 10 * u;
    ctx.fillText(
      layer.text,
      (layer.x / 100) * scene.width,
      (layer.y / 100) * scene.height,
    );
    ctx.restore();
  }
}

// Scratch canvases the effects copy the frame into; made once per renderer.
export type CanvasFactory = (width: number, height: number) => ScratchCanvas;

type Scratch = {
  a: ScratchCanvas;
  b: ScratchCanvas;
  c: ScratchCanvas;
  grain: ScratchCanvas[];
};

function sized(canvas: ScratchCanvas, w: number, h: number): Canvas2D {
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const c = canvas.getContext("2d") as Canvas2D;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = "source-over";
  c.clearRect(0, 0, w, h);
  return c;
}

// Splits red from green and blue by `shift` pixels, sideways.
function splitChannels(
  ctx: Canvas2D,
  s: Scratch,
  w: number,
  h: number,
  shift: number,
) {
  const copy = sized(s.a, w, h);
  copy.drawImage(ctxCanvas(ctx) as never, 0, 0);
  const red = sized(s.b, w, h);
  red.drawImage(s.a as never, 0, 0);
  red.globalCompositeOperation = "multiply";
  red.fillStyle = "#ff0000";
  red.fillRect(0, 0, w, h);
  const cyan = sized(s.c, w, h);
  cyan.drawImage(s.a as never, 0, 0);
  cyan.globalCompositeOperation = "multiply";
  cyan.fillStyle = "#00ffff";
  cyan.fillRect(0, 0, w, h);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(s.c as never, -shift, 0);
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(s.b as never, shift, 0);
  ctx.restore();
}

function ctxCanvas(ctx: Canvas2D): unknown {
  return (ctx as unknown as { canvas: unknown }).canvas;
}

const GRAIN_TILE = 256;
function grainTile(s: Scratch, index: number): ScratchCanvas {
  const tile = s.grain[index] as ScratchCanvas;
  if (tile.width !== GRAIN_TILE) {
    tile.width = GRAIN_TILE;
    tile.height = GRAIN_TILE;
    const c = tile.getContext("2d") as Canvas2D;
    const img = c.createImageData(GRAIN_TILE, GRAIN_TILE);
    for (let i = 0; i < GRAIN_TILE * GRAIN_TILE; i++) {
      const v = Math.floor(hash01(i * 13 + index * 7919 + 17) * 255);
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    c.putImageData(img as never, 0, 0);
  }
  return tile;
}

function applyEffect(
  ctx: Canvas2D,
  scene: VisualizerScene,
  s: Scratch | null,
  id: VisualizerEffect,
  k: number,
  level: number,
) {
  const { width: w, height: h, time } = scene;
  const u = unitOf(w, h);
  const frame = frameIndex(time);
  switch (id) {
    case "grain": {
      if (!s) return;
      const tile = grainTile(s, frame % 4);
      const step = GRAIN_TILE * Math.max(1, u * 1.5);
      const ox = -hash01(frame * 3 + 1) * step;
      const oy = -hash01(frame * 3 + 2) * step;
      ctx.save();
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = 0.12 + 0.4 * k;
      for (let y = oy; y < h; y += step)
        for (let x = ox; x < w; x += step)
          ctx.drawImage(tile as never, x, y, step, step);
      ctx.restore();
      return;
    }
    case "vhs": {
      if (s) splitChannels(ctx, s, w, h, Math.max(1, (1.5 + 3 * k) * u));
      // A tracking band that rolls down the picture, pulled sideways.
      const bandH = h * (0.03 + 0.04 * k);
      const y = (((time * 0.18) % 1.3) - 0.15) * h;
      if (s) {
        const copy = sized(s.a, w, h);
        copy.drawImage(ctxCanvas(ctx) as never, 0, 0);
        const dx = (hash01(frame * 5 + 3) - 0.5) * 40 * u * k;
        ctx.drawImage(s.a as never, 0, y, w, bandH, dx, y, w, bandH);
      }
      ctx.save();
      ctx.globalAlpha = 0.1 + 0.25 * k;
      ctx.fillStyle = "#ffffff";
      for (let i = 0; i < 6; i++) {
        const ly = y + hash01(frame * 11 + i) * bandH;
        ctx.fillRect(
          hash01(frame * 13 + i) * w * 0.5,
          ly,
          w * (0.2 + hash01(frame * 17 + i) * 0.6),
          1.5 * u,
        );
      }
      ctx.globalAlpha = 0.06 + 0.12 * k;
      ctx.fillStyle = "#ffb27a";
      ctx.globalCompositeOperation = "soft-light";
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.4 * k;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, h - h * 0.012, w, h * 0.012);
      ctx.restore();
      return;
    }
    case "scanlines": {
      const gap = Math.max(2, 4 * u);
      ctx.save();
      ctx.fillStyle = `rgba(0,0,0,${0.12 + 0.4 * k})`;
      for (let y = 0; y < h; y += gap) ctx.fillRect(0, y, w, gap / 2);
      ctx.restore();
      return;
    }
    case "vignette": {
      const g = ctx.createRadialGradient(
        w / 2,
        h / 2,
        Math.min(w, h) * 0.3,
        w / 2,
        h / 2,
        Math.hypot(w, h) * 0.55,
      );
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${0.35 + 0.55 * k})`);
      ctx.save();
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      return;
    }
    case "aberration": {
      if (s)
        splitChannels(
          ctx,
          s,
          w,
          h,
          Math.max(1, (2 + 10 * k) * u * (1 + level * 0.5)),
        );
      return;
    }
    case "glitch": {
      if (!s) return;
      const chance = 0.06 + 0.4 * k * (0.5 + level);
      if (hash01(frame * 7 + 99) > chance) return;
      const copy = sized(s.a, w, h);
      copy.drawImage(ctxCanvas(ctx) as never, 0, 0);
      const slices = 3 + Math.floor(hash01(frame * 7 + 5) * 6);
      for (let i = 0; i < slices; i++) {
        const sy = hash01(frame * 31 + i) * h;
        const sh = h * (0.01 + hash01(frame * 37 + i) * 0.07);
        const dx = (hash01(frame * 41 + i) - 0.5) * w * 0.12 * k;
        ctx.drawImage(s.a as never, 0, sy, w, sh, dx, sy, w, sh);
      }
      ctx.save();
      ctx.globalAlpha = 0.25 * k;
      ctx.fillStyle =
        hash01(frame * 3) > 0.5
          ? scene.params.colors.primary
          : scene.params.colors.secondary;
      ctx.fillRect(
        hash01(frame * 43) * w,
        hash01(frame * 47) * h,
        w * 0.18 * k,
        h * 0.02,
      );
      ctx.restore();
      return;
    }
  }
}

// Draws one frame. The preview calls it on every animation frame, the Remotion composition once
// per video frame; with the same scene both draw the same picture.
export function createVisualizerRenderer(makeCanvas: CanvasFactory | null) {
  const scratch: Scratch | null = makeCanvas
    ? {
        a: makeCanvas(1, 1),
        b: makeCanvas(1, 1),
        c: makeCanvas(1, 1),
        grain: [0, 1, 2, 3].map(() => makeCanvas(1, 1)),
      }
    : null;
  const mark = makeCanvas ? makeCanvas(1, 1) : null;
  return function draw(ctx: Canvas2D, scene: VisualizerScene): void {
    const { params } = scene;
    const level = levelOf(scene.bands);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    drawBackground(ctx, scene);
    drawParticles(ctx, scene, level);
    switch (params.preset) {
      case "circle":
        presetCircle(ctx, scene, level);
        break;
      case "spectrum":
        presetSpectrum(ctx, scene, level);
        break;
      case "mirror":
        presetMirror(ctx, scene, level);
        break;
      case "waveform":
        presetWaveform(ctx, scene, level);
        break;
      case "particles":
        presetParticles(ctx, scene, level);
        break;
      case "minimal":
        presetMinimal(ctx, scene, level);
        break;
      case "classico":
        presetClassico(ctx, scene, level, mark);
        break;
    }
    drawTextLayers(ctx, scene);
    for (const id of VISUALIZER_EFFECTS) {
      const effect = effectOf(params, id);
      if (effect.enabled)
        applyEffect(ctx, scene, scratch, id, effect.intensity / 100, level);
    }
    ctx.restore();
  };
}

// A scene with silence, for a still preview before any audio plays.
export function quietScene(
  base: Omit<VisualizerScene, "bands" | "wave">,
): VisualizerScene {
  const frame = silentFrame();
  return { ...base, bands: frame.bands, wave: frame.wave };
}

import { WAVE_POINTS } from "./viz-audio.js";
import {
  BASE,
  type Canvas2D,
  clock,
  drawCover,
  drawTitle,
  ease,
  easeOut,
  fitText,
  font,
  hash01,
  kickOf,
  mix,
  pastFrame,
  peakValues,
  progressOf,
  rgba,
  roundImageAt,
  shapedBars,
  songLines,
  spacedText,
  spacedWidth,
  unitOf,
  type VisualizerScene,
} from "./viz-kit.js";
import type {
  ParticleShape,
  VisualizerParams,
  VisualizerPreset,
} from "./viz-params.js";

// The looks recreated from the owner's VideoHive catalogue (E:/mellodifai/research/videohive/
// videohive-catalogue.md, section 4). Every line here is our own geometry, drawn from the scene's
// bands, wave, history and the two colours of the parameters: nothing is copied from the packs.
// Like the other presets they are pure functions of the scene, so the preview and the render
// draw the same frame.

export const LOOK_PRESETS = [
  "dotline",
  "burst",
  "crown",
  "wirering",
  "lens",
  "pills",
  "edgebars",
  "coverframe",
  "playercard",
  "contours",
  "synthwave",
  "editorial",
  "shaped",
] as const satisfies readonly VisualizerPreset[];
export type LookPreset = (typeof LOOK_PRESETS)[number];

export function isLook(preset: VisualizerPreset): preset is LookPreset {
  return (LOOK_PRESETS as readonly string[]).includes(preset);
}

type At = { cx: number; cy: number; r: number };
const TAU = Math.PI * 2;

// Where each look puts its centre image (for square pictures, the centre and half the side).
export function lookCenter(
  params: VisualizerParams,
  width: number,
  height: number,
): At {
  const w = width;
  const h = height;
  const s = Math.min(w, h);
  const tall = h > w;
  switch (params.preset as LookPreset) {
    case "dotline":
    case "burst":
      return tall
        ? { cx: w / 2, cy: h * 0.29, r: s * 0.13 }
        : { cx: w / 2, cy: h * 0.2, r: s * 0.085 };
    case "crown":
      return {
        cx: w / 2,
        cy: h * (tall ? 0.42 : 0.46),
        r: s * (tall ? 0.2 : 0.16),
      };
    case "wirering":
      return {
        cx: w / 2,
        cy: h * (tall ? 0.45 : 0.46),
        r: s * (tall ? 0.2 : 0.18),
      };
    case "lens":
      return {
        cx: w / 2,
        cy: h * (tall ? 0.63 : 0.17),
        r: s * (tall ? 0.1 : 0.075),
      };
    case "pills":
      return tall
        ? { cx: w / 2, cy: h * 0.24, r: s * 0.17 }
        : { cx: w * 0.27, cy: h * 0.42, r: s * 0.2 };
    case "edgebars": {
      const card = edgeCard(w, h);
      return { cx: card.cx, cy: card.cy, r: card.h / 2 };
    }
    case "coverframe": {
      const f = coverFrame(w, h);
      return { cx: f.x + f.side / 2, cy: f.y + f.side / 2, r: f.side / 2 };
    }
    case "playercard":
      return tall
        ? { cx: w / 2, cy: h * 0.29, r: s * 0.29 }
        : { cx: w * 0.29, cy: h * 0.48, r: s * 0.25 };
    case "contours":
      if (params.look.contour === "ridges")
        return tall
          ? { cx: w / 2, cy: h * 0.25, r: s * 0.14 }
          : { cx: w / 2, cy: h * 0.19, r: s * 0.09 };
      return {
        cx: w / 2,
        cy: h * (tall ? 0.45 : 0.5),
        r: s * 0.08,
      };
    case "synthwave": {
      const sun = synthSun(w, h);
      return { cx: sun.cx, cy: sun.cy, r: sun.r * 0.6 };
    }
    case "editorial": {
      const p = editorialPhoto(w, h);
      const ys = p.map((q) => q[1] as number);
      const top = Math.min(...ys);
      const bottom = Math.max(...ys);
      const xs = p.map((q) => q[0] as number);
      return {
        cx: (Math.min(...xs) + Math.max(...xs)) / 2,
        cy: (top + bottom) / 2,
        r: (bottom - top) / 2,
      };
    }
    case "shaped":
      if (params.look.flow === "radial")
        return {
          cx: w / 2,
          cy: h * (tall ? 0.42 : 0.46),
          r: s * (tall ? 0.15 : 0.13),
        };
      return tall
        ? { cx: w / 2, cy: h * 0.3, r: s * 0.15 }
        : { cx: w / 2, cy: h * 0.3, r: s * 0.12 };
  }
}

// The looks that draw their own particles instead of the frame's drifting dots.
export function drawsOwnParticles(preset: VisualizerPreset): boolean {
  return preset === "shaped";
}

export function drawLook(
  ctx: Canvas2D,
  scene: VisualizerScene,
  level: number,
): void {
  DRAW[scene.params.preset as LookPreset]?.(ctx, scene, level);
}

// ---- small pieces ----------------------------------------------------------------------------

function sizes(scene: VisualizerScene) {
  const { width: w, height: h } = scene;
  return {
    w,
    h,
    s: Math.min(w, h),
    u: unitOf(w, h),
    tall: h > w,
    P: scene.params.colors.primary,
    S: scene.params.colors.secondary,
  };
}

function hGradient(
  ctx: Canvas2D,
  x0: number,
  x1: number,
  a: string,
  b: string,
): unknown {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  return g;
}

// A band value read at `t` (0..1) along `values`, with a cosine blend between neighbours so
// shapes built from a handful of bands stay smooth.
function sampleAt(values: number[], t: number): number {
  const at = Math.max(0, Math.min(1, t)) * (values.length - 1);
  const lo = Math.floor(at);
  const hi = Math.min(values.length - 1, lo + 1);
  const f = (1 - Math.cos((at - lo) * Math.PI)) / 2;
  return (values[lo] as number) * (1 - f) + (values[hi] as number) * f;
}

// A capsule (pill) added to the current path.
function capsule(ctx: Canvas2D, x: number, y: number, w: number, h: number) {
  const r = Math.min(w, h) / 2;
  if (w >= h) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(x + r, y + h);
    ctx.arc(x + r, y + r, r, Math.PI / 2, (Math.PI * 3) / 2);
  } else {
    ctx.moveTo(x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arc(x + r, y + h - r, r, 0, Math.PI);
    ctx.lineTo(x, y + r);
    ctx.arc(x + r, y + r, r, Math.PI, TAU);
  }
  ctx.closePath();
}

function dotAt(ctx: Canvas2D, x: number, y: number, r: number) {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, TAU);
}

function polygonPath(ctx: Canvas2D, points: number[][]) {
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p[0] as number, p[1] as number);
    else ctx.lineTo(p[0] as number, p[1] as number);
  });
  ctx.closePath();
}

// One line of text placed by its anchor, shrunk to fit `maxWidth` (down to 60%) and cut after
// that. `tracking` is letter spacing as a share of the size. Returns the size used.
function textLine(
  ctx: Canvas2D,
  scene: VisualizerScene,
  text: string,
  x: number,
  y: number,
  px: number,
  opts: {
    weight?: number;
    align?: "left" | "center" | "right";
    color?: string;
    maxWidth?: number;
    tracking?: number;
    shadow?: boolean;
    outline?: number;
  } = {},
): number {
  if (!text) return 0;
  const {
    weight = 500,
    align = "left",
    color = "#ffffff",
    maxWidth,
    tracking = 0,
    shadow = true,
    outline = 0,
  } = opts;
  const u = unitOf(scene.width, scene.height);
  let size = px;
  let line = text;
  ctx.save();
  for (;;) {
    ctx.font = font(scene, size, weight);
    const width = spacedWidth(ctx, line, tracking * size);
    if (!maxWidth || width <= maxWidth) break;
    if (size > px * 0.6) {
      size = Math.max(px * 0.6, size * 0.92);
      continue;
    }
    // Still too wide at the smallest size: cut it.
    if (tracking === 0) {
      line = fitText(ctx, line, maxWidth);
      break;
    }
    while (
      line.length > 1 &&
      spacedWidth(ctx, `${line}...`, tracking * size) > maxWidth
    )
      line = line.slice(0, -1);
    line = `${line.trimEnd()}...`;
    break;
  }
  ctx.textBaseline = "middle";
  if (shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 12 * u;
  }
  if (outline > 0) {
    ctx.strokeStyle = color;
    ctx.lineWidth = outline;
    ctx.lineJoin = "round";
    spacedText(ctx, line, x, y, tracking * size, align, true);
  } else {
    ctx.fillStyle = color;
    spacedText(ctx, line, x, y, tracking * size, align);
  }
  ctx.restore();
  return size;
}

// A square or rectangular picture clipped to a box, or the colour gradient without one.
function boxImage(
  ctx: Canvas2D,
  scene: VisualizerScene,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const pic =
    scene.params.centerImage.mode === "none" ? null : scene.images.center;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  if (pic) drawCover(ctx, pic, x, y, w, h);
  else {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, scene.params.colors.primary);
    g.addColorStop(1, scene.params.colors.secondary);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

// Progress bar with a knob, and the elapsed and total time under it.
function progressBar(
  ctx: Canvas2D,
  scene: VisualizerScene,
  x: number,
  y: number,
  width: number,
  thick: number,
  fill: string,
  times: boolean,
) {
  const { u } = sizes(scene);
  const p = progressOf(scene);
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  capsule(ctx, x, y - thick / 2, width, thick);
  ctx.fill();
  if (p > 0) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    capsule(ctx, x, y - thick / 2, Math.max(thick, width * p), thick);
    ctx.fill();
  }
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = fill;
  ctx.shadowBlur = 10 * u;
  ctx.beginPath();
  ctx.arc(x + width * p, y, thick * 0.9 + 2 * u, 0, TAU);
  ctx.fill();
  ctx.restore();
  if (!times) return;
  const ty = y + thick / 2 + 22 * u;
  textLine(ctx, scene, clock(scene.time), x, ty, 20 * u, {
    weight: 400,
    color: "rgba(255,255,255,0.8)",
  });
  textLine(ctx, scene, clock(scene.duration), x + width, ty, 20 * u, {
    weight: 400,
    align: "right",
    color: "rgba(255,255,255,0.8)",
  });
}

function thinRing(ctx: Canvas2D, at: At, color: string, width: number) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(at.cx, at.cy, at.r + width / 2, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

// ---- P1 Punti: a dotted line with mirrored ticks, bass at both ends ---------------------------

function dotline(ctx: Canvas2D, scene: VisualizerScene, level: number) {
  const { w, h, s, u, tall, P, S } = sizes(scene);
  const x0 = w * (tall ? 0.06 : 0.08);
  const x1 = w - x0;
  const y = h * (tall ? 0.56 : 0.5);
  const n = tall ? 96 : 160;
  const half = n / 2;
  const amp = s * 0.2;
  const values = shapedBars(scene.bands, half);
  const peaks = peakValues(scene, half, 8, 0.012, shapedBars);
  const len = (v: number, t: number) =>
    (6 * u + ease(v) * amp) * (t < 0.03 || t > 0.97 ? 1.8 : 1);
  const grad = hGradient(ctx, x0, x1, P, S);
  ctx.save();
  ctx.lineCap = "round";
  // The thin line the dots sit on.
  ctx.strokeStyle = grad;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 1.5 * u;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.shadowColor = P;
  ctx.shadowBlur = 12 * u;
  ctx.lineWidth = 3 * u;
  const ends: number[][] = [];
  ctx.beginPath();
  for (let j = 0; j < n; j++) {
    const t = j / (n - 1);
    // Bass at both ends, treble in the middle.
    const at = Math.round((1 - Math.abs(t - 0.5) * 2) * (half - 1));
    const l = len(values[at] as number, t);
    const x = x0 + t * (x1 - x0);
    if (t < 0.03 || t > 0.97) ends.push([x, l]);
    else {
      ctx.moveTo(x, y - l);
      ctx.lineTo(x, y + l);
    }
  }
  ctx.stroke();
  // The end spikes stand out in the primary colour.
  ctx.strokeStyle = P;
  ctx.beginPath();
  for (const [x, l] of ends) {
    ctx.moveTo(x as number, y - (l as number));
    ctx.lineTo(x as number, y + (l as number));
  }
  ctx.stroke();
  // Peak caps float above the ticks and fall back slowly.
  ctx.shadowBlur = 6 * u;
  ctx.fillStyle = grad;
  ctx.beginPath();
  for (let j = 0; j < n; j++) {
    const t = j / (n - 1);
    const at = Math.round((1 - Math.abs(t - 0.5) * 2) * (half - 1));
    const l = len(peaks[at] as number, t) + 7 * u;
    const x = x0 + t * (x1 - x0);
    dotAt(ctx, x, y - l, 2.2 * u);
    dotAt(ctx, x, y + l, 2.2 * u);
  }
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  for (let j = 0; j < n; j++)
    dotAt(ctx, x0 + (j / (n - 1)) * (x1 - x0), y, 2.2 * u);
  ctx.fill();
  ctx.restore();
  const at = lookCenter(scene.params, w, h);
  roundImageAt(ctx, scene, at, level, false);
  thinRing(ctx, at, rgba(P, 0.9), 3 * u);
  drawTitle(ctx, scene, h * (tall ? 0.8 : 0.85), 48);
}

// ---- P2 Burst: a glowing sine spindle, loudest in the middle, with echoes ---------------------

function burstPath(
  ctx: Canvas2D,
  bands: ArrayLike<number>,
  x0: number,
  x1: number,
  y: number,
  amp: number,
  cycles: number,
  phase: number,
  steps: number,
) {
  const values = shapedBars(bands, 17);
  const env = (t: number) =>
    ease(sampleAt(values, Math.abs(t - 0.5) * 2)) *
    amp *
    Math.sin(Math.PI * t) ** 0.6;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + t * (x1 - x0);
    const yy = y - env(t) * Math.sin(TAU * cycles * t + phase);
    if (i === 0) ctx.moveTo(x, yy);
    else ctx.lineTo(x, yy);
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    ctx.lineTo(
      x0 + t * (x1 - x0),
      y + env(t) * Math.sin(TAU * cycles * t + phase),
    );
  }
  ctx.closePath();
}

function burst(ctx: Canvas2D, scene: VisualizerScene, level: number) {
  const { w, h, s, u, tall, P, S } = sizes(scene);
  const x0 = w * 0.05;
  const x1 = w * 0.95;
  const y = h * (tall ? 0.56 : 0.52);
  const amp = s * (tall ? 0.17 : 0.2);
  const cycles = tall ? 22 : 38;
  const steps = tall ? 360 : 600;
  // The carrier drifts sideways at a steady pace; the envelope is the music.
  const phase = scene.time * 1.2;
  const grad = hGradient(ctx, x0, x1, P, S);
  ctx.save();
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2 * u;
  for (const [k, alpha] of [
    [6, 0.1],
    [4, 0.2],
    [2, 0.35],
  ] as const) {
    ctx.globalAlpha = alpha;
    burstPath(
      ctx,
      pastFrame(scene, k).bands,
      x0,
      x1,
      y,
      amp,
      cycles,
      phase,
      steps,
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = grad;
  ctx.shadowColor = P;
  ctx.shadowBlur = 14 * u;
  burstPath(ctx, scene.bands, x0, x1, y, amp, cycles, phase, steps);
  ctx.fill();
  ctx.globalAlpha = 0.7;
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 1.5 * u;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillRect(x0, y - 0.75 * u, x1 - x0, 1.5 * u);
  ctx.restore();
  const at = lookCenter(scene.params, w, h);
  roundImageAt(ctx, scene, at, level, false);
  thinRing(ctx, at, rgba(S, 0.9), 3 * u);
  drawTitle(ctx, scene, h * (tall ? 0.8 : 0.85), 48);
}

// ---- P3 Corona: a radial ring of teeth round the cover ----------------------------------------

function crown(ctx: Canvas2D, scene: VisualizerScene, level: number) {
  const { w, h, s, u, tall, P, S } = sizes(scene);
  const { params } = scene;
  const at = lookCenter(params, w, h);
  const { cx, cy } = at;
  const R = at.r * (1 + 0.05 * level) + 4 * u;
  const maxT = s * (tall ? 0.22 : 0.16);
  const teeth = 96;
  const kick = kickOf(level);
  const mirrored = params.look.mirrored;
  const values = shapedBars(scene.bands, mirrored ? teeth / 2 : teeth);
  // A one-sided ring turns slowly; a mirrored one keeps the bass at the top.
  const turn = mirrored ? 0 : (scene.time * Math.PI) / 60;
  const half = (Math.PI / teeth) * 0.98;
  const style = params.look.teeth;
  const g = ctx.createRadialGradient(cx, cy, R, cx, cy, R + maxT * 1.1);
  g.addColorStop(0, P);
  g.addColorStop(1, S);
  ctx.save();
  ctx.shadowColor = P;
  ctx.shadowBlur = 12 * u;
  ctx.fillStyle = g;
  ctx.strokeStyle = g;
  ctx.lineCap = style === "bar" ? "butt" : "round";
  ctx.lineWidth =
    style === "bar"
      ? ((TAU * R) / teeth) * 0.72
      : (style === "pin" ? 2 : 2.5) * u;
  const tips: number[][] = [];
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const v = values[
      mirrored ? (i < teeth / 2 ? i : teeth - 1 - i) : i
    ] as number;
    const len = (0.02 * s + ease(v) * maxT) * (1 + 0.08 * kick);
    const a = -Math.PI / 2 + (i / teeth) * TAU + turn;
    const px = (r: number, ang: number) => cx + Math.cos(ang) * r;
    const py = (r: number, ang: number) => cy + Math.sin(ang) * r;
    if (style === "wedge" || style === "fin") {
      const tip = style === "fin" ? a + half * 1.6 : a;
      ctx.moveTo(px(R, a - half), py(R, a - half));
      ctx.lineTo(px(R + len, tip), py(R + len, tip));
      ctx.lineTo(px(R, a + half), py(R, a + half));
      ctx.closePath();
    } else {
      ctx.moveTo(px(R, a), py(R, a));
      ctx.lineTo(px(R + len, a), py(R + len, a));
      if (style !== "bar") tips.push([px(R + len, a), py(R + len, a), a]);
    }
  }
  if (style === "wedge" || style === "fin") ctx.fill();
  else ctx.stroke();
  if (tips.length) {
    ctx.beginPath();
    for (const [x, y, a] of tips) {
      if (style === "pin") dotAt(ctx, x as number, y as number, 5 * u);
      else {
        // A small diamond on each tick.
        const d = 7 * u;
        const c = Math.cos(a as number);
        const sn = Math.sin(a as number);
        ctx.moveTo((x as number) + c * d, (y as number) + sn * d);
        ctx.lineTo((x as number) - sn * d * 0.5, (y as number) + c * d * 0.5);
        ctx.lineTo((x as number) - c * d, (y as number) - sn * d);
        ctx.lineTo((x as number) + sn * d * 0.5, (y as number) - c * d * 0.5);
        ctx.closePath();
      }
    }
    ctx.fill();
  }
  ctx.strokeStyle = P;
  ctx.lineWidth = 3 * u;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, TAU);
  ctx.stroke();
  ctx.restore();
  roundImageAt(ctx, scene, { cx, cy, r: at.r - 2 * u }, level, false);
  drawTitle(ctx, scene, Math.min(h * 0.93, cy + at.r + maxT + 0.09 * s), 46);
}

// ---- P4 Anello a Filo: a thin spiky ring with a timer -----------------------------------------

function wireringPath(
  ctx: Canvas2D,
  bands: ArrayLike<number>,
  cx: number,
  cy: number,
  r: number,
  depth: number,
) {
  const points = 180;
  const values = shapedBars(bands, points / 2);
  ctx.beginPath();
  for (let i = 0; i < points; i++) {
    const v = values[i < points / 2 ? i : points - 1 - i] as number;
    // Every other point stays low, so the ring reads as sharp teeth.
    const d = depth * ease(v) * (i % 2 === 0 ? 1 : 0.3);
    const a = -Math.PI / 2 + (i / points) * TAU;
    const x = cx + Math.cos(a) * (r + d);
    const y = cy + Math.sin(a) * (r + d);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function wirering(ctx: Canvas2D, scene: VisualizerScene, level: number) {
  const { w, h, s, u, tall, P, S } = sizes(scene);
  const at = lookCenter(scene.params, w, h);
  const { cx, cy } = at;
  const r = at.r * (1 + 0.03 * level);
  const depth = s * (tall ? 0.1 : 0.09);
  const t = scene.time;
  ctx.save();
  // A dark disc keeps the thin lines readable on any picture.
  const disc = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 1.75);
  disc.addColorStop(0, "rgba(0,0,0,0.5)");
  disc.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.75, 0, TAU);
  ctx.fill();
  ctx.restore();
  const pic =
    scene.params.centerImage.mode === "none" ? null : scene.images.center;
  if (pic) {
    roundImageAt(ctx, scene, { cx, cy, r: at.r * 0.72 }, 0, false);
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.arc(cx, cy, at.r * 0.72 + 1, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  const g = ctx.createLinearGradient(0, cy - r - depth, 0, cy + r + depth);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, P);
  ctx.lineJoin = "round";
  // A faint trace of the ring a tenth of a second ago.
  ctx.strokeStyle = S;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1.5 * u;
  wireringPath(ctx, pastFrame(scene, 3).bands, cx, cy, r, depth * 1.06);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = g;
  ctx.shadowColor = P;
  ctx.shadowBlur = 10 * u;
  ctx.lineWidth = 2.5 * u;
  wireringPath(ctx, scene.bands, cx, cy, r, depth);
  ctx.stroke();
  ctx.shadowBlur = 0;
  // Dotted inner ring, and two arcs turning opposite ways.
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.beginPath();
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * TAU + t * 0.1;
    dotAt(ctx, cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8, 1.6 * u);
  }
  ctx.fill();
  ctx.lineCap = "round";
  ctx.strokeStyle = P;
  ctx.lineWidth = 2.5 * u;
  const a1 = (t * 25 * Math.PI) / 180;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.14 + depth, a1, a1 + Math.PI / 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1.5 * u;
  const a2 = (-t * 15 * Math.PI) / 180;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.24 + depth, a2, a2 + (Math.PI * 5) / 18);
  ctx.stroke();
  ctx.restore();
  textLine(ctx, scene, clock(t), cx, cy, s * 0.075, {
    weight: 300,
    align: "center",
  });
  textLine(
    ctx,
    scene,
    scene.title.trim().toUpperCase(),
    cx,
    Math.min(h * 0.93, cy + r + depth + s * 0.12),
    30 * u,
    { weight: 400, align: "center", tracking: 0.3, maxWidth: w * 0.86 },
  );
}

// ---- P5 Lente: a lens waveform with a ruler and a glowing play button -------------------------

function lens(ctx: Canvas2D, scene: VisualizerScene, level: number) {
  const { w, h, s, u, tall, P, S } = sizes(scene);
  const lineY = h * (tall ? 0.34 : 0.75);
  const textY = h * (tall ? 0.47 : 0.31);
  const rulerY = h * (tall ? 0.8 : 0.53);
  const x0 = w * 0.04;
  const x1 = w * 0.96;
  const amp = s * (tall ? 0.09 : 0.11);
  const values = shapedBars(scene.bands, 48);
  const steps = 220;
  const env = (t: number) =>
    ease(sampleAt(values, t)) * amp * Math.sin(Math.PI * t) ** 0.8;
  ctx.save();
  ctx.fillStyle = hGradient(ctx, x0, x1, P, S);
  ctx.shadowColor = S;
  ctx.shadowBlur = 18 * u;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + t * (x1 - x0);
    if (i === 0) ctx.moveTo(x, lineY - env(t) - u);
    else ctx.lineTo(x, lineY - env(t) - u);
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    ctx.lineTo(x0 + t * (x1 - x0), lineY + env(t) + u);
  }
  ctx.closePath();
  ctx.fill();
  // The white core: the waveform itself, flat at the ends.
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = 6 * u;
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 2 * u;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < WAVE_POINTS; i++) {
    const t = i / (WAVE_POINTS - 1);
    const a = (scene.wave[Math.max(0, i - 1)] ?? 0) as number;
    const b = (scene.wave[i] ?? 0) as number;
    const c = (scene.wave[Math.min(WAVE_POINTS - 1, i + 1)] ?? 0) as number;
    const v = (a + 2 * b + c) / 4;
    const y = lineY + v * s * 0.035 * Math.sin(Math.PI * t) ** 0.8;
    const x = x0 + t * (x1 - x0);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();

  // The ruler: 41 ticks, numbered every fifth from 25 down to 00 and up again.
  const span = tall ? w * 0.8 : w * 0.36;
  const rx0 = (w - span) / 2;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  for (let i = 0; i <= 40; i++) {
    const x = rx0 + (span * i) / 40;
    const tickH = (i === 20 ? 44 : i % 4 === 0 ? 34 : 24) * u;
    ctx.fillRect(x - 1.5 * u, rulerY - tickH, 3 * u, tickH);
  }
  ctx.restore();
  for (let i = 0; i <= 40; i += 4)
    textLine(
      ctx,
      scene,
      String((Math.abs(i - 20) / 4) * 5).padStart(2, "0"),
      rx0 + (span * i) / 40,
      rulerY + 22 * u,
      18 * u,
      { weight: 400, align: "center", color: "rgba(255,255,255,0.7)" },
    );
  ctx.save();
  ctx.fillStyle = P;
  ctx.shadowColor = P;
  ctx.shadowBlur = 12 * u;
  ctx.beginPath();
  ctx.arc(w / 2, rulerY - 60 * u, 7 * u * (1 + 0.5 * kickOf(level)), 0, TAU);
  ctx.fill();
  ctx.restore();

  // Title block.
  const lines = songLines(scene);
  textLine(ctx, scene, lines.title, w / 2, textY, 64 * u, {
    weight: 600,
    align: "center",
    maxWidth: w * 0.86,
  });
  textLine(
    ctx,
    scene,
    [lines.artist, lines.album].filter(Boolean).join("  ·  "),
    w / 2,
    textY + 58 * u,
    28 * u,
    { weight: 400, align: "center", tracking: 0.2, maxWidth: w * 0.8 },
  );

  // The play button, with the cover inside when there is one.
  const at = lookCenter(scene.params, w, h);
  const r = at.r * (1 + 0.08 * level);
  ctx.save();
  ctx.shadowColor = S;
  ctx.shadowBlur = (24 + 30 * level) * u;
  ctx.fillStyle = P;
  ctx.beginPath();
  ctx.arc(at.cx, at.cy, r, 0, TAU);
  ctx.fill();
  ctx.restore();
  const pic =
    scene.params.centerImage.mode === "none" ? null : scene.images.center;
  if (pic) {
    roundImageAt(ctx, scene, { cx: at.cx, cy: at.cy, r: r - 4 * u }, 0, false);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = P;
    ctx.beginPath();
    ctx.arc(at.cx, at.cy, r - 4 * u, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(at.cx - r * 0.3, at.cy - r * 0.42);
  ctx.lineTo(at.cx + r * 0.5, at.cy);
  ctx.lineTo(at.cx - r * 0.3, at.cy + r * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---- P6 Pillole: stacked pill columns with peak caps ------------------------------------------

function pills(ctx: Canvas2D, scene: VisualizerScene, level: number) {
  const { w, h, s, u, tall, P, S } = sizes(scene);
  const n = tall ? 8 : 12;
  const rx0 = w * (tall ? 0.08 : 0.52);
  const rx1 = w * (tall ? 0.92 : 0.92);
  const base = h * (tall ? 0.82 : 0.78);
  const pitch = (rx1 - rx0) / n;
  const pw = pitch * 0.64;
  const ph = s * 0.022;
  const step = ph + s * 0.009;
  const maxPills = Math.floor((h * (tall ? 0.34 : 0.56)) / step);
  const values = shapedBars(scene.bands, n);
  const peaks = peakValues(scene, n, 8, 0.012, shapedBars);
  ctx.save();
  for (let c = 0; c < n; c++) {
    const color = mix(P, S, c / (n - 1));
    const exact = ease(values[c] as number) * maxPills;
    const full = Math.min(maxPills, Math.floor(exact));
    const frac = exact - full;
    const x = rx0 + c * pitch + (pitch - pw) / 2;
    const g = ctx.createLinearGradient(0, base, 0, base - maxPills * step);
    g.addColorStop(0, `rgba(${color.slice(4, -1)},0.55)`);
    g.addColorStop(1, color);
    ctx.fillStyle = g;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10 * u;
    ctx.beginPath();
    for (let i = 0; i < Math.max(1, full); i++)
      capsule(ctx, x, base - (i + 1) * step, pw, ph);
    // The pill on its way in grows from its middle with a small overshoot.
    if (full >= 1 && full < maxPills && frac > 0.04) {
      // Back-ease out (overshoot 1.3).
      const k = Math.min(1, frac * 1.15);
      const sc = Math.max(0, 1 + 2.3 * (k - 1) ** 3 + 1.3 * (k - 1) ** 2);
      const cxp = x + pw / 2;
      const cyp = base - (full + 1) * step + ph / 2;
      capsule(ctx, cxp - (pw * sc) / 2, cyp - (ph * sc) / 2, pw * sc, ph * sc);
    }
    ctx.fill();
    const cap = Math.min(
      maxPills,
      Math.max(full + 1, Math.ceil(ease(peaks[c] as number) * maxPills)),
    );
    if (cap <= maxPills) {
      ctx.shadowBlur = 8 * u;
      ctx.shadowColor = "#ffffff";
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.beginPath();
      capsule(ctx, x, base - (cap + 1) * step, pw, ph * 0.7);
      ctx.fill();
    }
  }
  ctx.restore();
  progressBar(ctx, scene, rx0, base + s * 0.035, rx1 - rx0, 8 * u, P, true);

  const at = lookCenter(scene.params, w, h);
  roundImageAt(ctx, scene, at, level, false);
  thinRing(ctx, at, rgba(P, 0.95), 5 * u);
  const lines = songLines(scene);
  const ty = tall ? h * 0.39 : at.cy + at.r + 0.1 * s;
  textLine(ctx, scene, lines.title, at.cx, ty, 54 * u, {
    weight: 600,
    align: "center",
    maxWidth: tall ? w * 0.86 : w * 0.42,
  });
  textLine(ctx, scene, lines.artist, at.cx, ty + 52 * u, 26 * u, {
    weight: 400,
    align: "center",
    tracking: 0.25,
    color: "rgba(255,255,255,0.8)",
    maxWidth: tall ? w * 0.86 : w * 0.42,
  });
}

// ---- P7 Bordi Pixel: dotted equalizers on the top and bottom edges, a playing-card cover ------

function edgeCard(w: number, h: number) {
  const s = Math.min(w, h);
  const tall = h > w;
  const ch = s * (tall ? 0.62 : 0.5);
  const cw = ch * 0.72;
  return {
    cx: tall ? w / 2 : w * 0.34,
    cy: h * (tall ? 0.4 : 0.5),
    w: cw,
    h: ch,
  };
}

function ellipsePoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  from: number,
  to: number,
  steps = 48,
): number[][] {
  const out: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

function strokePoints(ctx: Canvas2D, points: number[][]) {
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p[0] as number, p[1] as number);
    else ctx.lineTo(p[0] as number, p[1] as number);
  });
  ctx.stroke();
}

function edgebars(ctx: Canvas2D, scene: VisualizerScene, level: number) {
  const { w, h, s, u, tall, P, S } = sizes(scene);
  const n = tall ? 36 : 64;
  const pitch = w / n;
  const dot = pitch * 0.55;
  const step = dot * 1.5;
  const maxH = h * (tall ? 0.12 : 0.2);
  const values = shapedBars(scene.bands, n);
  ctx.save();
  const white: number[][] = [];
  const accent: number[][] = [];
  for (let c = 0; c < n; c++) {
    const x = c * pitch + (pitch - dot) / 2;
    // Top row bass left, bottom row bass right: mirrored, never a copy.
    for (const [v, top] of [
      [values[c] as number, true],
      [values[n - 1 - c] as number, false],
    ] as const) {
      const count = Math.max(1, Math.round((ease(v) * maxH) / step));
      for (let i = 0; i < count; i++) {
        const y = top ? step * 0.4 + i * step : h - step * 0.4 - i * step - dot;
        (i === count - 1 ? accent : white).push([x, y]);
      }
    }
  }
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  for (const [x, y] of white) ctx.rect(x as number, y as number, dot, dot);
  ctx.fill();
  ctx.fillStyle = S;
  ctx.shadowColor = S;
  ctx.shadowBlur = 8 * u;
  ctx.beginPath();
  for (const [x, y] of accent) ctx.rect(x as number, y as number, dot, dot);
  ctx.fill();
  ctx.restore();

  // The playing card: a white card, the picture inset, diamond marks in two corners, and a
  // ring round its foot with a light running round it every twelve seconds.
  const card = edgeCard(w, h);
  const lift = 1 + 0.02 * level;
  const cw = card.w * lift;
  const chh = card.h * lift;
  const left = card.cx - cw / 2;
  const top = card.cy - chh / 2;
  const foot = card.cy + chh / 2 - chh * 0.04;
  const rx = cw * 0.9;
  const ry = s * 0.035;
  const ringGrad = hGradient(ctx, card.cx - rx, card.cx + rx, P, S);
  ctx.save();
  ctx.strokeStyle = ringGrad;
  ctx.lineWidth = 4 * u;
  ctx.shadowColor = P;
  ctx.shadowBlur = 10 * u;
  strokePoints(ctx, ellipsePoints(card.cx, foot, rx, ry, Math.PI, TAU));
  ctx.restore();
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 30 * u;
  ctx.fillStyle = "#f6f6f8";
  ctx.beginPath();
  capsuleRect(ctx, left, top, cw, chh, 16 * u);
  ctx.fill();
  ctx.restore();
  const inset = cw * 0.1;
  boxImage(
    ctx,
    scene,
    left + inset,
    top + inset,
    cw - inset * 2,
    chh - inset * 2,
  );
  ctx.save();
  ctx.fillStyle = P;
  for (const [x, y] of [
    [left + inset / 2, top + inset * 1.3],
    [left + cw - inset / 2, top + chh - inset * 1.3],
  ]) {
    const d = inset * 0.32;
    polygonPath(ctx, [
      [x as number, (y as number) - d],
      [(x as number) + d * 0.7, y as number],
      [x as number, (y as number) + d],
      [(x as number) - d * 0.7, y as number],
    ]);
    ctx.fill();
  }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = ringGrad;
  ctx.lineWidth = 4 * u;
  ctx.shadowColor = P;
  ctx.shadowBlur = 10 * u;
  strokePoints(ctx, ellipsePoints(card.cx, foot, rx, ry, 0, Math.PI));
  const runner = (scene.time / 12) * TAU;
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = 14 * u;
  ctx.beginPath();
  ctx.arc(
    card.cx + Math.cos(runner) * rx,
    foot + Math.sin(runner) * ry,
    5 * u,
    0,
    TAU,
  );
  ctx.fill();
  ctx.restore();

  const lines = songLines(scene);
  const tx = tall ? w / 2 : w * 0.56;
  const align = tall ? "center" : "left";
  const maxWidth = tall ? w * 0.86 : w * 0.38;
  const ty = tall ? h * 0.74 : h * 0.4;
  textLine(ctx, scene, lines.artist, tx, ty, 28 * u, {
    weight: 600,
    align,
    tracking: 0.12,
    maxWidth,
  });
  textLine(ctx, scene, lines.title, tx, ty + 62 * u, 62 * u, {
    weight: 600,
    align,
    maxWidth,
  });
  textLine(ctx, scene, lines.album, tx, ty + 116 * u, 30 * u, {
    weight: 300,
    align,
    maxWidth,
  });
  textLine(ctx, scene, clock(scene.time), tx, ty + 176 * u, 44 * u, {
    weight: 500,
    align,
  });
}

// A rounded rectangle added to the current path.
function capsuleRect(
  ctx: Canvas2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
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

// ---- P8 Cornice Cover: the spectrum round a framed square cover ------------------------------

function coverFrame(w: number, h: number) {
  const s = Math.min(w, h);
  const tall = h > w;
  const side = s * (tall ? 0.62 : 0.42);
  return tall
    ? { x: (w - side) / 2, y: h * 0.35 - side / 2, side }
    : { x: w * 0.3 - side / 2, y: h * 0.5 - side / 2, side };
}

// The point at `t` (0..1) clockwise round a square from its top-left corner, and the outward
// direction there.
function perimeter(
  x: number,
  y: number,
  side: number,
  t: number,
): { x: number; y: number; nx: number; ny: number } {
  const d = (((t % 1) + 1) % 1) * 4;
  const k = Math.floor(d);
  const f = d - k;
  switch (k) {
    case 0:
      return { x: x + f * side, y, nx: 0, ny: -1 };
    case 1:
      return { x: x + side, y: y + f * side, nx: 1, ny: 0 };
    case 2:
      return { x: x + side - f * side, y: y + side, nx: 0, ny: 1 };
    default:
      return { x, y: y + side - f * side, nx: -1, ny: 0 };
  }
}

function coverframe(ctx: Canvas2D, scene: VisualizerScene, _level: number) {
  const { w, h, s, u, tall, P, S } = sizes(scene);
  // A duotone wash of the primary colour over the background, as the neon packs do.
  ctx.save();
  ctx.globalCompositeOperation = "color";
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = P;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  const f = coverFrame(w, h);
  const gap = 12 * u;
  const ox = f.x - gap;
  const oy = f.y - gap;
  const oside = f.side + gap * 2;
  const ticks = 112;
  const values = shapedBars(scene.bands, 57);
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.shadowColor = P;
  ctx.shadowBlur = 8 * u;
  ctx.lineWidth = 3 * u;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i < ticks; i++) {
    const t = (i + 0.5) / ticks;
    // Bass at the top-left corner, the treble at the opposite corner, both ways round.
    const at = Math.round((1 - Math.abs(t - 0.5) * 2) * 56);
    const len = 3 * u + ease(values[at] as number) * s * 0.07;
    const p = perimeter(ox, oy, oside, t);
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + p.nx * len, p.y + p.ny * len);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  const dots = 160;
  for (let i = 0; i < dots; i++) {
    const p = perimeter(f.x - gap / 2, f.y - gap / 2, f.side + gap, i / dots);
    dotAt(ctx, p.x, p.y, 1.3 * u);
  }
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 24 * u;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(f.x - 6 * u, f.y - 6 * u, f.side + 12 * u, f.side + 12 * u);
  ctx.restore();
  boxImage(ctx, scene, f.x, f.y, f.side, f.side);

  // Text block with the waveform line above it, and the progress bar with its time chip.
  const lines = songLines(scene);
  const tx = tall ? w / 2 : w * 0.56;
  const align = tall ? "center" : "left";
  const maxWidth = tall ? w * 0.86 : w * 0.36;
  const top = tall ? f.y + f.side + 0.2 * s : h * 0.36;
  const lineW = tall ? w * 0.7 : w * 0.34;
  const lx0 = tall ? (w - lineW) / 2 : tx;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2 * u;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < 128; i++) {
    const t = i / 127;
    const v = (scene.wave[i * 2] ?? 0) as number;
    const y = top - 0.06 * s + v * s * 0.025 * Math.sin(Math.PI * t);
    if (i === 0) ctx.moveTo(lx0 + t * lineW, y);
    else ctx.lineTo(lx0 + t * lineW, y);
  }
  ctx.stroke();
  ctx.restore();
  textLine(ctx, scene, lines.artist, tx, top, 28 * u, {
    weight: 600,
    align,
    tracking: 0.1,
    maxWidth,
  });
  textLine(
    ctx,
    scene,
    lines.title ? `SONG: ${lines.title}` : "",
    tx,
    top + 52 * u,
    44 * u,
    { weight: 600, align, maxWidth },
  );
  textLine(
    ctx,
    scene,
    lines.album ? `ALBUM: ${lines.album}` : "",
    tx,
    top + 100 * u,
    32 * u,
    { weight: 400, align, maxWidth },
  );
  const barW = tall ? w * 0.6 : w * 0.26;
  const bx = tall ? (w - barW) / 2 - 40 * u : tx + 34 * u;
  const by = top + 166 * u;
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(bx - 32 * u, by - 12 * u, 6 * u, 24 * u);
  ctx.fillRect(bx - 21 * u, by - 12 * u, 6 * u, 24 * u);
  ctx.restore();
  progressBar(ctx, scene, bx, by, barW, 10 * u, S, false);
  const chipX = bx + barW + 20 * u;
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  capsuleRect(ctx, chipX, by - 20 * u, 96 * u, 40 * u, 8 * u);
  ctx.fill();
  ctx.restore();
  textLine(ctx, scene, clock(scene.time), chipX + 48 * u, by, 24 * u, {
    weight: 600,
    align: "center",
    color: "#101014",
    shadow: false,
  });
}

// ---- P9 Scheda Player: a big round cover and a white player card -----------------------------

function starPath(
  ctx: Canvas2D,
  cx: number,
  cy: number,
  r: number,
  points: number,
  inner: number,
  turn: number,
) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = turn - Math.PI / 2 + (i / (points * 2)) * TAU;
    const rr = i % 2 === 0 ? r : r * inner;
    if (i === 0) ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    else ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
}

function dashedRing(
  ctx: Canvas2D,
  cx: number,
  cy: number,
  r: number,
  dashes: number,
  turn: number,
) {
  ctx.beginPath();
  for (let i = 0; i < dashes; i++) {
    const a = turn + (i / dashes) * TAU;
    ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.arc(cx, cy, r, a, a + (TAU / dashes) * 0.55);
  }
  ctx.stroke();
}

function playercard(ctx: Canvas2D, scene: VisualizerScene, level: number) {
  const { w, h, s, u, tall, P, S } = sizes(scene);
  const at = lookCenter(scene.params, w, h);
  const t = scene.time;
  ctx.save();
  ctx.strokeStyle = rgba(P, 0.9);
  ctx.lineWidth = 3 * u;
  dashedRing(ctx, at.cx, at.cy, at.r * 1.1, 48, t * 0.15);
  ctx.restore();
  roundImageAt(ctx, scene, at, level, false);
  thinRing(ctx, at, P, 8 * u);
  // A spinning star badge at the cover's upper left, the time bubble at its lower left.
  const bx = at.cx + Math.cos(-2.4) * at.r;
  const by = at.cy + Math.sin(-2.4) * at.r;
  ctx.save();
  ctx.fillStyle = "rgba(10,10,16,0.55)";
  ctx.beginPath();
  ctx.arc(bx, by, 40 * u, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3 * u;
  dashedRing(ctx, bx, by, 34 * u, 12, (t * 40 * Math.PI) / 180);
  ctx.fillStyle = "#ffffff";
  starPath(ctx, bx, by, 20 * u, 4, 0.35, (t * 40 * Math.PI) / 180);
  ctx.fill();
  ctx.restore();
  const tbx = at.cx + Math.cos(2.45) * at.r;
  const tby = at.cy + Math.sin(2.45) * at.r;
  ctx.save();
  ctx.fillStyle = S;
  ctx.shadowColor = S;
  ctx.shadowBlur = 16 * u;
  starPath(ctx, tbx, tby, 50 * u, 12, 0.86, 0);
  ctx.fill();
  ctx.restore();
  textLine(ctx, scene, clock(t), tbx, tby, 28 * u, {
    weight: 600,
    align: "center",
    shadow: false,
  });

  // Text and the card, which slides up into place over the first 0.7 s.
  const lines = songLines(scene);
  const colX = tall ? w * 0.07 : w * 0.54;
  const colW = tall ? w * 0.86 : w * 0.4;
  const align = tall ? "center" : "left";
  const textX = tall ? w / 2 : colX;
  const textTop = tall ? h * 0.6 : h * 0.3;
  textLine(ctx, scene, lines.artist, textX, textTop, 26 * u, {
    weight: 500,
    align,
    tracking: 0.2,
    maxWidth: colW,
  });
  textLine(ctx, scene, lines.title, textX, textTop + 56 * u, 60 * u, {
    weight: 600,
    align,
    maxWidth: colW,
  });
  textLine(ctx, scene, lines.album, textX, textTop + 108 * u, 30 * u, {
    weight: 300,
    align,
    maxWidth: colW,
  });
  const enter = easeOut(t / 0.7);
  const cardH = s * (tall ? 0.17 : 0.16);
  const cardY = (tall ? h * 0.7 : h * 0.55) + (1 - enter) * 40 * u;
  ctx.save();
  ctx.globalAlpha = enter;
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 30 * u;
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.beginPath();
  capsuleRect(ctx, colX, cardY, colW, cardH, 28 * u);
  ctx.fill();
  ctx.shadowBlur = 0;
  // Mini waveform: sixty ticks, the part already played in the primary colour.
  const pad = 32 * u;
  const n = 60;
  const values = shapedBars(scene.bands, n);
  const progress = progressOf(scene);
  const wy = cardY + cardH * 0.36;
  const tickMax = cardH * 0.26;
  const pitch = (colW - pad * 2) / n;
  for (const played of [true, false]) {
    ctx.fillStyle = played ? P : "rgba(20,20,28,0.3)";
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (i / n < progress !== played) continue;
      const th = 3 * u + ease(values[i] as number) * tickMax;
      capsule(
        ctx,
        colX + pad + i * pitch,
        wy - th / 2,
        Math.max(2 * u, pitch * 0.45),
        th,
      );
    }
    ctx.fill();
  }
  const rowY = cardY + cardH * 0.76;
  ctx.fillStyle = P;
  ctx.fillRect(colX + pad, rowY - 11 * u, 6 * u, 22 * u);
  ctx.fillRect(colX + pad + 11 * u, rowY - 11 * u, 6 * u, 22 * u);
  const barX = colX + pad + 36 * u;
  const barW = colW - pad * 2 - 36 * u - 90 * u;
  ctx.fillStyle = "rgba(20,20,28,0.18)";
  ctx.beginPath();
  capsule(ctx, barX, rowY - 3 * u, barW, 6 * u);
  ctx.fill();
  ctx.fillStyle = P;
  ctx.beginPath();
  capsule(ctx, barX, rowY - 3 * u, Math.max(6 * u, barW * progress), 6 * u);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(barX + barW * progress, rowY, 8 * u, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = enter;
  textLine(ctx, scene, clock(t), colX + colW - pad, rowY, 24 * u, {
    weight: 600,
    align: "right",
    color: P,
    shadow: false,
  });
  ctx.restore();
}

// ---- P10 Contorni: rings rippling outwards, or ridge lines of the recent spectrum ------------

function contours(ctx: Canvas2D, scene: VisualizerScene, level: number) {
  const { w, h, s, u, tall, P, S } = sizes(scene);
  const at = lookCenter(scene.params, w, h);
  if (scene.params.look.contour === "ridges") {
    ridges(ctx, scene, level, at);
    return;
  }
  const { cx, cy } = at;
  // Seen at an angle: wide and flattened in 16:9, rounder in 9:16.
  const sx = tall ? 1 : 1.35;
  const sy = tall ? 0.72 : 0.62;
  const r0 = s * (tall ? 0.12 : 0.14);
  const gap = s * (tall ? 0.018 : 0.017);
  const rings = 14;
  const points = 120;
  const turn = (scene.time * 4 * Math.PI) / 180;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineWidth = 2 * u;
  for (let k = rings - 1; k >= 0; k--) {
    // Ring k shows the music of 2k frames ago, so the sound ripples outwards.
    const values = shapedBars(pastFrame(scene, 2 * k).bands, points / 2);
    const depth = (0.02 * s + 0.012 * s * k) * 0.6;
    ctx.strokeStyle = mix(P, S, k / (rings - 1));
    ctx.globalAlpha = Math.max(0.15, 1 - k / 18);
    ctx.shadowColor = k === 0 ? P : "transparent";
    ctx.shadowBlur = k === 0 ? 10 * u : 0;
    ctx.beginPath();
    for (let i = 0; i < points; i++) {
      const v = values[i < points / 2 ? i : points - 1 - i] as number;
      const R = r0 + k * gap + depth * ease(v);
      const a = -Math.PI / 2 + (i / points) * TAU + turn + k * 0.04;
      const x = cx + Math.cos(a) * R * sx;
      const y = cy + Math.sin(a) * R * sy;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
  roundImageAt(ctx, scene, at, level, false);
  thinRing(ctx, at, rgba(P, 0.9), 3 * u);
  drawTitle(ctx, scene, h * (tall ? 0.8 : 0.92), 46);
}

function ridges(ctx: Canvas2D, scene: VisualizerScene, level: number, at: At) {
  const { w, h, s, u, tall, P, S } = sizes(scene);
  const lines = 12;
  const n = 96;
  const x0 = w * (tall ? 0.06 : 0.2);
  const x1 = w * (tall ? 0.94 : 0.8);
  const base = h * (tall ? 0.74 : 0.8);
  const gap = s * (tall ? 0.04 : 0.03);
  const amp = s * (tall ? 0.16 : 0.14);
  ctx.save();
  ctx.lineJoin = "round";
  for (let j = lines - 1; j >= 0; j--) {
    // Line j is the spectrum of 3j frames ago, further back and to the right, like a ridge plot.
    const frame = pastFrame(scene, 3 * j);
    const values = shapedBars(frame.bands, 33);
    const y0 = base - j * gap;
    const shift = j * w * (tall ? 0.006 : 0.012);
    const shrink = 1 - j * 0.02;
    const mid = (x0 + x1) / 2 + shift;
    const half = ((x1 - x0) / 2) * shrink;
    const pts: number[][] = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      // Bass in the middle of each ridge, fading to flat ends.
      const v = ease(sampleAt(values, 1 - Math.abs(t - 0.5) * 2));
      const ripple = (frame.wave[Math.floor(t * (WAVE_POINTS - 1))] ??
        0) as number;
      const y =
        y0 - (v * amp + ripple * amp * 0.08) * Math.sin(Math.PI * t) ** 1.5;
      pts.push([mid - half + t * half * 2, y]);
    }
    ctx.fillStyle = rgba(BASE, 0.9);
    ctx.beginPath();
    pts.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p[0] as number, p[1] as number);
      else ctx.lineTo(p[0] as number, p[1] as number);
    });
    ctx.lineTo(mid + half, y0 + gap * 0.9);
    ctx.lineTo(mid - half, y0 + gap * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = mix(P, S, j / (lines - 1));
    ctx.globalAlpha = Math.max(0.2, 1 - j / 14);
    ctx.lineWidth = (j === 0 ? 3 : 2) * u;
    ctx.shadowColor = j === 0 ? P : "transparent";
    ctx.shadowBlur = j === 0 ? 12 * u : 0;
    strokePoints(ctx, pts);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
  ctx.restore();
  roundImageAt(ctx, scene, at, level, false);
  thinRing(ctx, at, rgba(P, 0.9), 3 * u);
  drawTitle(ctx, scene, h * (tall ? 0.86 : 0.92), 46);
}

// ---- P11 Synthwave: a neon grid floor, a striped sun and the wave on the horizon --------------

function synthSun(w: number, h: number) {
  const s = Math.min(w, h);
  const tall = h > w;
  const horizon = h * (tall ? 0.58 : 0.62);
  const r = s * (tall ? 0.3 : 0.25);
  return { cx: w / 2, cy: horizon - r * 0.42, r, horizon };
}

function synthwave(ctx: Canvas2D, scene: VisualizerScene, level: number) {
  const { w, h, s, u, tall, P, S } = sizes(scene);
  const t = scene.time;
  const sun = synthSun(w, h);
  const { horizon } = sun;
  // Night sky over the background, so a chosen picture still shows through.
  ctx.save();
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "rgba(8,2,28,0.72)");
  sky.addColorStop(1, rgba(S, 0.38));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizon);
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < 120; i++) {
    const x = hash01(i * 3 + 501) * w;
    const y = hash01(i * 3 + 502) * horizon * 0.92;
    ctx.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 3 + i));
    const d = (1 + hash01(i * 3 + 503) * 1.5) * u;
    ctx.fillRect(x, y, d, d);
  }
  ctx.restore();

  // Planets and wireframe triangles drifting.
  const bodies = tall
    ? [
        [0.16, 0.13, 0.08],
        [0.84, 0.29, 0.05],
      ]
    : [
        [0.12, 0.2, 0.08],
        [0.88, 0.32, 0.05],
      ];
  bodies.forEach(([fx, fy, fr], i) => {
    const x = (fx as number) * w;
    const y = (fy as number) * h + Math.sin(t * 0.5 + i) * 6 * u;
    const r = (fr as number) * s;
    const g = ctx.createRadialGradient(
      x - r * 0.4,
      y - r * 0.4,
      r * 0.1,
      x,
      y,
      r,
    );
    g.addColorStop(0, i === 0 ? S : P);
    g.addColorStop(1, rgba(i === 0 ? P : S, 0.85));
    ctx.save();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  });
  ctx.save();
  ctx.strokeStyle = rgba(S, 0.85);
  ctx.lineWidth = 2 * u;
  for (const [fx, fy, size, speed] of tall
    ? [
        [0.78, 0.1, 0.06, 0.25],
        [0.2, 0.38, 0.04, -0.35],
      ]
    : [
        [0.76, 0.14, 0.06, 0.25],
        [0.24, 0.44, 0.04, -0.35],
      ]) {
    const x = (fx as number) * w;
    const y = (fy as number) * h;
    const r = (size as number) * s;
    const a = t * (speed as number);
    polygonPath(
      ctx,
      [0, 1, 2].map((k) => [
        x + Math.cos(a + (k * TAU) / 3) * r,
        y + Math.sin(a + (k * TAU) / 3) * r,
      ]),
    );
    ctx.stroke();
  }
  ctx.restore();

  // The sun: primary to secondary, cut by widening stripes towards the horizon.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, horizon);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(sun.cx, sun.cy, sun.r, 0, TAU);
  ctx.clip();
  const sunG = ctx.createLinearGradient(0, sun.cy - sun.r, 0, sun.cy + sun.r);
  sunG.addColorStop(0, S);
  sunG.addColorStop(1, P);
  ctx.fillStyle = sunG;
  ctx.shadowColor = P;
  ctx.shadowBlur = 40 * u;
  const stripeTop = sun.cy;
  ctx.fillRect(
    sun.cx - sun.r,
    sun.cy - sun.r,
    sun.r * 2,
    stripeTop - (sun.cy - sun.r),
  );
  let y = stripeTop;
  let k = 0;
  while (y < sun.cy + sun.r) {
    const band = sun.r * 0.09;
    const cut = sun.r * (0.015 + k * 0.012);
    ctx.fillRect(sun.cx - sun.r, y, sun.r * 2, band - cut);
    y += band;
    k++;
  }
  ctx.restore();
  const pic =
    scene.params.centerImage.mode === "none" ? null : scene.images.center;
  if (pic) {
    const at = lookCenter(scene.params, w, h);
    roundImageAt(ctx, scene, at, level, false);
    thinRing(ctx, at, P, 4 * u);
  }

  // The grid floor scrolling towards the viewer.
  ctx.save();
  ctx.fillStyle = "rgba(6,0,18,0.78)";
  ctx.fillRect(0, horizon, w, h - horizon);
  ctx.strokeStyle = S;
  ctx.shadowColor = S;
  ctx.shadowBlur = 8 * u;
  ctx.lineWidth = 2 * u;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  const lanes = 22;
  const spread = w * (tall ? 0.34 : 0.2);
  for (let i = 0; i <= lanes; i++) {
    const off = (i - lanes / 2) * spread;
    ctx.moveTo(w / 2 + off * 0.04, horizon);
    ctx.lineTo(w / 2 + off, h);
  }
  ctx.stroke();
  const phase = (t * 0.6) % 1;
  for (let i = 0; i < 14; i++) {
    const f = (i + phase) / 14;
    const yy = horizon + (h - horizon) * f * f;
    ctx.globalAlpha = 0.2 + 0.8 * f;
    ctx.beginPath();
    ctx.moveTo(0, yy);
    ctx.lineTo(w, yy);
    ctx.stroke();
  }
  ctx.restore();

  // The wave rides the horizon, with a faint reflection on the floor.
  for (const [dir, alpha] of [
    [1, 1],
    [-0.6, 0.25],
  ] as const) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = P;
    ctx.shadowColor = P;
    ctx.shadowBlur = 14 * u;
    ctx.lineWidth = 3 * u;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i < 120; i++) {
      const f = i / 119;
      const v = (scene.wave[Math.floor(f * (WAVE_POINTS - 1))] ?? 0) as number;
      const yy =
        horizon - v * s * 0.06 * dir * (0.35 + 0.65 * Math.sin(Math.PI * f));
      if (i === 0) ctx.moveTo(f * w, yy);
      else ctx.lineTo(f * w, yy);
    }
    ctx.stroke();
    ctx.restore();
  }

  const lines = songLines(scene);
  textLine(ctx, scene, lines.artist, w / 2, h * (tall ? 0.07 : 0.1), 34 * u, {
    weight: 500,
    align: "center",
    tracking: 0.35,
    maxWidth: w * 0.86,
  });
  const titleY = h * (tall ? 0.84 : 0.85);
  textLine(ctx, scene, lines.title, w / 2, titleY, 50 * u, {
    weight: 500,
    align: "center",
    tracking: 0.3,
    maxWidth: w * 0.86,
  });
  const barW = w * (tall ? 0.7 : 0.5);
  progressBar(
    ctx,
    scene,
    (w - barW) / 2,
    titleY + 70 * u,
    barW,
    4 * u,
    P,
    true,
  );
}

// ---- P12 Editoriale: an outlined title, a tick strip and a photo cut on the diagonal ----------

function editorialPhoto(w: number, h: number): number[][] {
  const tall = h > w;
  return tall
    ? [
        [w * 0.16, h * 0.06],
        [w * 0.94, h * 0.06],
        [w * 0.84, h * 0.44],
        [w * 0.06, h * 0.44],
      ]
    : [
        [w * 0.62, h * 0.1],
        [w * 0.94, h * 0.1],
        [w * 0.88, h * 0.9],
        [w * 0.56, h * 0.9],
      ];
}

// The title over at most two lines, as large as fits.
function titleLines(
  ctx: Canvas2D,
  scene: VisualizerScene,
  text: string,
  maxWidth: number,
  px: number,
): { lines: string[]; px: number } {
  const fits = (lines: string[], size: number) => {
    ctx.font = font(scene, size, 500);
    return lines.every((l) => ctx.measureText(l).width <= maxWidth);
  };
  for (let size = px; size >= px * 0.62; size *= 0.92)
    if (fits([text], size)) return { lines: [text], px: size };
  const spaces = [...text.matchAll(/ /gu)].map((m) => m.index ?? 0);
  if (spaces.length) {
    const middle = text.length / 2;
    const at = spaces.reduce((best, i) =>
      Math.abs(i - middle) < Math.abs(best - middle) ? i : best,
    );
    const two = [text.slice(0, at), text.slice(at + 1)];
    for (let size = px * 0.72; size >= px * 0.4; size *= 0.92)
      if (fits(two, size)) return { lines: two, px: size };
    ctx.font = font(scene, px * 0.4, 500);
    return {
      lines: two.map((l) => fitText(ctx, l, maxWidth)),
      px: px * 0.4,
    };
  }
  ctx.font = font(scene, px * 0.5, 500);
  return { lines: [fitText(ctx, text, maxWidth)], px: px * 0.5 };
}

function editorial(ctx: Canvas2D, scene: VisualizerScene, _level: number) {
  const { w, h, s, u, tall, P, S } = sizes(scene);
  const t = scene.time;
  const enter = easeOut(t / 0.8);
  const photo = editorialPhoto(w, h).map(([x, y]) => [
    (x as number) + (1 - easeOut(t / 1)) * 30 * u,
    y as number,
  ]);
  const xs = photo.map((p) => p[0] as number);
  const ys = photo.map((p) => p[1] as number);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  ctx.save();
  polygonPath(ctx, photo);
  ctx.clip();
  boxImage(
    ctx,
    scene,
    left,
    top,
    Math.max(...xs) - left,
    Math.max(...ys) - top,
  );
  ctx.restore();
  // Two copper strokes along the diagonal cuts, running past the picture.
  ctx.save();
  ctx.strokeStyle = P;
  ctx.lineWidth = 2 * u;
  const [a, b, c, d] = photo as [number[], number[], number[], number[]];
  for (const [p, q] of [
    [a, d],
    [b, c],
  ] as const) {
    const dx = (q[0] as number) - (p[0] as number);
    const dy = (q[1] as number) - (p[1] as number);
    ctx.beginPath();
    ctx.moveTo((p[0] as number) - dx * 0.12, (p[1] as number) - dy * 0.12);
    ctx.lineTo((q[0] as number) + dx * 0.12, (q[1] as number) + dy * 0.12);
    ctx.stroke();
  }
  ctx.restore();

  const lines = songLines(scene);
  const x = w * (tall ? 0.08 : 0.07);
  const maxWidth = tall ? w * 0.84 : w * 0.46;
  const artistY = tall ? h * 0.5 : h * 0.2;
  ctx.save();
  ctx.globalAlpha = enter;
  textLine(
    ctx,
    scene,
    lines.artist,
    x + (1 - enter) * -18 * u,
    artistY,
    24 * u,
    {
      weight: 400,
      tracking: 0.4,
      color: P,
      maxWidth,
    },
  );
  const title = titleLines(ctx, scene, lines.title, maxWidth, s * 0.15);
  let ty = artistY + 30 * u + title.px * 0.62;
  for (const line of title.lines) {
    const tx = x + (1 - enter) * -18 * u;
    // A faint filled echo behind the outline.
    textLine(ctx, scene, line, tx + 10 * u, ty + 10 * u, title.px, {
      weight: 500,
      color: rgba(S, 0.22),
      shadow: false,
    });
    textLine(ctx, scene, line, tx, ty, title.px, {
      weight: 500,
      color: "#ffffff",
      outline: 2 * u,
    });
    ty += title.px * 1.04;
  }
  ctx.restore();

  // The tick strip: ninety ticks, the played part in the primary colour.
  const stripY = Math.max(ty + s * 0.05, tall ? h * 0.72 : h * 0.6);
  const n = 90;
  const values = shapedBars(scene.bands, n);
  const progress = progressOf(scene);
  const pitch = maxWidth / n;
  ctx.save();
  for (const played of [true, false]) {
    ctx.fillStyle = played ? P : "rgba(255,255,255,0.5)";
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (i / n < progress !== played) continue;
      const th = 2 * u + ease(values[i] as number) * s * 0.06;
      ctx.rect(
        x + i * pitch,
        stripY - th / 2,
        Math.max(1.5 * u, pitch * 0.35),
        th,
      );
    }
    ctx.fill();
  }
  ctx.restore();
  progressBar(ctx, scene, x, stripY + s * 0.09, maxWidth, 3 * u, P, true);
}

// ---- P14 Particelle a Forme: outline shapes flowing from a line or a ring ---------------------

function shapePath(
  ctx: Canvas2D,
  shape: ParticleShape,
  x: number,
  y: number,
  r: number,
  turn: number,
) {
  const c = Math.cos(turn);
  const sn = Math.sin(turn);
  const at = (px: number, py: number): [number, number] => [
    x + (px * c - py * sn) * r,
    y + (px * sn + py * c) * r,
  ];
  const poly = (pts: [number, number][]) => {
    pts.forEach(([px, py], i) => {
      const [X, Y] = at(px, py);
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    });
    ctx.closePath();
  };
  const ring = (count: number, inner: number | null, start: number) =>
    Array.from({ length: inner === null ? count : count * 2 }, (_, i) => {
      const a = start + (i / (inner === null ? count : count * 2)) * TAU;
      const rr = inner !== null && i % 2 === 1 ? inner : 1;
      return [Math.cos(a) * rr, Math.sin(a) * rr] as [number, number];
    });
  switch (shape) {
    case "circle":
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
      return;
    case "square":
      return poly([
        [-0.8, -0.8],
        [0.8, -0.8],
        [0.8, 0.8],
        [-0.8, 0.8],
      ]);
    case "diamond":
      return poly([
        [0, -1],
        [0.7, 0],
        [0, 1],
        [-0.7, 0],
      ]);
    case "triangle":
      return poly(ring(3, null, -Math.PI / 2));
    case "hexagon":
      return poly(ring(6, null, 0));
    case "star":
      return poly(ring(5, 0.45, -Math.PI / 2));
    case "plus": {
      const [a1, a2] = [at(-1, 0), at(1, 0)];
      const [b1, b2] = [at(0, -1), at(0, 1)];
      ctx.moveTo(a1[0], a1[1]);
      ctx.lineTo(a2[0], a2[1]);
      ctx.moveTo(b1[0], b1[1]);
      ctx.lineTo(b2[0], b2[1]);
      return;
    }
    case "heart":
      return poly(
        Array.from({ length: 28 }, (_, i) => {
          const a = (i / 28) * TAU;
          return [
            (16 * Math.sin(a) ** 3) / 17,
            -(
              13 * Math.cos(a) -
              5 * Math.cos(2 * a) -
              2 * Math.cos(3 * a) -
              Math.cos(4 * a)
            ) / 17,
          ] as [number, number];
        }),
      );
  }
}

// Shaped particle `i` at `time`: born, rising (or falling, or flying outwards) for 3.5 s and
// fading, then born again elsewhere. A pure function of time.
export function shapedParticleAt(
  i: number,
  time: number,
): {
  age: number;
  x: number;
  speed: number;
  size: number;
  turn: number;
  dir: number;
  alpha: number;
} {
  const life = 3.5;
  const offset = hash01(i * 11 + 7) * life;
  const cycle = Math.floor((time + offset) / life);
  const age = (time + offset) % life;
  const seed = i * 131 + cycle * 977;
  return {
    age,
    x: hash01(seed + 1),
    speed: 0.7 + 0.6 * hash01(seed + 2),
    size: hash01(seed + 3),
    turn: hash01(seed + 4) * TAU + time * (hash01(seed + 5) - 0.5) * 1.5,
    dir: hash01(seed + 6) < 0.5 ? -1 : 1,
    alpha: Math.max(0, Math.min(1, age / 0.4, (life - age) / 0.8)),
  };
}

function shaped(ctx: Canvas2D, scene: VisualizerScene, level: number) {
  const { w, h, s, u, tall, P, S } = sizes(scene);
  const { look } = scene.params;
  const radial = look.flow === "radial";
  const at = lookCenter(scene.params, w, h);
  const lineY = h * (tall ? 0.6 : 0.62);
  const x0 = w * 0.08;
  const x1 = w * 0.92;
  const ringR = at.r + 18 * u;
  const count =
    50 +
    Math.round(
      (Math.max(0, Math.min(100, scene.params.particles)) / 100) * 110,
    );
  const loud = 0.35 + 0.65 * ease(level);
  ctx.save();
  ctx.lineWidth = 2 * u;
  ctx.lineJoin = "round";
  for (let i = 0; i < count; i++) {
    const p = shapedParticleAt(i, scene.time);
    const speed = s * 0.12 * p.speed;
    const size = s * (0.008 + 0.012 * p.size);
    let x: number;
    let y: number;
    if (radial) {
      const a = p.x * TAU;
      const d = ringR + s * 0.06 + p.age * speed * 1.2;
      x = at.cx + Math.cos(a) * d;
      y = at.cy + Math.sin(a) * d;
    } else {
      const dir = look.flow === "up" ? -1 : look.flow === "down" ? 1 : p.dir;
      x = x0 + p.x * (x1 - x0) + Math.sin(scene.time * 1.7 + i) * 8 * u;
      y = lineY + dir * (s * 0.04 + p.age * speed);
    }
    ctx.globalAlpha = p.alpha * loud;
    ctx.strokeStyle = i % 2 ? P : S;
    ctx.beginPath();
    shapePath(ctx, look.shape, x, y, size, p.turn);
    ctx.stroke();
  }
  ctx.restore();

  // The source the shapes come from: hairlines with dot caps along a line, or round a ring.
  const n = radial ? 120 : tall ? 72 : 120;
  const values = shapedBars(scene.bands, n / 2);
  ctx.save();
  ctx.lineCap = "round";
  ctx.shadowColor = P;
  ctx.shadowBlur = 10 * u;
  ctx.lineWidth = 2 * u;
  const caps: number[][] = [];
  if (radial) {
    const g = ctx.createRadialGradient(
      at.cx,
      at.cy,
      ringR,
      at.cx,
      at.cy,
      ringR + s * 0.14,
    );
    g.addColorStop(0, P);
    g.addColorStop(1, S);
    ctx.strokeStyle = g;
    ctx.fillStyle = g;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const v = values[i < n / 2 ? i : n - 1 - i] as number;
      const len = 0.015 * s + ease(v) * s * 0.11;
      const a = -Math.PI / 2 + (i / n) * TAU;
      ctx.moveTo(at.cx + Math.cos(a) * ringR, at.cy + Math.sin(a) * ringR);
      const ex = at.cx + Math.cos(a) * (ringR + len);
      const ey = at.cy + Math.sin(a) * (ringR + len);
      ctx.lineTo(ex, ey);
      caps.push([ex, ey]);
    }
    ctx.stroke();
  } else {
    const g = hGradient(ctx, x0, x1, P, S);
    ctx.strokeStyle = g;
    ctx.fillStyle = g;
    ctx.beginPath();
    for (let j = 0; j < n; j++) {
      const t = j / (n - 1);
      const v = values[
        Math.round((1 - Math.abs(t - 0.5) * 2) * (n / 2 - 1))
      ] as number;
      const len = 3 * u + ease(v) * s * 0.1;
      const x = x0 + t * (x1 - x0);
      ctx.moveTo(x, lineY - len);
      ctx.lineTo(x, lineY + len);
      caps.push([x, lineY - len], [x, lineY + len]);
    }
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.beginPath();
  for (const [x, y] of caps) dotAt(ctx, x as number, y as number, 2.6 * u);
  ctx.fill();
  ctx.restore();
  roundImageAt(ctx, scene, at, level, false);
  thinRing(ctx, at, rgba(P, 0.9), 3 * u);
  drawTitle(
    ctx,
    scene,
    radial
      ? Math.min(h * 0.93, at.cy + ringR + s * 0.24)
      : h * (tall ? 0.8 : 0.86),
    46,
  );
}

// ---- P13 Badge Rotanti: two text rings turning in the corners, over any preset ---------------

export function drawBadges(
  ctx: Canvas2D,
  scene: VisualizerScene,
  level: number,
): void {
  const { params } = scene;
  if (!params.badges.enabled) return;
  const { w, h, s, u, P, S } = sizes(scene);
  const lines = songLines(scene);
  const text = (
    params.badges.text.trim() ||
    [lines.title, lines.artist].filter(Boolean).join(" · ") ||
    "MELLODIFAI"
  ).toUpperCase();
  const R = s * 0.075;
  const margin = s * 0.05 + R * 1.45;
  const pulse = 1 + 0.05 * kickOf(level);
  // Opposite corners in 16:9; both on top in 9:16, clear of the buttons and captions a Short
  // shows along the bottom and the right edge.
  const slots = [
    { cx: margin, cy: margin, dir: 1 },
    h > w
      ? { cx: w - margin, cy: margin, dir: -1 }
      : { cx: w - margin, cy: h - margin, dir: -1 },
  ];
  const px = 19 * u;
  ctx.save();
  ctx.font = font(scene, px, 600);
  const unit = `${text} · `;
  const unitW = ctx.measureText(unit).width || 1;
  const circ = TAU * R;
  const reps = Math.max(1, Math.floor(circ / unitW));
  const glyphs = [...unit.repeat(reps)];
  const widths = glyphs.map((g) => ctx.measureText(g).width);
  const total = widths.reduce((a, b) => a + b, 0) || 1;
  // Spread the glyphs evenly over the whole circle.
  const stretch = circ / total;
  ctx.restore();
  slots.forEach((slot, k) => {
    const turn = (slot.dir * scene.time * 24 * Math.PI) / 180;
    const r = R * pulse;
    ctx.save();
    ctx.fillStyle = "rgba(8,8,14,0.5)";
    ctx.beginPath();
    ctx.arc(slot.cx, slot.cy, r * 1.2, 0, TAU);
    ctx.fill();
    ctx.font = font(scene, px * pulse, 600);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let along = 0;
    glyphs.forEach((g, i) => {
      const gw = (widths[i] as number) * stretch;
      const a = turn + ((along + gw / 2) / circ) * TAU;
      along += gw;
      ctx.save();
      ctx.translate(slot.cx, slot.cy);
      ctx.rotate(a);
      ctx.translate(0, -r);
      ctx.fillText(g, 0, 0);
      ctx.restore();
    });
    // Outer ring of dots turning the other way.
    ctx.fillStyle = k === 0 ? P : S;
    ctx.beginPath();
    for (let i = 0; i < 40; i++) {
      const a = -turn * 1.3 + (i / 40) * TAU;
      dotAt(
        ctx,
        slot.cx + Math.cos(a) * r * 1.35,
        slot.cy + Math.sin(a) * r * 1.35,
        2.5 * u,
      );
    }
    ctx.fill();
    ctx.fillStyle = k === 0 ? P : S;
    ctx.shadowColor = k === 0 ? P : S;
    ctx.shadowBlur = 12 * u;
    starPath(ctx, slot.cx, slot.cy, r * 0.48, 5, 0.45, turn * 0.5);
    ctx.fill();
    ctx.restore();
  });
}

type Draw = (ctx: Canvas2D, scene: VisualizerScene, level: number) => void;
const DRAW: Record<LookPreset, Draw> = {
  dotline,
  burst,
  crown,
  wirering,
  lens,
  pills,
  edgebars,
  coverframe,
  playercard,
  contours,
  synthwave,
  editorial,
  shaped,
};

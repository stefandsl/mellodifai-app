import {
  type Canvas2D,
  type Gradient,
  type Picture,
  safeArea,
} from "./viz-kit.js";
import {
  LOGO_SIZE,
  type LogoPosition,
  type VisualizerLogo,
} from "./viz-params.js";

// The user's logos (Task 28): drawn by every preset, on top of the preset and under the effects,
// by the one renderer the preview and the render share. Each logo sits in its corner inside the
// 5% safe area, whole (contain fit, transparency kept), and moves along its side, away from the
// corner, past anything the frame already shows there: the badges and the preset's own text.

// A box in frame pixels.
export type Box = { left: number; top: number; right: number; bottom: number };
// A logo as drawn: its box and the picture.
export type PlacedLogo = Box & { opacity: number; picture: Picture };

export function overlaps(a: Box, b: Box, gap = 0): boolean {
  return (
    a.left < b.right + gap &&
    b.left < a.right + gap &&
    a.top < b.bottom + gap &&
    b.top < a.bottom + gap
  );
}

// The corner an overlay really takes. A Short shows its buttons and captions along the bottom
// and the right edge, so in 9:16 the bottom corners move to the top of the same side. The
// rotating badges and the logos follow the same rule.
export function overlayCorner(
  position: LogoPosition,
  size: { width: number; height: number },
): LogoPosition {
  if (size.height <= size.width) return position;
  if (position === "bottom-left") return "top-left";
  if (position === "bottom-right") return "top-right";
  return position;
}

// Space kept between a logo and what it moves past, as a share of the short side.
export const LOGO_GAP = 0.015;
// How far a logo shrinks, at most, when its side has no room for it at its size.
const SHRINK_STEPS = [1, 0.8, 0.64, 0.5];

// Where each logo goes, in order: the first takes its corner (or the nearest free place along
// that side), the second also keeps clear of the first. `taken` is what must stay visible.
// Null for a logo without a picture yet, or one that finds no room at all.
export function logoLayout(
  size: { width: number; height: number },
  logos: readonly VisualizerLogo[],
  pictures: readonly (Picture | null | undefined)[],
  taken: readonly Box[],
): (PlacedLogo | null)[] {
  const short = Math.min(size.width, size.height);
  const safe = safeArea(size);
  const gap = short * LOGO_GAP;
  const busy = [...taken];
  return logos.map((logo, i) => {
    const picture = pictures[i];
    if (!picture?.width || !picture.height) return null;
    const corner = overlayCorner(logo.position, size);
    const left = corner.endsWith("left");
    const top = corner.startsWith("top");
    const side =
      (Math.max(LOGO_SIZE.min, Math.min(LOGO_SIZE.max, logo.size)) / 100) *
      short;
    for (const k of SHRINK_STEPS) {
      const scale = (side * k) / Math.max(picture.width, picture.height);
      const w = picture.width * scale;
      const h = picture.height * scale;
      const x = left ? safe.left : safe.right - w;
      let y = top ? safe.top : safe.bottom - h;
      // Step past every box in the way, along the side and away from the corner.
      for (let guard = 0; guard <= busy.length; guard++) {
        const box = { left: x, top: y, right: x + w, bottom: y + h };
        const hit = busy.filter((b) => overlaps(box, b, gap));
        if (!hit.length) {
          const placed = { ...box, opacity: logo.opacity, picture };
          busy.push(box);
          return placed;
        }
        y = top
          ? Math.max(...hit.map((b) => b.bottom)) + gap
          : Math.min(...hit.map((b) => b.top)) - gap - h;
        if (y < safe.top || y + h > safe.bottom) break;
      }
    }
    return null;
  });
}

export function drawLogos(
  ctx: Canvas2D,
  placed: readonly (PlacedLogo | null)[],
): void {
  for (const logo of placed) {
    if (!logo) continue;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, logo.opacity / 100));
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(
      logo.picture.source as never,
      logo.left,
      logo.top,
      logo.right - logo.left,
      logo.bottom - logo.top,
    );
    ctx.restore();
  }
}

// ---- where a preset puts its text ------------------------------------------------------------

type Matrix = [number, number, number, number, number, number];

// A canvas that draws nothing and remembers the box of every line of text it is given, through
// the transforms in force. `measure` reads text widths with a real canvas, so the boxes match the
// frame's own fonts. Heights come from the font size: a line box of one size, placed by the
// baseline the text was drawn with.
export function textProbe(measure: (font: string, text: string) => number): {
  ctx: Canvas2D;
  boxes: Box[];
} {
  const boxes: Box[] = [];
  const state = {
    m: [1, 0, 0, 1, 0, 0] as Matrix,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
  };
  const stack: (typeof state)[] = [];
  const gradient: Gradient = { addColorStop: () => {} };
  const noop = () => {};
  const text = (value: string, x: number, y: number, maxWidth?: number) => {
    if (!value) return;
    const px = Number(/(\d+(?:\.\d+)?)px/u.exec(state.font)?.[1] ?? 10);
    const full = measure(state.font, value);
    const w = maxWidth === undefined ? full : Math.min(full, maxWidth);
    const align = state.textAlign;
    const x0 =
      align === "center"
        ? x - w / 2
        : align === "right" || align === "end"
          ? x - w
          : x;
    const base = state.textBaseline;
    const y0 =
      base === "top"
        ? y
        : base === "hanging"
          ? y - px * 0.1
          : base === "middle"
            ? y - px * 0.5
            : base === "bottom" || base === "ideographic"
              ? y - px
              : y - px * 0.8;
    const [a, b, c, d, e, f] = state.m;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [px0, py0] of [
      [x0, y0],
      [x0 + w, y0],
      [x0, y0 + px],
      [x0 + w, y0 + px],
    ] as const) {
      xs.push(a * px0 + c * py0 + e);
      ys.push(b * px0 + d * py0 + f);
    }
    boxes.push({
      left: Math.min(...xs),
      top: Math.min(...ys),
      right: Math.max(...xs),
      bottom: Math.max(...ys),
    });
  };
  const ctx: Canvas2D = {
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    shadowBlur: 0,
    shadowColor: "transparent",
    filter: "none",
    get font() {
      return state.font;
    },
    set font(value: string) {
      state.font = value;
    },
    get textAlign() {
      return state.textAlign;
    },
    set textAlign(value: string) {
      state.textAlign = value;
    },
    get textBaseline() {
      return state.textBaseline;
    },
    set textBaseline(value: string) {
      state.textBaseline = value;
    },
    save: () => {
      stack.push({ ...state, m: [...state.m] as Matrix });
    },
    restore: () => {
      const last = stack.pop();
      if (last) Object.assign(state, last);
    },
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    rect: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    fillRect: noop,
    clearRect: noop,
    drawImage: noop,
    fillText: text,
    strokeText: text,
    measureText: (value: string) => ({ width: measure(state.font, value) }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    translate: (x: number, y: number) => {
      const [a, b, c, d, e, f] = state.m;
      state.m = [a, b, c, d, e + a * x + c * y, f + b * x + d * y];
    },
    rotate: (angle: number) => {
      const [a, b, c, d, e, f] = state.m;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      state.m = [
        a * cos + c * sin,
        b * cos + d * sin,
        c * cos - a * sin,
        d * cos - b * sin,
        e,
        f,
      ];
    },
    scale: (x: number, y: number) => {
      const [a, b, c, d, e, f] = state.m;
      state.m = [a * x, b * x, c * y, d * y, e, f];
    },
    setTransform: (a, b, c, d, e, f) => {
      state.m = [a, b, c, d, e, f];
    },
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: noop,
  };
  return { ctx, boxes };
}

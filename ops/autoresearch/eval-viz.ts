// FROZEN evaluator of the visualizer looks (autoresearch run nov19-viz). Do not edit during the loop.
//   pnpm -s ops autoresearch/eval-viz.ts > run.log 2>&1 ; grep "^score:\|^hard_failures:" run.log
// For each golden song and each catalogue look (LOOK_PRESETS, drawn in viz-looks.ts) it draws 6
// fixed frames at 1280x720 with the shared renderer in a local Chrome (the one the visualizer
// tests use), measures every text the frame draws (box, cut, overlap, contrast against what is
// behind its glyphs) in code, and asks a local vision model (Ollama, temperature 0, seed 42) three
// yes/partly/no questions. Code checks beat the model where both exist. Zero paid calls.
// Env: VIZ_ROOT (golden, cache, frames), JURY_MODEL, OLLAMA_URL, VIZ_FRAMES (where PNGs go),
// VIZ_PRESETS (comma list, for a quick look only; the score is the full set).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import {
  ANALYSIS_RATE,
  analyseSong,
} from "../../packages/shared/src/visualizer/viz-audio.js";
import { LOOK_PRESETS } from "../../packages/shared/src/visualizer/viz-looks.js";

const REPO = resolve(import.meta.dirname, "..", "..");
const VIZ = join(REPO, "packages", "visualizer");
const require = createRequire(join(VIZ, "package.json"));
const { chromium } =
  require("@playwright/test") as typeof import("@playwright/test");
const { build } = require("esbuild") as typeof import("esbuild");

const ROOT = process.env.VIZ_ROOT ?? "E:/mellodifai/tmp/autoresearch-viz";
const GOLDEN = join(ROOT, "golden");
const CACHE = join(ROOT, "cache");
const FRAMES = process.env.VIZ_FRAMES ?? join(ROOT, "frames", "latest");
const OLLAMA = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.JURY_MODEL ?? "gemma4:e4b";
const SEED = 42;
const W = 1280;
const H = 720;
const FPS = 30;
// WCAG large-text minimum: below it a text is illegible (hard failure).
const MIN_CONTRAST = 3;
const GOOD_CONTRAST = 4.5;

// Frozen per-song settings: language name, colour swatch, stock background and centre picture.
const SONGS: Record<
  string,
  {
    lang: string;
    primary: string;
    secondary: string;
    bg: number;
    center: number;
  }
> = {
  it: {
    lang: "Italian",
    primary: "#f2333d",
    secondary: "#2ee6d6",
    bg: 1,
    center: 7,
  },
  ja: {
    lang: "Japanese",
    primary: "#ff2e93",
    secondary: "#7a5cff",
    bg: 2,
    center: 8,
  },
  ru: {
    lang: "Russian",
    primary: "#00e5ff",
    secondary: "#2f6bff",
    bg: 3,
    center: 9,
  },
  ko: {
    lang: "Korean",
    primary: "#ff7a3d",
    secondary: "#ff2e63",
    bg: 4,
    center: 10,
  },
  en: {
    lang: "English",
    primary: "#b44cff",
    secondary: "#5b2bff",
    bg: 5,
    center: 11,
  },
  ro: {
    lang: "Romanian",
    primary: "#ffb000",
    secondary: "#ff3d00",
    bg: 6,
    center: 12,
  },
};
// The 6 fixed moments: a section's first sung line, 0.6 s in. Each section has its own mood.
const MOMENTS: { section: RegExp; nth: number; mood: string }[] = [
  {
    section: /^Intro/u,
    nth: 0,
    mood: "playful and cheerful, a spoken-word intro over a light disco groove",
  },
  {
    section: /^Verse 1/u,
    nth: 0,
    mood: "deadpan and ironic, a cool, steady disco verse",
  },
  {
    section: /^Chorus/u,
    nth: 0,
    mood: "euphoric, bright, high-energy dance chorus",
  },
  {
    section: /^Bridge/u,
    nth: 0,
    mood: "tense and darker, a half-time breakdown",
  },
  {
    section: /^Final Chorus/u,
    nth: 0,
    mood: "maximum energy, celebratory, a gang-vocal final chorus",
  },
  {
    section: /^Outro/u,
    nth: 0,
    mood: "winding down, cool and slightly robotic",
  },
];

type Timing = {
  duration: number;
  sections: { name: string; tag: string; start: number; end: number }[];
  lines: {
    section: string;
    text: string;
    words: { start: number; end: number }[];
  }[];
};
type Box = {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  px: number;
  squeeze: number;
  contrast: number;
  core: number;
  cut: boolean;
  overlap: boolean;
  lyric: boolean;
};
type Rating = "yes" | "partly" | "no";
type Verdict = {
  text_legible: Rating;
  lyric_visible: Rating;
  mood_fit: Rating;
};

function sha(...parts: (string | Buffer)[]): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest("hex");
}

// Mono float samples at the analysis rate, then the render's analysis of the whole song (once).
function analysisOf(dir: string, duration: number): Buffer {
  const file = join(dir, "analysis.bin");
  if (existsSync(file)) return readFileSync(file);
  const r = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      join(dir, "master.wav"),
      "-ac",
      "1",
      "-ar",
      String(ANALYSIS_RATE),
      "-f",
      "f32le",
      "-",
    ],
    { maxBuffer: 1 << 30 },
  );
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
  const bytes = r.stdout as Buffer;
  const samples = new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.length / 4,
  );
  const out = Buffer.from(
    analyseSong(samples.slice(), ANALYSIS_RATE, FPS, Math.ceil(duration * FPS)),
  );
  writeFileSync(file, out);
  return out;
}

function momentsOf(t: Timing) {
  return MOMENTS.map((m) => {
    const section = t.sections.filter((s) => m.section.test(s.name))[m.nth];
    if (!section) throw new Error(`no section ${m.section}`);
    const line =
      t.lines.find(
        (l) =>
          (l.words[0]?.start ?? -1) >= section.start - 0.05 &&
          (l.words[0]?.start ?? 0) < section.end,
      ) ??
      t.lines.find((l) => (l.words[0]?.start ?? -1) >= section.start - 0.05);
    if (!line) throw new Error(`no line after ${section.name}`);
    const time = (line.words[0]?.start ?? section.start) + 0.6;
    return {
      name: section.name,
      time,
      frame: Math.round(time * FPS),
      lyric: line.text.trim(),
      mood: m.mood,
    };
  });
}

// The page side: the shared renderer, with fillText/strokeText recorded on the frame's canvas and
// mirrored into a mask (one colour per text), and a second pass with all text muted.
const HARNESS = `
import { createVisualizerRenderer, frameOf, historyOf, normalizeVisualizerParams, VISUALIZER_FONT, withFocus } from "@mellodifai/shared";
const P = CanvasRenderingContext2D.prototype;
const fill = P.fillText, stroke = P.strokeText;
let main = null, mute = false, mask = null, recs = [], keys = new Map();
function mirror(ctx, kind, text, x, y, mw) {
  if (!text || !String(text).trim()) return;
  text = String(text);
  const m = ctx.measureText(text);
  const s = mw !== undefined && m.width > 0 && mw < m.width ? mw / m.width : 1;
  const L = m.actualBoundingBoxLeft * s, R = m.actualBoundingBoxRight * s;
  const A = m.actualBoundingBoxAscent, D = m.actualBoundingBoxDescent;
  const t = ctx.getTransform();
  const pts = [[x - L, y - A], [x + R, y - A], [x + R, y + D], [x - L, y + D]].map(([px, py]) => [t.a * px + t.c * py + t.e, t.b * px + t.d * py + t.f]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const box = { text, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  const key = text + "|" + Math.round(box.x0) + "|" + Math.round(box.y0);
  let id = keys.get(key);
  if (!id) {
    id = recs.length + 1;
    keys.set(key, id);
    const scale = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c));
    const px = Number(/(\\d+(?:\\.\\d+)?)px/.exec(ctx.font)?.[1] ?? 10) * scale;
    recs.push({ ...box, id, px, squeeze: s });
  }
  mask.save();
  mask.setTransform(t);
  mask.globalAlpha = 1;
  mask.globalCompositeOperation = "source-over";
  mask.font = ctx.font;
  mask.textAlign = ctx.textAlign;
  mask.textBaseline = ctx.textBaseline;
  mask.direction = ctx.direction;
  try { mask.letterSpacing = ctx.letterSpacing; } catch {}
  const c = "rgb(" + ((id % 16) * 16 + 8) + "," + (Math.floor(id / 16) * 16 + 8) + ",255)";
  mask.fillStyle = c; mask.strokeStyle = c; mask.lineWidth = ctx.lineWidth; mask.shadowBlur = 0; mask.shadowColor = "transparent";
  const f = kind === "fill" ? fill : stroke;
  if (mw === undefined) f.call(mask, text, x, y); else f.call(mask, text, x, y, mw);
  mask.restore();
}
P.fillText = function (text, x, y, mw) {
  if (this.canvas === main) { if (mask) mirror(this, "fill", text, x, y, mw); if (mute) return; }
  return mw === undefined ? fill.call(this, text, x, y) : fill.call(this, text, x, y, mw);
};
P.strokeText = function (text, x, y, mw) {
  if (this.canvas === main) { if (mask) mirror(this, "stroke", text, x, y, mw); if (mute) return; }
  return mw === undefined ? stroke.call(this, text, x, y) : stroke.call(this, text, x, y, mw);
};
const canvasOf = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
const pics = new Map();
async function picture(src, subject) {
  const k = src + subject;
  if (pics.has(k)) return pics.get(k);
  const img = new Image(); img.src = src; await img.decode();
  const pic = { source: img, width: img.naturalWidth, height: img.naturalHeight };
  const out = subject ? withFocus(pic, canvasOf) : pic;
  pics.set(k, out); return out;
}
const analyses = new Map();
async function analysis(url) {
  if (!analyses.has(url)) analyses.set(url, new Uint8Array(await (await fetch(url)).arrayBuffer()));
  return analyses.get(url);
}
const lum = (r, g, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
async function renderJob(job) {
  for (const w of [300, 500, 600]) await document.fonts.load(w + " 40px \\"" + VISUALIZER_FONT + "\\"", "AБ");
  const data = await analysis(job.analysis);
  const [background, center] = await Promise.all([picture(job.background, false), picture(job.center, true)]);
  const params = normalizeVisualizerParams(job.params);
  // Fit the lyric caption inside 90% of the width, as a user would size it.
  const probe = canvasOf(8, 8).getContext("2d");
  const u = Math.min(job.width, job.height) / 1080;
  let size = 56;
  for (; size > 24; size -= 2) { probe.font = "500 " + size * u + "px \\"" + VISUALIZER_FONT + "\\", \\"Arial Narrow\\", Arial, sans-serif"; if (probe.measureText(job.lyric).width <= job.width * 0.9) break; }
  params.textLayers = [{ text: job.lyric, x: 50, y: 90, size, color: "#ffffff" }];
  const a = frameOf(data, job.frame);
  const scene = { params, width: job.width, height: job.height, time: job.frame / 30, duration: job.duration, bands: a.bands, wave: a.wave, history: historyOf(data, job.frame), title: job.title, fontFamily: VISUALIZER_FONT, images: { background, center, logos: [] } };
  const pass = (muted) => {
    const c = canvasOf(job.width, job.height);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const mk = canvasOf(job.width, job.height).getContext("2d", { willReadFrequently: true });
    main = c; mute = muted; mask = muted ? null : mk; recs = []; keys = new Map();
    createVisualizerRenderer(canvasOf)(ctx, scene);
    main = null; mask = null;
    return { c, ctx, mk, recs };
  };
  const on = pass(false);
  const off = pass(true);
  const A = on.ctx.getImageData(0, 0, job.width, job.height).data;
  const B = off.ctx.getImageData(0, 0, job.width, job.height).data;
  const M = on.mk.getImageData(0, 0, job.width, job.height).data;
  const ratios = new Map();
  for (let i = 0; i < M.length; i += 4) {
    if (M[i + 3] < 128 || M[i + 2] < 250) continue;
    const id = (M[i] >> 4) + (M[i + 1] >> 4) * 16;
    const la = lum(A[i], A[i + 1], A[i + 2]), lb = lum(B[i], B[i + 1], B[i + 2]);
    const r = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    if (!ratios.has(id)) ratios.set(id, []);
    ratios.get(id).push(r);
  }
  const boxes = on.recs.map((b) => {
    const rs = (ratios.get(b.id) ?? []).sort((x, y) => x - y);
    const contrast = rs.length >= 3 ? rs[Math.floor(rs.length / 2)] : 1;
    return { text: b.text, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, px: b.px, squeeze: b.squeeze, contrast, core: rs.length };
  });
  return { png: on.c.toDataURL("image/png"), boxes };
}
Object.assign(window, { renderJob });
`;

const RATING: Record<Rating, number> = { yes: 1, partly: 0.5, no: 0 };

async function judge(
  png: Buffer,
  lang: string,
  lyric: string,
  mood: string,
): Promise<Verdict & { cached: boolean }> {
  const prompt = [
    `This is one 1280x720 frame of a music visualizer video for a song in ${lang}.`,
    `The lyric line being sung is shown as a caption near the bottom: "${lyric}".`,
    `The music at this moment is: ${mood}.`,
    `Rate three things with "yes", "partly" or "no":`,
    `- text_legible: every piece of text in the frame is easy to read (sharp, large enough, strong contrast, not covered by graphics or other text).`,
    `- lyric_visible: the caption is fully visible, easy to read and not cut off at the frame edges.`,
    `- mood_fit: the colours, shapes and energy of the picture fit the music described.`,
    `Answer only with JSON: {"text_legible": "...", "lyric_visible": "...", "mood_fit": "..."}`,
  ].join("\n");
  const key = sha(MODEL, prompt, png);
  const file = join(CACHE, `${key}.json`);
  if (existsSync(file))
    return {
      ...(JSON.parse(readFileSync(file, "utf8")) as Verdict),
      cached: true,
    };
  const rating = { type: "string", enum: ["yes", "partly", "no"] };
  const response = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      think: false,
      format: {
        type: "object",
        properties: {
          text_legible: rating,
          lyric_visible: rating,
          mood_fit: rating,
        },
        required: ["text_legible", "lyric_visible", "mood_fit"],
      },
      options: { temperature: 0, seed: SEED, num_ctx: 8192, num_predict: 64 },
      messages: [
        {
          role: "system",
          content:
            "You are a strict graphics jury for music visualizer video frames. Answer only with JSON.",
        },
        { role: "user", content: prompt, images: [png.toString("base64")] },
      ],
    }),
  });
  if (!response.ok)
    throw new Error(`ollama ${response.status}: ${await response.text()}`);
  const json = (await response.json()) as { message?: { content?: string } };
  const v = JSON.parse(json.message?.content ?? "{}") as Partial<Verdict>;
  const pick = (r: unknown): Rating =>
    r === "yes" || r === "partly" || r === "no" ? r : "no";
  const verdict: Verdict = {
    text_legible: pick(v.text_legible),
    lyric_visible: pick(v.lyric_visible),
    mood_fit: pick(v.mood_fit),
  };
  writeFileSync(file, JSON.stringify(verdict));
  return { ...verdict, cached: false };
}

function codeChecks(
  raw: Omit<Box, "cut" | "overlap" | "lyric">[],
  lyric: string,
): Box[] {
  const boxes: Box[] = raw.map((b, i) => ({
    ...b,
    // Outside the frame, or shortened with an ellipsis (the words are cut).
    cut:
      b.x0 < -1 ||
      b.y0 < -1 ||
      b.x1 > W + 1 ||
      b.y1 > H + 1 ||
      (/(\.\.\.|…)$/u.test(b.text) && !/(\.\.\.|…)$/u.test(lyric)),
    overlap: false,
    lyric: i === raw.length - 1 && b.text === lyric,
  }));
  const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i] as Box;
      const b = boxes[j] as Box;
      if (a.text === b.text) continue;
      const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (ix > 0 && iy > 0 && ix * iy > 0.1 * Math.min(area(a), area(b))) {
        a.overlap = true;
        b.overlap = true;
      }
    }
  return boxes;
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(FRAMES, { recursive: true });
  const looks = process.env.VIZ_PRESETS
    ? process.env.VIZ_PRESETS.split(",")
    : [...LOOK_PRESETS];
  const songs = Object.keys(SONGS);
  const inputs: Buffer[] = [];
  const plan = songs.map((id) => {
    const dir = join(GOLDEN, id);
    const timingRaw = readFileSync(join(dir, "timing.json"));
    const timing = JSON.parse(timingRaw.toString("utf8")) as Timing;
    const analysis = analysisOf(dir, timing.duration);
    const title = readFileSync(join(dir, "title.txt"), "utf8").trim();
    inputs.push(timingRaw, analysis, Buffer.from(title));
    return { id, dir, timing, title, moments: momentsOf(timing) };
  });
  const stock = join(VIZ, "stock");
  for (const f of readdirSync(stock).sort())
    inputs.push(readFileSync(join(stock, f)));
  console.log(
    `golden: ${sha(...inputs).slice(0, 16)} songs=${songs.join(",")} looks=${looks.length} model=${MODEL}`,
  );

  const outDir = join(ROOT, "build");
  mkdirSync(outDir, { recursive: true });
  await build({
    stdin: { contents: HARNESS, resolveDir: join(VIZ, "test"), loader: "ts" },
    bundle: true,
    format: "iife",
    outfile: join(outDir, "harness.js"),
    logLevel: "silent",
  });
  writeFileSync(
    join(outDir, "index.html"),
    '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/font/300.css"><link rel="stylesheet" href="/font/500.css"><link rel="stylesheet" href="/font/600.css"><body><script src="/build/harness.js"></script></body>',
  );
  const fontDir = dirname(require.resolve("@fontsource/oswald/300.css"));
  const types: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".jpg": "image/jpeg",
    ".bin": "application/octet-stream",
  };
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0] as string);
    const [, top, ...rest] = url.split("/");
    const base =
      top === "font"
        ? fontDir
        : top === "build"
          ? outDir
          : top === "stock"
            ? stock
            : top === "golden"
              ? GOLDEN
              : null;
    const file = base ? resolve(base, ...rest) : "";
    if (!base || !file.startsWith(resolve(base)) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
    });
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    args: [
      "--disable-gpu",
      "--disable-accelerated-2d-canvas",
      "--force-color-profile=srgb",
      "--font-render-hinting=none",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.goto(`${origin}/build/index.html`);
  await page.waitForFunction(() => "renderJob" in window);

  const per: Record<string, number[]> = {};
  let hard = 0;
  let judged = 0;
  let cached = 0;
  const totals = {
    contrast: 0,
    layout: 0,
    legible: 0,
    lyric: 0,
    mood: 0,
    n: 0,
  };
  const rows: string[] = [];
  const started = Date.now();
  for (const song of plan) {
    const s = SONGS[song.id] as (typeof SONGS)[string];
    for (const preset of looks) {
      for (const [k, m] of song.moments.entries()) {
        const job = {
          width: W,
          height: H,
          frame: m.frame,
          duration: song.timing.duration,
          title: song.title,
          lyric: m.lyric,
          analysis: `${origin}/golden/${song.id}/analysis.bin`,
          background: `${origin}/stock/bg-${String(s.bg).padStart(2, "0")}.jpg`,
          center: `${origin}/stock/bg-${String(s.center).padStart(2, "0")}.jpg`,
          params: {
            preset,
            aspect: "16:9",
            quality: "1080p",
            background: {
              mode: "random",
              seed: s.bg - 1,
              assetUrl: null,
              dimming: 60,
            },
            colors: { primary: s.primary, secondary: s.secondary },
            particles: 30,
            centerImage: { mode: "cover", assetUrl: null, fit: "cover" },
            textLayers: [],
            effects: [],
            classico: {
              artist: "MellodifAI",
              website: "",
              album: "Golden Set",
              cards: true,
            },
          },
        };
        const out = (await page.evaluate(
          (j) =>
            (
              window as unknown as {
                renderJob: (x: unknown) => Promise<unknown>;
              }
            ).renderJob(j),
          job,
        )) as { png: string; boxes: Omit<Box, "cut" | "overlap" | "lyric">[] };
        const png = Buffer.from(out.png.split(",")[1] as string, "base64");
        writeFileSync(join(FRAMES, `${song.id}-${preset}-${k}.png`), png);
        const boxes = codeChecks(out.boxes, m.lyric);
        const lyricBox = boxes.find((b) => b.lyric);
        const bad = boxes.filter(
          (b) => b.cut || b.contrast < MIN_CONTRAST || b.squeeze < 0.7,
        );
        const contrast = boxes.length
          ? boxes.reduce(
              (t, b) =>
                t +
                Math.max(
                  0,
                  Math.min(1, (b.contrast - 1) / (GOOD_CONTRAST - 1)),
                ),
              0,
            ) / boxes.length
          : 1;
        const layout = boxes.length
          ? boxes.filter((b) => !b.cut && !b.overlap && b.squeeze >= 0.7)
              .length / boxes.length
          : 1;
        const v = await judge(png, s.lang, m.lyric, m.mood);
        if (v.cached) cached++;
        else judged++;
        // Code beats the model: a text the code finds cut or below 3:1 is not legible, whatever
        // the model says; the same for the caption.
        const legible = bad.length ? 0 : RATING[v.text_legible];
        const lyricOk =
          lyricBox && !lyricBox.cut && lyricBox.contrast >= MIN_CONTRAST
            ? RATING[v.lyric_visible]
            : 0;
        const mood = RATING[v.mood_fit];
        const score =
          100 *
          (0.2 * contrast +
            0.15 * layout +
            0.2 * legible +
            0.2 * lyricOk +
            0.25 * mood);
        if (bad.length) hard++;
        per[preset] = [...(per[preset] ?? []), score];
        totals.contrast += contrast;
        totals.layout += layout;
        totals.legible += legible;
        totals.lyric += lyricOk;
        totals.mood += mood;
        totals.n++;
        rows.push(
          `${song.id}\t${preset}\t${k}\t${score.toFixed(1)}\t${v.text_legible}/${v.lyric_visible}/${v.mood_fit}\t${bad
            .map(
              (b) =>
                `${b.cut ? "CUT" : b.squeeze < 0.7 ? "SQZ" : "LOW"}:${b.contrast.toFixed(2)}:${b.text.slice(0, 24)}`,
            )
            .join(" | ")}`,
        );
      }
    }
  }
  await browser.close();
  server.close();
  writeFileSync(join(FRAMES, "frames.tsv"), `${rows.join("\n")}\n`);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  for (const p of looks)
    console.log(`preset: ${p} ${mean(per[p] as number[]).toFixed(2)}`);
  const n = totals.n;
  console.log(
    `parts: contrast=${(totals.contrast / n).toFixed(3)} layout=${(totals.layout / n).toFixed(3)} legible=${(totals.legible / n).toFixed(3)} lyric=${(totals.lyric / n).toFixed(3)} mood=${(totals.mood / n).toFixed(3)}`,
  );
  console.log(
    `frames: ${n} judged=${judged} cached=${cached} seconds=${((Date.now() - started) / 1000).toFixed(0)}`,
  );
  console.log(`hard_failures: ${hard}`);
  console.log(`score: ${mean(Object.values(per).flat()).toFixed(2)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

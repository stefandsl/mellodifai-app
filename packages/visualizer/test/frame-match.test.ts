import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import {
  ANALYSIS_RATE,
  analyseSong,
  defaultVisualizerParams,
  VISUALIZER_PRESETS,
  type VisualizerParams,
} from "@mellodifai/shared";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSharedSources } from "../webpack-override";
import { SIGNAL_SECONDS, testSignal } from "./signal";

// Item G's snapshot test: frame N of each preset rendered by the Remotion composition (what the
// render PC makes) against the same frame drawn by the preview path in Chrome (a real
// AnalyserNode read by the studio's code, then the shared renderer). They must match within a
// small tolerance: the analyser emulation, the smoothing and the drawing are shared, what is
// left is anti-aliasing and the analyser's 128-sample clock.

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const brand = resolve(pkg, "../../apps/web/public/brand");
const require = createRequire(join(pkg, "package.json"));
const { chromium } =
  require("@playwright/test") as typeof import("@playwright/test");
const SHELL =
  "C:\\Users\\Asus\\Documents\\suno-remake\\motion\\node_modules\\.remotion\\chrome-headless-shell\\win64\\chrome-headless-shell-win64\\chrome-headless-shell.exe";
const FRAME = 75;
const SCALE = 0.5;

let dir: string;
let server: Server;
let origin: string;
let serveUrl: string;
let browser: Awaited<ReturnType<typeof chromium.launch>>;
let page: Awaited<ReturnType<typeof browser.newPage>>;

// A small RGB PNG from a pixel function: the 16:9 centre picture, with its subject off to the
// left, that the cover fit and the subject crop are checked with.
function png(
  width: number,
  height: number,
  at: (x: number, y: number) => [number, number, number],
): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = at(x, y);
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
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
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function wav(samples: Float32Array, rate: number): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++)
    data.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, samples[i] as number)) * 32767),
      i * 2,
    );
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

beforeAll(async () => {
  await mkdir("E:/mellodifai/render-tmp", { recursive: true });
  dir = resolve(await mkdtemp("E:/mellodifai/render-tmp/frame-match-"));
  const pub = join(dir, "public");
  await mkdir(pub, { recursive: true });
  const samples = testSignal();
  await writeFile(join(pub, "audio.wav"), wav(samples, ANALYSIS_RATE));
  await writeFile(
    join(pub, "analysis.bin"),
    analyseSong(samples, ANALYSIS_RATE, 30, SIGNAL_SECONDS * 30),
  );
  await copyFile(
    join(brand, "mellodifai-trumpet.png"),
    join(pub, "trumpet.png"),
  );
  await copyFile(
    join(brand, "mellodifai-logo.png"),
    join(pub, "gramophone.png"),
  );
  await copyFile(join(brand, "mellodifai-logo.png"), join(pub, "center.png"));
  await writeFile(
    join(pub, "center169.png"),
    png(640, 360, (x, y) => {
      const inBlock = x > 90 && x < 250 && y > 80 && y < 280;
      const stripe = (x + y) % 40 < 4;
      return inBlock ? [240, 40, 50] : stripe ? [40, 90, 110] : [14, 14, 22];
    }),
  );
  await copyFile(
    join(brand, "mellodifai-trumpet.png"),
    join(pub, "background.png"),
  );

  serveUrl = await bundle({
    entryPoint: join(pkg, "src", "index.ts"),
    publicDir: pub,
    outDir: join(dir, "bundle"),
    enableCaching: false,
    webpackOverride: withSharedSources,
  });

  // The preview harness: the studio's analyser code and the shared renderer, for Chrome.
  await build({
    entryPoints: [join(here, "harness.ts")],
    bundle: true,
    format: "iife",
    outfile: join(dir, "harness.js"),
    logLevel: "silent",
  });
  await writeFile(
    join(dir, "harness.html"),
    '<!doctype html><meta charset="utf-8"><body><script src="harness.js"></script></body>',
  );
  await mkdir(join(dir, "fonts"), { recursive: true });
  for (const w of [300, 500, 600])
    await copyFile(
      require.resolve(
        `@fontsource/oswald/files/oswald-latin-${w}-normal.woff2`,
      ),
      join(dir, "fonts", `oswald-${w}.woff2`),
    );
  // Served over http: pictures read from file:// would taint the preview canvas.
  const types: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".png": "image/png",
    ".woff2": "font/woff2",
  };
  server = createServer((req, res) => {
    const path = join(
      dir,
      decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/"),
    );
    if (!path.startsWith(dir)) return void res.writeHead(403).end();
    readFile(path).then(
      (body) =>
        res
          .writeHead(200, {
            "content-type": types[extname(path)] ?? "application/octet-stream",
          })
          .end(body),
      () => res.writeHead(404).end(),
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(`${origin}/harness.html`);
});

afterAll(async () => {
  await browser?.close();
  server?.close();
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
});

const fonts = () =>
  Object.fromEntries(
    [300, 500, 600].map((w) => [
      String(w),
      `${origin}/fonts/oswald-${w}.woff2`,
    ]),
  );

let shots = 0;
async function compareFrame(
  params: VisualizerParams,
  previewParams: VisualizerParams = params,
  centerFile = "center.png",
) {
  const props = {
    params,
    title: "Astri lounge",
    duration: SIGNAL_SECONDS,
    frames: SIGNAL_SECONDS * 30,
    audio: "audio.wav",
    analysis: "analysis.bin",
    background: { file: "background.png", kind: "image" as const },
    center: centerFile,
    trumpet: "trumpet.png",
    gramophone: "gramophone.png",
  };
  const composition = await selectComposition({
    serveUrl,
    id: "Visualizer",
    inputProps: props,
    browserExecutable: SHELL,
  });
  const out = join(
    dir,
    `${params.preset}-${params.aspect.replace(":", "x")}-${shots++}.png`,
  );
  await renderStill({
    composition,
    serveUrl,
    output: out,
    frame: FRAME,
    inputProps: props,
    imageFormat: "png",
    scale: SCALE,
    browserExecutable: SHELL,
  });
  const pub = `${origin}/public`;
  const preview = await page.evaluate(
    ([job, files]) =>
      (
        window as unknown as {
          previewFrame: (j: unknown, f: unknown) => Promise<string>;
        }
      ).previewFrame(job, files),
    [
      {
        params: previewParams,
        frame: FRAME,
        width: Math.round(composition.width * SCALE),
        height: Math.round(composition.height * SCALE),
        title: props.title,
        duration: props.duration,
      },
      {
        background: `${pub}/background.png`,
        center: `${pub}/${centerFile}`,
        trumpet: `${pub}/trumpet.png`,
        gramophone: `${pub}/gramophone.png`,
        fonts: JSON.stringify(fonts()),
      },
    ] as const,
  );
  return page.evaluate(
    ([a, b]) =>
      (
        window as unknown as {
          compare: (
            a: string,
            b: string,
          ) => Promise<{ mean: number; far: number }>;
        }
      ).compare(a, b),
    [
      `${origin}/${out.slice(dir.length + 1).replaceAll("\\", "/")}`,
      preview,
    ] as const,
  );
}

describe("preview and render draw the same frame", () => {
  const base = defaultVisualizerParams();
  const cases: [string, VisualizerParams][] = [
    ...VISUALIZER_PRESETS.map((preset): [string, VisualizerParams] => [
      `${preset} 16:9`,
      { ...base, preset },
    ]),
    ["classico 9:16", { ...base, preset: "classico", aspect: "9:16" }],
    [
      "spectrum 16:9 with effects",
      {
        ...base,
        preset: "spectrum",
        particles: 80,
        effects: base.effects.map((e) => ({
          ...e,
          enabled: ["grain", "scanlines", "vignette", "aberration"].includes(
            e.id,
          ),
          intensity: 70,
        })),
      },
    ],
    // The catalogue looks' variants and the badges overlay, some in 9:16.
    [
      "crown one-sided bars 9:16",
      {
        ...base,
        preset: "crown",
        aspect: "9:16",
        look: { ...base.look, teeth: "bar", mirrored: false },
      },
    ],
    [
      "crown pins with badges 16:9",
      {
        ...base,
        preset: "crown",
        look: { ...base.look, teeth: "pin" },
        badges: { enabled: true, text: "Nuovo singolo" },
      },
    ],
    [
      "contours ridges 16:9",
      {
        ...base,
        preset: "contours",
        look: { ...base.look, contour: "ridges" },
      },
    ],
    [
      "shaped hearts from a ring 9:16",
      {
        ...base,
        preset: "shaped",
        aspect: "9:16",
        look: { ...base.look, shape: "heart", flow: "radial" },
      },
    ],
    ["playercard 9:16", { ...base, preset: "playercard", aspect: "9:16" }],
    ["synthwave 9:16", { ...base, preset: "synthwave", aspect: "9:16" }],
    ["editorial 9:16", { ...base, preset: "editorial", aspect: "9:16" }],
  ];
  for (const [name, params] of cases)
    it(name, async () => {
      const diff = await compareFrame(params);
      expect(diff.mean).toBeLessThan(4);
      expect(diff.far).toBeLessThan(0.02);
    });

  // Task 26: the presets with a round or square cover, fed a 16:9 picture whose subject sits
  // on the left, in both cover fits; the contour lines with their lifted ink; titles in 9:16.
  const wide = (
    preset: VisualizerParams["preset"],
    fit: "cover" | "contain",
    aspect: "16:9" | "9:16",
  ): VisualizerParams => ({
    ...base,
    preset,
    aspect,
    centerImage: { ...base.centerImage, fit },
  });
  const polished: [string, VisualizerParams][] = [
    ["dotline cover crop 16:9", wide("dotline", "cover", "16:9")],
    ["wirering cover crop 9:16", wide("wirering", "cover", "9:16")],
    ["contours cover crop 16:9", wide("contours", "cover", "16:9")],
    ["contours contain 9:16", wide("contours", "contain", "9:16")],
    ["circle contain 16:9", wide("circle", "contain", "16:9")],
    ["crown contain 16:9", wide("crown", "contain", "16:9")],
    ["coverframe cover crop 16:9", wide("coverframe", "cover", "16:9")],
    ["coverframe contain 9:16", wide("coverframe", "contain", "9:16")],
    ["edgebars cover crop 16:9", wide("edgebars", "cover", "16:9")],
    ["lens 9:16", wide("lens", "cover", "9:16")],
    ["pills 16:9", wide("pills", "cover", "16:9")],
    ["dotline 9:16", wide("dotline", "cover", "9:16")],
    ["burst 9:16", wide("burst", "cover", "9:16")],
    [
      "contours ridges on the mono colours 16:9",
      {
        ...wide("contours", "cover", "16:9"),
        colors: { primary: "#ffffff", secondary: "#8a8a8a" },
        look: { ...base.look, contour: "ridges" },
      },
    ],
    [
      "contours rings on the ocean colours, thick and faint 9:16",
      {
        ...wide("contours", "cover", "9:16"),
        colors: { primary: "#1fb6ff", secondary: "#0a3d91" },
        look: { ...base.look, contourWeight: 5, contourOpacity: 60 },
      },
    ],
  ];
  for (const [name, params] of polished)
    it(name, async () => {
      const diff = await compareFrame(params, params, "center169.png");
      expect(diff.mean).toBeLessThan(4);
      expect(diff.far).toBeLessThan(0.02);
    });

  it("notices a frame that differs", async () => {
    const render = { ...defaultVisualizerParams(), preset: "mirror" as const };
    const other = {
      ...render,
      colors: { primary: "#00ff00", secondary: "#0000ff" },
    };
    const diff = await compareFrame(render, other);
    expect(diff.far).toBeGreaterThan(0.02);
  });
});

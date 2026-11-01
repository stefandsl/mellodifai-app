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
) {
  const props = {
    params,
    title: "Astri lounge",
    duration: SIGNAL_SECONDS,
    frames: SIGNAL_SECONDS * 30,
    audio: "audio.wav",
    analysis: "analysis.bin",
    background: { file: "background.png", kind: "image" as const },
    center: "center.png",
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
        center: `${pub}/center.png`,
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

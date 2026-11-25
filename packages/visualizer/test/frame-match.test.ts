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
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { withSharedSources } from "../webpack-override";
import {
  testBackground,
  testCenter,
  testCenterWide,
  testLogo,
} from "./fixtures";
import { SIGNAL_SECONDS, testSignal } from "./signal";

// Item G's snapshot test: frame N of each preset rendered by the Remotion composition (what the
// render PC makes) against the same frame drawn by the preview path in Chrome (a real
// AnalyserNode read by the studio's code, then the shared renderer). They must match within a
// small tolerance: the analyser emulation, the smoothing and the drawing are shared, what is
// left is anti-aliasing and the analyser's 128-sample clock.

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const require = createRequire(join(pkg, "package.json"));
const { chromium } =
  require("@playwright/test") as typeof import("@playwright/test");
const SHELL = chromium.executablePath();
const FRAME = 75;

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
  const runtime = join(
    process.env.RUNNER_TEMP ?? process.env.MELLODIFAI_ROOT ?? "E:/mellodifai",
    "render-tmp",
  );
  await mkdir(runtime, { recursive: true });
  dir = resolve(await mkdtemp(join(runtime, "frame-match-")));
  const pub = join(dir, "public");
  await mkdir(pub, { recursive: true });
  const samples = testSignal();
  await writeFile(join(pub, "audio.wav"), wav(samples, ANALYSIS_RATE));
  await writeFile(
    join(pub, "analysis.bin"),
    analyseSong(samples, ANALYSIS_RATE, 30, SIGNAL_SECONDS * 30),
  );
  // Neutral pictures drawn for the test (fixtures.ts), never the app's own artwork.
  await writeFile(join(pub, "background.png"), testBackground());
  await writeFile(join(pub, "center.png"), testCenter());
  await writeFile(join(pub, "center169.png"), testCenterWide());
  await writeFile(join(pub, "logo.png"), testLogo());

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
  // Compare both paths with the same browser binary and headless implementation.
  browser = await chromium.launch({ executablePath: SHELL });
});

// Each comparison owns its fonts, canvases and suspended Web Audio contexts.
beforeEach(async () => {
  page = await browser.newPage();
  await page.goto(`${origin}/harness.html`);
});
afterEach(async () => {
  await page?.close();
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
  const logos = params.logos.map(() => "logo.png");
  const props = {
    params,
    title: "Astri lounge",
    duration: SIGNAL_SECONDS,
    frames: SIGNAL_SECONDS * 30,
    audio: "audio.wav",
    analysis: "analysis.bin",
    background: { file: "background.png", kind: "image" as const },
    center: centerFile,
    logos,
  };
  const composition = await selectComposition({
    serveUrl,
    id: "Visualizer",
    inputProps: props,
    browserExecutable: SHELL,
  });
  const scale = params.quality === "4K" ? 0.25 : 0.5;
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
    scale,
    browserExecutable: SHELL,
  });
  // Compare pixels, without a second HTTP fetch of the same generated PNG fixtures.
  const picture = async (file: string) =>
    `data:image/png;base64,${(await readFile(join(dir, "public", file))).toString("base64")}`;
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
        width: Math.round(composition.width * scale),
        height: Math.round(composition.height * scale),
        title: props.title,
        duration: props.duration,
      },
      {
        background: await picture("background.png"),
        center: await picture(centerFile),
        logos: JSON.stringify(await Promise.all(logos.map(picture))),
        fonts: JSON.stringify(fonts()),
      },
    ] as const,
  );
  const diff = await page.evaluate(
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
  return { ...diff, render: out, preview };
}

// Assert a matching frame; on a mismatch keep both frames for the CI artifact.
async function expectSameFrame(
  name: string,
  diff: Awaited<ReturnType<typeof compareFrame>>,
) {
  const keep = process.env.E2E_SCREENSHOT_DIR;
  if (keep && (diff.mean >= 4 || diff.far >= 0.02)) {
    const target = join(keep, "frame-match");
    await mkdir(target, { recursive: true });
    const stem = name.replace(/[^\w-]+/g, "_");
    await copyFile(diff.render, join(target, `${stem}-render.png`));
    await writeFile(
      join(target, `${stem}-preview.png`),
      Buffer.from(diff.preview.split(",")[1] ?? "", "base64"),
    );
  }
  expect(diff.mean).toBeLessThan(4);
  expect(diff.far).toBeLessThan(0.02);
}

describe("preview and render draw the same frame", () => {
  const base = defaultVisualizerParams();
  const cases: [string, VisualizerParams][] = [
    ...VISUALIZER_PRESETS.map((preset): [string, VisualizerParams] => [
      `${preset} 16:9`,
      { ...base, preset },
    ]),
    ["classico 9:16", { ...base, preset: "classico", aspect: "9:16" }],
    ["circle 4K 16:9", { ...base, preset: "circle", quality: "4K" }],
    [
      "classico 4K 9:16",
      { ...base, preset: "classico", aspect: "9:16", quality: "4K" },
    ],
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
      await expectSameFrame(name, await compareFrame(params));
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
      await expectSameFrame(
        name,
        await compareFrame(params, params, "center169.png"),
      );
    });

  // Task 28: the user's logos, one corner each, in both aspects, over presets with text near
  // the corners (Classico's cards, the player looks, the centred titles).
  const logo = (
    preset: VisualizerParams["preset"],
    aspect: "16:9" | "9:16",
    position: VisualizerParams["logos"][number]["position"],
    size = 12,
    opacity = 100,
  ): VisualizerParams => ({
    ...base,
    preset,
    aspect,
    classico: { ...base.classico, artist: "Lucia", album: "Lampioni" },
    logos: [{ assetUrl: "/media/uploads/u/logo.png", position, size, opacity }],
  });
  const withLogos: [string, VisualizerParams][] = [
    ["classico logo top left 16:9", logo("classico", "16:9", "top-left")],
    [
      "playercard logo top right 16:9",
      logo("playercard", "16:9", "top-right", 20),
    ],
    [
      "dotline logo bottom left 16:9",
      logo("dotline", "16:9", "bottom-left", 30),
    ],
    [
      "circle logo bottom right at 60% 16:9",
      logo("circle", "16:9", "bottom-right", 12, 60),
    ],
    ["classico logo top right 9:16", logo("classico", "9:16", "top-right", 20)],
    ["playercard logo top left 9:16", logo("playercard", "9:16", "top-left")],
    [
      "dotline logo bottom left 9:16",
      logo("dotline", "9:16", "bottom-left", 30),
    ],
    ["circle logo bottom right 9:16", logo("circle", "9:16", "bottom-right")],
    [
      "circle 4K logo and scanlines 16:9",
      {
        ...logo("circle", "16:9", "top-right", 20),
        quality: "4K",
        effects: base.effects.map((effect) => ({
          ...effect,
          enabled: effect.id === "scanlines" || effect.id === "vignette",
        })),
      },
    ],
  ];
  for (const [name, params] of withLogos)
    it(name, async () => {
      await expectSameFrame(name, await compareFrame(params));
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

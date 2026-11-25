#!/usr/bin/env node
// Measure layout structure of a public site page at 1440, 1024 and 390 px and render grey layout strips.
// Measures structure and geometry only (section order, content column, insets, main grid).
// No text, media, colours or fonts are stored in the output.
//
// Usage:
//   node apps/web/scripts/site-study/measure.mjs --base <url> --slug <slug> --out <dir> [--route <route>] [--ref <path>] [--widths 1440,1024,390] [--lang en]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { chromium } from "@playwright/test";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(SCRIPT_DIR, "../..");
const DEFAULT_REF_DIR = join(WEB_DIR, "e2e", "site", "layout-ref");

export const WIDTH_VIEWPORTS = {
  1440: { width: 1440, height: 900 },
  1024: { width: 1024, height: 768 },
  390: { width: 390, height: 844 },
};

export const DEFAULT_WIDTHS = [1440, 1024, 390];
export const STRIP_H = 160;

const R = Math.round;

// ---- minimal greyscale RGB PNG writer (8-bit, deterministic, zero external deps) ----

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * @param {Buffer} buf
 * @returns {number}
 */
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) {
    c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {string} type
 * @param {Buffer} data
 * @returns {Buffer}
 */
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, checksum]);
}

/**
 * Encode an 8-bit greyscale pixel array into an RGB PNG buffer.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} pixels
 * @returns {Buffer}
 */
export function encodePng(width, height, pixels) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x += 1) {
      const v = pixels[y * width + x];
      const offset = y * stride + 1 + x * 3;
      raw[offset] = v;
      raw[offset + 1] = v;
      raw[offset + 2] = v;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * @param {string} file
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} pixels
 */
export function writePng(file, width, height, pixels) {
  writeFileSync(file, encodePng(width, height, pixels));
}

/**
 * Draw one layout strip (STRIP_H px tall, page width wide) from numeric section geometry only:
 * - rows 0..39: black gutters from 0 to contentLeft and from (width - contentRight) to width
 * - rows 40..119: main grid first row, one grey block per item (true x and width)
 * - rows 120..159: four 10 px bars: topInset, bottomInset, colGap, rowGap
 * @param {{ present?: boolean, contentLeft?: number, contentRight?: number, topInset?: number, bottomInset?: number, grid?: { perRow: number, x: number, itemW: number, colGap: number, rowGap: number } | null }} sec
 * @param {number} width
 * @returns {Uint8Array}
 */
export function renderStrip(sec, width) {
  const px = new Uint8Array(width * STRIP_H).fill(255);
  const rect = (x0, y0, x1, y1, v) => {
    const startY = Math.max(0, y0);
    const endY = Math.min(STRIP_H, y1);
    const startX = Math.max(0, R(x0));
    const endX = Math.min(width, R(x1));
    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        px[y * width + x] = v;
      }
    }
  };
  if (!sec.present) {
    rect(0, 0, width, STRIP_H, 0);
    return px;
  }
  if (sec.contentLeft != null && sec.contentRight != null) {
    rect(0, 0, sec.contentLeft, 40, 0);
    rect(width - sec.contentRight, 0, width, 40, 0);
  }
  if (sec.grid) {
    const g = sec.grid;
    for (let i = 0; i < g.perRow; i += 1) {
      const x0 = g.x + i * (g.itemW + g.colGap);
      rect(x0, 40, x0 + g.itemW, 120, 110);
    }
  }
  const bars = [
    sec.topInset,
    sec.bottomInset,
    sec.grid ? sec.grid.colGap : 0,
    sec.grid ? sec.grid.rowGap : 0,
  ];
  bars.forEach((v, i) => {
    rect(0, 120 + i * 10, Math.max(0, v || 0), 130 + i * 10, 60);
  });
  return px;
}

/**
 * Render all strips for a layout-ref object into <outDir>/strips/<width>/<NN>.png.
 * @param {{ widths: Record<string, { sections: Array<Record<string, unknown>> }> }} ref
 * @param {string} outDir
 * @returns {number}
 */
export function writeStripsForRef(ref, outDir) {
  let count = 0;
  for (const [wKey, data] of Object.entries(ref.widths)) {
    const w = Number(wKey);
    if (!Number.isInteger(w) || w <= 0) {
      throw new Error(`Invalid width key in layout-ref: ${wKey}`);
    }
    const sdir = join(outDir, "strips", String(w));
    mkdirSync(sdir, { recursive: true });
    const sections = data.sections ?? [];
    const all = new Uint8Array(w * STRIP_H * Math.max(1, sections.length));
    sections.forEach((sec, i) => {
      const px = renderStrip(sec, w);
      writePng(join(sdir, `${String(i).padStart(2, "0")}.png`), w, STRIP_H, px);
      all.set(px, i * w * STRIP_H);
      count += 1;
    });
    if (sections.length > 0) {
      writePng(
        join(outDir, "strips", `all-${w}.png`),
        w,
        STRIP_H * sections.length,
        all,
      );
    }
  }
  return count;
}

/**
 * Runs inside the browser (Playwright page.evaluate). Self-contained because Playwright serialises it.
 * Supports `data-ref-section="N"`, `data-ref-footer`, `data-ref-content`, `data-ref-grid`,
 * `data-ref-grid-widths`, and falls back to `data-section` when `names` is empty.
 * @param {{ names: string[], width: number }} input
 */
export function measureLayoutInPage(input) {
  const px = (v) => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const round = Math.round;
  const doc = document.documentElement;
  const sy = window.scrollY;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return (
      r.width > 0 &&
      r.height > 0 &&
      getComputedStyle(el).visibility !== "hidden"
    );
  };

  let sectionNames = input.names;
  let useAutoDataSection = false;
  if (!sectionNames || sectionNames.length === 0) {
    const autoNodes = [
      ...document.querySelectorAll(
        "[data-ref-section], [data-section], [data-ref-footer]",
      ),
    ].filter(visible);
    if (autoNodes.length > 0) {
      const seen = new Set();
      sectionNames = [];
      for (const el of autoNodes) {
        const key =
          el.getAttribute("data-ref-section") ??
          el.getAttribute("data-section") ??
          (el.hasAttribute("data-ref-footer")
            ? "Footer"
            : el.tagName.toLowerCase());
        if (!seen.has(key)) {
          seen.add(key);
          sectionNames.push(key);
        }
      }
      useAutoDataSection = true;
    }
  }

  const sections = (sectionNames || []).map((name, i) => {
    let selector;
    if (useAutoDataSection) {
      selector =
        name === "Footer"
          ? '[data-ref-footer], [data-section="Footer"]'
          : `[data-ref-section="${name}"], [data-section="${name}"]`;
    } else {
      selector = name.startsWith("Footer")
        ? `[data-ref-section="${i}"], [data-ref-footer]`
        : `[data-ref-section="${i}"]`;
    }
    const blocks = [...document.querySelectorAll(selector)].filter(visible);
    if (!blocks.length) return { name, present: false };
    const rects = blocks.map((b) => b.getBoundingClientRect());
    const top = Math.min(...rects.map((r) => r.top)) + sy;
    const bottom = Math.max(...rects.map((r) => r.bottom)) + sy;
    const cols = blocks.map((b) => {
      const c =
        (b.matches("[data-ref-content]")
          ? b
          : b.querySelector("[data-ref-content]")) ?? b;
      const r = c.getBoundingClientRect();
      const s = getComputedStyle(c);
      return [r.left + px(s.paddingLeft), r.right - px(s.paddingRight)];
    });
    const left = Math.max(0, Math.min(...cols.map((c) => c[0])));
    const right = Math.min(input.width, Math.max(...cols.map((c) => c[1])));
    let grid = null;
    for (const b of blocks) {
      const g = b.matches("[data-ref-grid]")
        ? b
        : b.querySelector("[data-ref-grid]");
      if (!g || !visible(g)) continue;
      const only = g.getAttribute("data-ref-grid-widths");
      if (only && !only.split(",").map(Number).includes(input.width)) continue;
      const kids = [...g.children].filter(visible);
      if (kids.length < 2) continue;
      const boxes = kids.map((k) => k.getBoundingClientRect());
      const s = getComputedStyle(g);
      const gap = (v) => (v === "normal" ? 0 : px(v));
      const gr = g.getBoundingClientRect();
      grid = {
        items: kids.length,
        perRow: boxes.filter((box) => Math.abs(box.top - boxes[0].top) <= 4)
          .length,
        colGap: round(gap(s.columnGap)),
        rowGap: round(gap(s.rowGap)),
        itemW: round(boxes[0].width),
        x: round(gr.left),
        w: round(gr.width),
      };
      break;
    }
    const first = getComputedStyle(blocks[0]);
    const last = getComputedStyle(blocks[blocks.length - 1]);
    return {
      name,
      present: true,
      y: round(top),
      h: round(bottom - top),
      blocks: blocks.length,
      contentLeft: round(left),
      contentRight: round(input.width - right),
      topInset: round(px(first.paddingTop)),
      bottomInset: round(px(last.paddingBottom)),
      grid,
    };
  });
  return { pageHeight: round(doc.scrollHeight), sections };
}

/**
 * Resolve default reference JSON path for a page slug inside apps/web/e2e/site/layout-ref/.
 * @param {string} slug
 * @returns {string}
 */
export function defaultRefPathForSlug(slug) {
  return join(DEFAULT_REF_DIR, `${slug}.json`);
}

/**
 * Wait for a loaded page to settle (network idle, fonts, header hydration, canvas hydration).
 * Logs a warning naming the width and wait label if any wait times out instead of failing silently.
 * @param {import("@playwright/test").Page} page
 * @param {number} width
 * @param {{ networkIdleTimeout?: number, hydrationTimeout?: number, warn?: (msg: string) => void }} [options]
 */
export async function waitForPageReady(page, width, options = {}) {
  const networkIdleTimeout = options.networkIdleTimeout ?? 12_000;
  const hydrationTimeout = options.hydrationTimeout ?? 10_000;
  const warn = options.warn ?? console.warn;

  const warnTimeout = (label, err) => {
    const detail = err instanceof Error ? err.message : String(err);
    warn(
      `WARN [measure width=${width}] wait timed out (${label}): ${detail.split("\n")[0]}`,
    );
  };

  await page
    .waitForLoadState("networkidle", { timeout: networkIdleTimeout })
    .catch((err) => warnTimeout("networkidle", err));
  await page.evaluate(() => document.fonts.ready);

  const header = page.locator(".site-header").first();
  if ((await header.count()) > 0) {
    await header
      .waitFor({ state: "attached", timeout: hydrationTimeout })
      .catch((err) => warnTimeout("header attached (.site-header)", err));
    await page
      .waitForFunction(
        () => {
          const el = document.querySelector(".site-header");
          return !el || el.getAttribute("data-scrolled") === "false";
        },
        undefined,
        { timeout: hydrationTimeout },
      )
      .catch((err) =>
        warnTimeout(
          'header hydration (.site-header[data-scrolled="false"])',
          err,
        ),
      );
  }

  const canvasStage = page
    .locator('[data-recipes-canvas-stage="true"]')
    .first();
  if ((await canvasStage.count()) > 0) {
    await page
      .waitForFunction(
        () => {
          const el = document.querySelector(
            '[data-recipes-canvas-stage="true"]',
          );
          return !el || el.getAttribute("data-ready") === "true";
        },
        undefined,
        { timeout: hydrationTimeout },
      )
      .catch((err) =>
        warnTimeout(
          'canvas hydration ([data-recipes-canvas-stage="true"][data-ready="true"])',
          err,
        ),
      );
  }
}

/**
 * Measure a running page across widths and write layout-ref.json plus strips into outDir.
 * @param {{ base: string, route?: string, slug: string, outDir: string, refPath?: string, widths?: number[], lang?: string }} options
 */
export async function measurePage(options) {
  const { base, slug, outDir } = options;
  if (!base) throw new Error("Missing --base URL (or SITE_BASE_URL)");
  if (!slug) throw new Error("Missing --slug");
  if (!outDir) throw new Error("Missing --out directory");

  const resolvedRefPath = options.refPath
    ? resolve(options.refPath)
    : existsSync(defaultRefPathForSlug(slug))
      ? defaultRefPathForSlug(slug)
      : null;

  let refJson = null;
  if (resolvedRefPath) {
    if (!existsSync(resolvedRefPath)) {
      throw new Error(`Reference file not found: ${resolvedRefPath}`);
    }
    refJson = JSON.parse(readFileSync(resolvedRefPath, "utf8"));
  }

  const route = options.route ?? refJson?.route;
  if (!route) {
    throw new Error(
      "Missing --route (and no reference JSON provided a default route)",
    );
  }

  const widths =
    options.widths && options.widths.length > 0
      ? options.widths
      : refJson?.widths
        ? Object.keys(refJson.widths)
            .map(Number)
            .sort((a, b) => b - a)
        : DEFAULT_WIDTHS;

  const lang = options.lang ?? "en";
  const baseUrl = base.replace(/\/+$/u, "");
  const fullUrl = `${baseUrl}${route.startsWith("/") ? route : `/${route}`}`;
  const sectionNames = Array.isArray(refJson?.sections) ? refJson.sections : [];

  const measured = {
    slug,
    route,
    sections: [...sectionNames],
    widths: {},
  };

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: WIDTH_VIEWPORTS[1440],
      deviceScaleFactor: 1,
    });
    await context.addCookies([
      {
        name: "mellodifai_lang",
        value: lang,
        url: baseUrl,
      },
    ]);
    const page = await context.newPage();

    for (const width of widths) {
      const vp = WIDTH_VIEWPORTS[width] ?? { width, height: 900 };
      await page.setViewportSize(vp);
      const response = await page.goto(fullUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      const status = response ? response.status() : 0;
      if (status >= 400 && slug !== "not-found") {
        throw new Error(
          `HTTP ${status} when loading ${fullUrl} at width ${width}`,
        );
      }
      await waitForPageReady(page, width);

      await page.evaluate(() =>
        window.scrollTo({ top: 0, behavior: "instant" }),
      );

      const result = await page.evaluate(measureLayoutInPage, {
        names: sectionNames,
        width,
      });
      measured.widths[String(width)] = result;
      if (measured.sections.length === 0 && result.sections.length > 0) {
        measured.sections = result.sections.map((s) => s.name);
      }
    }
    await context.close();
  } finally {
    await browser.close();
  }

  const resolvedOut = resolve(outDir);
  mkdirSync(resolvedOut, { recursive: true });
  writeFileSync(
    join(resolvedOut, "layout-ref.json"),
    `${JSON.stringify(measured, null, 2)}\n`,
  );
  const stripCount = writeStripsForRef(measured, resolvedOut);
  return { ref: measured, outDir: resolvedOut, stripCount };
}

/**
 * Parse CLI arguments supporting both `--flag value` and `--flag=value`.
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const args = argv.filter((token) => token !== "--");
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  /** @type {string[]} */
  const positionals = [];
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "-h" || token === "--help") {
      flags.help = true;
    } else if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq !== -1) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const key = token.slice(2);
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[key] = next;
          i += 1;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positionals.push(token);
    }
  }
  return { flags, positionals };
}

function usage() {
  console.log(
    "Usage: node apps/web/scripts/site-study/measure.mjs --base <url> --slug <slug> --out <dir> [--route <route>] [--ref <path>] [--widths 1440,1024,390] [--lang en]",
  );
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const { flags } = parseArgs(process.argv.slice(2));
  if (flags.help) {
    usage();
    process.exit(0);
  }
  const base =
    typeof flags.base === "string"
      ? flags.base
      : (process.env.SITE_BASE_URL ?? "");
  const slug = typeof flags.slug === "string" ? flags.slug : "";
  const route = typeof flags.route === "string" ? flags.route : undefined;
  const outDir = typeof flags.out === "string" ? flags.out : "";
  const refPath = typeof flags.ref === "string" ? flags.ref : undefined;
  const lang = typeof flags.lang === "string" ? flags.lang : "en";
  const widths =
    typeof flags.widths === "string"
      ? flags.widths
          .split(",")
          .map((n) => Number(n.trim()))
          .filter((n) => Number.isInteger(n) && n > 0)
      : undefined;

  if (!base || !slug || !outDir) {
    console.error(
      "ERROR: --base (or SITE_BASE_URL), --slug and --out are required.",
    );
    usage();
    process.exit(1);
  }

  try {
    const res = await measurePage({
      base,
      route,
      slug,
      outDir,
      refPath,
      widths,
      lang,
    });
    console.log(
      `MEASURED ${slug} (${res.ref.route}) at ${Object.keys(res.ref.widths).join(", ")}: ${res.stripCount} strips written to ${res.outDir}`,
    );
  } catch (err) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

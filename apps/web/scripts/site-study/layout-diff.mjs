#!/usr/bin/env node
// Numeric layout judge (J1): compare two layout-ref.json files value by value.
// Pass: same widths, same section count and vertical order, same items per row,
// every inset and grid length within the pixel tolerance.
// Colour, font, text and section height are not compared.
//
// Usage:
//   node apps/web/scripts/site-study/layout-diff.mjs <reference> <candidate> [--px=4]

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./measure.mjs";

const INSET_FIELDS = ["contentLeft", "contentRight", "topInset", "bottomInset"];
const GRID_FIELDS = ["colGap", "rowGap", "itemW", "x", "w"];

/**
 * Load a layout-ref.json from either a file path or a directory containing layout-ref.json.
 * @param {string} targetPath
 */
export function loadLayoutRef(targetPath) {
  const abs = resolve(targetPath);
  if (!existsSync(abs)) {
    throw new Error(`Layout reference path does not exist: ${abs}`);
  }
  const file = statSync(abs).isDirectory() ? join(abs, "layout-ref.json") : abs;
  if (!existsSync(file)) {
    throw new Error(`Missing layout-ref.json at: ${file}`);
  }
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (!parsed || typeof parsed !== "object" || !parsed.widths) {
    throw new Error(`Invalid layout-ref.json (missing widths): ${file}`);
  }
  return { file, data: parsed };
}

/**
 * Compare two layout-ref objects numerically within `px` tolerance.
 * @param {{ widths: Record<string, { sections: Array<Record<string, any>> }> }} ref
 * @param {{ widths: Record<string, { sections: Array<Record<string, any>> }> }} cand
 * @param {{ px?: number }} [options]
 */
export function diffLayouts(ref, cand, options = {}) {
  const px = options.px ?? 4;
  if (!Number.isFinite(px) || px < 0) {
    throw new Error(`Invalid pixel tolerance: ${px}`);
  }
  /** @type {string[]} */
  const failures = [];
  let checked = 0;
  let worstPx = 0;

  const checkNum = (id, field, want, got) => {
    checked += 1;
    if (!Number.isFinite(want) || !Number.isFinite(got)) {
      failures.push(`${id}: ${field} ${got}, reference ${want}`);
      return;
    }
    const delta = Math.abs(want - got);
    if (delta > worstPx) worstPx = delta;
    if (delta > px) {
      failures.push(
        `${id}: ${field} ${got}, reference ${want} (${delta} px off)`,
      );
    }
  };

  for (const w of Object.keys(ref.widths)) {
    const refWidth = ref.widths[w];
    const candWidth = cand.widths?.[w];
    if (!candWidth || !Array.isArray(candWidth.sections)) {
      failures.push(`${w}: no measurement at this width`);
      continue;
    }
    const A = refWidth.sections;
    const B = candWidth.sections;
    if (A.length !== B.length) {
      failures.push(`${w}: ${B.length} sections, reference has ${A.length}`);
      continue;
    }
    let lastY = Number.NEGATIVE_INFINITY;
    A.forEach((s, i) => {
      const t = B[i];
      const label = typeof s.name === "string" ? s.name.slice(0, 40) : `#${i}`;
      const id = `${w} #${i} ${label}`;
      if (s.present !== t.present) {
        failures.push(`${id}: present ${t.present}, reference ${s.present}`);
        return;
      }
      if (!s.present) return;
      if (typeof t.y === "number") {
        if (t.y < lastY) {
          failures.push(
            `${id}: out of order (y ${t.y} above previous section y ${lastY})`,
          );
        }
        lastY = t.y;
      }
      for (const f of INSET_FIELDS) {
        checkNum(id, f, s[f], t[f]);
      }
      if (Boolean(s.grid) !== Boolean(t.grid)) {
        failures.push(
          `${id}: grid ${t.grid ? "present" : "missing"}, reference ${s.grid ? "present" : "missing"}`,
        );
        return;
      }
      if (!s.grid) return;
      checked += 1;
      if (s.grid.perRow !== t.grid.perRow) {
        failures.push(
          `${id}: ${t.grid.perRow} items per row, reference ${s.grid.perRow}`,
        );
      }
      for (const f of GRID_FIELDS) {
        checkNum(id, `grid.${f}`, s.grid[f], t.grid[f]);
      }
    });
  }

  return {
    pass: failures.length === 0,
    px,
    checked,
    worstPx,
    failures,
  };
}

function usage() {
  console.log(
    "Usage: node apps/web/scripts/site-study/layout-diff.mjs <reference> <candidate> [--px=4]",
  );
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const { flags, positionals } = parseArgs(process.argv.slice(2));
  if (flags.help) {
    usage();
    process.exit(0);
  }
  const [refArg, candArg] = positionals;
  if (!refArg || !candArg) {
    console.error("ERROR: <reference> and <candidate> paths are required.");
    usage();
    process.exit(1);
  }
  const px = flags.px !== undefined ? Number(flags.px) : 4;
  try {
    const ref = loadLayoutRef(refArg).data;
    const cand = loadLayoutRef(candArg).data;
    const result = diffLayouts(ref, cand, { px });
    for (const msg of result.failures) {
      console.log(`FAIL ${msg}`);
    }
    if (result.pass) {
      console.log(
        `PASSED: every value within ${result.px} px (${result.checked} values, worst ${result.worstPx} px)`,
      );
      process.exit(0);
    }
    console.log(
      `FAILED: ${result.failures.length} differences over ${result.px} px`,
    );
    process.exit(1);
  } catch (err) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

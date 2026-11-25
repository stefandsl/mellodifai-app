#!/usr/bin/env node
// Layout strip judge (J2): Craft Anything pixel comparison of deterministic layout strips.
// A strip draws layout numbers only (gutters, first grid row, insets and gaps as bars),
// so colour, font, text and imagery are excluded.
//
// Two modes:
//   1. Direct compare (reference and candidate dirs or layout-ref.json files):
//      node apps/web/scripts/site-study/judge-strips.mjs <ref> <cand> [--max=0.01] [--tolerance=8] [--cli=<path>]
//   2. One-page J2 against a running server (measures, diffs J1 and compares J2 strips):
//      node apps/web/scripts/site-study/judge-strips.mjs <slug> [--base <url>] [--route <route>] [--ref <path>] [--out <dir>] [--px=4] [--max=0.01] [--tolerance=8] [--cli=<path>]
//      node apps/web/scripts/site-study/judge-strips.mjs --slug <slug> [--base <url>] ...
//
// Exit code 0 = every strip of every width passes (and J1 passes in page mode), 1 = fail or error.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { diffLayouts, loadLayoutRef } from "./layout-diff.mjs";
import {
  defaultRefPathForSlug,
  measurePage,
  parseArgs,
  writeStripsForRef,
} from "./measure.mjs";

const CLI_NAMES =
  process.platform === "win32"
    ? ["craft-anything-cli.exe", "craft-anything-cli"]
    : ["craft-anything-cli"];

/**
 * Resolve the Craft Anything CLI executable from --cli, CRAFT_ANYTHING_CLI, or PATH.
 * No hardcoded machine paths.
 * @param {string | undefined} cliFlag
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | null}
 */
export function resolveCraftCli(cliFlag, env = process.env) {
  const direct = cliFlag || env.CRAFT_ANYTHING_CLI;
  if (direct) {
    const abs = resolve(direct);
    if (existsSync(abs)) return abs;
    return null;
  }
  const pathEnv = env.PATH || env.Path || "";
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const name of CLI_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Return the temp base directory (honours RUNNER_TEMP, TEMP, TMP, TMPDIR before os.tmpdir).
 * @param {string | undefined} override
 */
function resolveTempRoot(override) {
  const base =
    override ||
    process.env.RUNNER_TEMP ||
    process.env.TEMP ||
    process.env.TMP ||
    process.env.TMPDIR ||
    tmpdir();
  const root = join(base, "site-study-j2");
  mkdirSync(root, { recursive: true });
  return root;
}

/**
 * Check whether a directory already contains strips/<w>/<NN>.png for every section of ref.
 * @param {string} dir
 * @param {{ widths: Record<string, { sections: Array<unknown> }> }} ref
 */
function hasAllStrips(dir, ref) {
  for (const [w, data] of Object.entries(ref.widths)) {
    const sections = data.sections ?? [];
    for (let i = 0; i < sections.length; i += 1) {
      const nn = String(i).padStart(2, "0");
      if (!existsSync(join(dir, "strips", w, `${nn}.png`))) return false;
    }
  }
  return true;
}

/**
 * Prepare a directory containing strips/<w>/<NN>.png from either a layout-ref.json file
 * or a directory (reusing existing strips when present, otherwise rendering into a temp dir).
 * @param {string} targetPath
 * @param {string} label
 * @param {string} tempRoot
 */
function prepareStripSource(targetPath, label, tempRoot) {
  const abs = resolve(targetPath);
  const { data } = loadLayoutRef(abs);
  if (statSync(abs).isDirectory() && hasAllStrips(abs, data)) {
    return { dir: abs, data, cleanup: null };
  }
  const dir = mkdtempSync(join(tempRoot, `${label}-`));
  writeFileSync(
    join(dir, "layout-ref.json"),
    `${JSON.stringify(data, null, 2)}\n`,
  );
  writeStripsForRef(data, dir);
  return {
    dir,
    data,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * Compare layout strips of reference and candidate with Craft Anything `web-pixels-compare`.
 * @param {{ refPath: string, candPath: string, max?: number, tolerance?: number, cli?: string, tempBase?: string, env?: Record<string, string | undefined> }} options
 */
export function judgeStrips(options) {
  const max = options.max ?? 0.01;
  const tolerance = options.tolerance ?? 8;
  if (!Number.isFinite(max) || max < 0) {
    throw new Error(`Invalid --max threshold: ${max}`);
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error(`Invalid --tolerance value: ${tolerance}`);
  }

  const cliBin = resolveCraftCli(options.cli, options.env);
  if (!cliBin) {
    throw new Error(
      "craft-anything-cli not found. Pass --cli <path>, set CRAFT_ANYTHING_CLI, or add craft-anything-cli to PATH.",
    );
  }

  const tempRoot = resolveTempRoot(options.tempBase);
  const refSrc = prepareStripSource(options.refPath, "ref", tempRoot);
  let candSrc = null;
  try {
    candSrc = prepareStripSource(options.candPath, "cand", tempRoot);
    const ref = refSrc.data;
    const cand = candSrc.data;
    /** @type {Array<{ width: string, index: number, nn: string, name: string, ok: boolean, comparable?: boolean, differenceFraction?: number, changedBox?: { width: number, height: number } | null, error?: string }>} */
    const strips = [];
    /** @type {string[]} */
    const failures = [];
    let failed = 0;

    for (const w of Object.keys(ref.widths)) {
      const a = ref.widths[w].sections;
      const candWidth = cand.widths?.[w];
      if (!candWidth || !Array.isArray(candWidth.sections)) {
        const msg = `${w}: FAIL no measurement at this width`;
        failures.push(msg);
        failed += 1;
        continue;
      }
      const b = candWidth.sections;
      if (a.length !== b.length) {
        const msg = `${w}: FAIL section count ${b.length}, reference ${a.length}`;
        failures.push(msg);
        failed += 1;
        continue;
      }
      for (let i = 0; i < a.length; i += 1) {
        const nn = String(i).padStart(2, "0");
        const beforePath = join(
          refSrc.dir,
          "strips",
          w,
          `${nn}.png`,
        ).replaceAll("\\", "/");
        const afterPath = join(
          candSrc.dir,
          "strips",
          w,
          `${nn}.png`,
        ).replaceAll("\\", "/");
        const payload = JSON.stringify({
          before: { path: beforePath },
          after: { path: afterPath },
          tolerance,
        });
        const args = [
          "--clean-room",
          "--format",
          "json",
          "web-pixels-compare",
          "--json",
          payload,
        ];
        const secName = typeof a[i].name === "string" ? a[i].name : `#${nn}`;
        let res;
        try {
          const isNodeScript = /\.(m|c)?js$/iu.test(cliBin);
          const raw = isNodeScript
            ? execFileSync(process.execPath, [cliBin, ...args], {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
              })
            : execFileSync(cliBin, args, {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
              });
          res = JSON.parse(raw).result;
        } catch (err) {
          const detail =
            err && typeof err === "object" && "stdout" in err && err.stdout
              ? String(err.stdout)
              : err instanceof Error
                ? err.message
                : String(err);
          const msg = `${w} #${nn}: ERROR ${detail.trim().slice(0, 200)}`;
          failures.push(msg);
          strips.push({
            width: w,
            index: i,
            nn,
            name: secName,
            ok: false,
            error: detail.trim().slice(0, 200),
          });
          failed += 1;
          continue;
        }

        const comparable = Boolean(res?.comparable);
        const diff =
          typeof res?.difference_fraction === "number"
            ? res.difference_fraction
            : Number.NaN;
        const ok = comparable && Number.isFinite(diff) && diff <= max;
        const changedBox = res?.changed_bounding_box ?? null;
        if (!ok) {
          failed += 1;
          failures.push(
            `${w} #${nn} FAIL diff ${(diff * 100).toFixed(2)}% (max ${(max * 100).toFixed(1)}%) ${secName.slice(0, 50)}`,
          );
        }
        strips.push({
          width: w,
          index: i,
          nn,
          name: secName,
          ok,
          comparable,
          differenceFraction: diff,
          changedBox,
        });
      }
    }

    const worstFraction = strips.reduce(
      (acc, s) =>
        typeof s.differenceFraction === "number" &&
        Number.isFinite(s.differenceFraction)
          ? Math.max(acc, s.differenceFraction)
          : acc,
      0,
    );

    return {
      pass: failed === 0,
      failed,
      max,
      tolerance,
      worstFraction,
      strips,
      failures,
    };
  } finally {
    refSrc.cleanup?.();
    candSrc?.cleanup?.();
  }
}

/**
 * Print a human-readable J2 strip report.
 * @param {ReturnType<typeof judgeStrips>} result
 */
export function formatStripReport(result) {
  const lines = [];
  for (const s of result.strips) {
    if (s.error) {
      lines.push(`${s.width} #${s.nn}: ERROR ${s.error}`);
      continue;
    }
    const pct =
      typeof s.differenceFraction === "number" &&
      Number.isFinite(s.differenceFraction)
        ? `${(s.differenceFraction * 100).toFixed(2)}%`
        : "n/a";
    const box = s.changedBox
      ? `${s.changedBox.width}x${s.changedBox.height}`
      : "-";
    lines.push(
      `${s.width} #${s.nn} ${s.ok ? "pass" : "FAIL"} diff ${pct} (max ${(result.max * 100).toFixed(1)}%) changed box ${box}  ${s.name.slice(0, 50)}`,
    );
  }
  for (const msg of result.failures) {
    if (!msg.includes("#")) lines.push(msg);
  }
  lines.push(result.pass ? "PASSED" : `FAILED: ${result.failed}`);
  return lines.join("\n");
}

/**
 * End-to-end J2 run for one page against a running server: measure, J1 numeric diff, J2 strip compare.
 * @param {{ slug: string, base: string, route?: string, refPath?: string, outDir?: string, px?: number, max?: number, tolerance?: number, cli?: string, lang?: string }} options
 */
export async function runPageJ2(options) {
  const refPath = options.refPath
    ? resolve(options.refPath)
    : defaultRefPathForSlug(options.slug);
  if (!existsSync(refPath)) {
    throw new Error(
      `Reference file not found for slug "${options.slug}": ${refPath}`,
    );
  }
  const ref = loadLayoutRef(refPath).data;
  const route = options.route ?? ref.route;
  if (!route) {
    throw new Error(`No route found for slug "${options.slug}". Pass --route.`);
  }

  let cleanupOut = null;
  let outDir = options.outDir ? resolve(options.outDir) : "";
  if (!outDir) {
    const tempRoot = resolveTempRoot(undefined);
    outDir = mkdtempSync(join(tempRoot, `page-${options.slug}-`));
    cleanupOut = () => rmSync(outDir, { recursive: true, force: true });
  }

  try {
    const measured = await measurePage({
      base: options.base,
      route,
      slug: options.slug,
      outDir,
      refPath,
      lang: options.lang ?? "en",
    });
    const j1 = diffLayouts(ref, measured.ref, { px: options.px ?? 4 });
    const j2 = judgeStrips({
      refPath,
      candPath: outDir,
      max: options.max ?? 0.01,
      tolerance: options.tolerance ?? 8,
      cli: options.cli,
    });
    return {
      slug: options.slug,
      route,
      base: options.base,
      outDir,
      j1,
      j2,
      pass: j1.pass && j2.pass,
    };
  } finally {
    cleanupOut?.();
  }
}

function usage() {
  console.log(
    [
      "Usage:",
      "  Direct compare:",
      "    node apps/web/scripts/site-study/judge-strips.mjs <ref> <cand> [--max=0.01] [--tolerance=8] [--cli=<path>]",
      "  One-page J2 against a running build:",
      "    node apps/web/scripts/site-study/judge-strips.mjs <slug> [--base <url>] [--route <route>] [--ref <path>] [--out <dir>] [--px=4] [--max=0.01] [--tolerance=8] [--cli=<path>]",
    ].join("\n"),
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
  const max = flags.max !== undefined ? Number(flags.max) : 0.01;
  const tolerance = flags.tolerance !== undefined ? Number(flags.tolerance) : 8;
  const px = flags.px !== undefined ? Number(flags.px) : 4;
  const cli = typeof flags.cli === "string" ? flags.cli : undefined;

  const pageSlug =
    typeof flags.slug === "string"
      ? flags.slug
      : positionals.length === 1
        ? positionals[0]
        : null;

  if (pageSlug && positionals.length < 2) {
    const base =
      typeof flags.base === "string"
        ? flags.base
        : process.env.SITE_BASE_URL ||
          `http://127.0.0.1:${process.env.E2E_PORT || 3242}`;
    const route = typeof flags.route === "string" ? flags.route : undefined;
    const refPath = typeof flags.ref === "string" ? flags.ref : undefined;
    const outDir = typeof flags.out === "string" ? flags.out : undefined;
    const lang = typeof flags.lang === "string" ? flags.lang : "en";
    try {
      const res = await runPageJ2({
        slug: pageSlug,
        base,
        route,
        refPath,
        outDir,
        px,
        max,
        tolerance,
        cli,
        lang,
      });
      console.log(`=== J1 numeric (${res.slug} ${res.route}) ===`);
      for (const msg of res.j1.failures) {
        console.log(`FAIL ${msg}`);
      }
      console.log(
        res.j1.pass
          ? `PASSED: every value within ${res.j1.px} px (${res.j1.checked} values, worst ${res.j1.worstPx} px)`
          : `FAILED: ${res.j1.failures.length} differences over ${res.j1.px} px`,
      );
      console.log(`=== J2 strips (${res.slug} ${res.route}) ===`);
      console.log(formatStripReport(res.j2));
      process.exit(res.pass ? 0 : 1);
    } catch (err) {
      console.error(
        `ERROR: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  }

  const [refArg, candArg] = positionals;
  if (!refArg || !candArg) {
    console.error(
      "ERROR: pass <ref> <cand> for strip compare, or <slug> (with --base or SITE_BASE_URL) for one-page J2.",
    );
    usage();
    process.exit(1);
  }

  try {
    const result = judgeStrips({
      refPath: refArg,
      candPath: candArg,
      max,
      tolerance,
      cli,
    });
    console.log(formatStripReport(result));
    process.exit(result.pass ? 0 : 1);
  } catch (err) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

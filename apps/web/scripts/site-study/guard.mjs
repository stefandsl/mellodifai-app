// J6 clean-room and asset manifest guard for the public site and song recipes.
// Usage: node apps/web/scripts/site-study/guard.mjs
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = resolve(
  fileURLToPath(new URL("../../../..", import.meta.url)),
);
const DEFAULT_CAPTURE =
  process.env.SITE_TEXT_CAPTURE ??
  "E:/mellodifai/research/2026-11-20/cardboard/text-capture";

const FORBIDDEN_PATTERNS = [
  new RegExp(["card", "board", "\\.ai"].join(""), "iu"),
  new RegExp(["\\bcard", "board\\b"].join(""), "iu"),
];

const RESEARCH_PATH_RE = new RegExp(
  [
    "E:/mellodifai/research/\\d{4}-\\d{2}-\\d{2}/card",
    "board/[^\\s\"')]+",
  ].join(""),
  "giu",
);

const SCAN_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".json",
  ".md",
]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  ".git",
  "test-results",
  "playwright-report",
]);

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function wordsOf(text) {
  return (
    text
      .normalize("NFKC")
      .toLowerCase()
      .replaceAll(/[‘’ʼ]/gu, "'")
      .match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? []
  );
}

/**
 * @param {unknown} value
 * @param {string[]} out
 */
function collectStrings(value, out) {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "id" || k === "slug" || k === "media" || k === "rights")
        continue;
      collectStrings(v, out);
    }
  }
}

/**
 * @param {{ root?: string, captureDir?: string, checkCapture?: boolean }} [options]
 */
export function runGuard(options = {}) {
  const root = options.root ?? DEFAULT_ROOT;
  const captureDir = options.captureDir ?? DEFAULT_CAPTURE;
  const checkCapture = options.checkCapture ?? true;
  /** @type {string[]} */
  const failures = [];

  // (a) Forbidden reference brand/domain tokens across apps/web, packages, content.
  let checkedSourceFiles = 0;
  for (const area of ["apps/web", "packages", "content"]) {
    const areaDir = join(root, area);
    for (const file of walkFiles(areaDir)) {
      const ext = file.slice(file.lastIndexOf("."));
      if (!SCAN_EXTS.has(ext)) continue;
      checkedSourceFiles += 1;
      const raw = readFileSync(file, "utf8").replaceAll(RESEARCH_PATH_RE, "");
      for (const re of FORBIDDEN_PATTERNS) {
        if (re.test(raw)) {
          const rel = relative(root, file).replaceAll("\\", "/");
          failures.push(`forbidden reference token in ${rel}`);
          break;
        }
      }
    }
  }

  // (b) Every file under apps/web/public/site/ is indexed in assets.manifest.json.
  const sitePublic = join(root, "apps", "web", "public", "site");
  const manifestPath = join(sitePublic, "assets.manifest.json");
  /** @type {Map<string, { origin?: string, sha256?: string, bytes?: number }>} */
  const manifestMap = new Map();

  if (!existsSync(manifestPath)) {
    failures.push("missing apps/web/public/site/assets.manifest.json");
  } else {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (err) {
      failures.push(
        `invalid JSON in assets.manifest.json: ${err instanceof Error ? err.message : String(err)}`,
      );
      manifest = null;
    }
    if (manifest && Array.isArray(manifest.assets)) {
      for (const entry of manifest.assets) {
        if (!entry || typeof entry.path !== "string") {
          failures.push("invalid entry in assets.manifest.json");
          continue;
        }
        if (manifestMap.has(entry.path)) {
          failures.push(`duplicate manifest entry: ${entry.path}`);
        }
        manifestMap.set(entry.path, entry);
        if (
          typeof entry.origin !== "string" ||
          entry.origin.trim().length < 3
        ) {
          failures.push(
            `missing origin in assets.manifest.json for ${entry.path}`,
          );
        }
      }
    } else if (manifest !== null) {
      failures.push("assets.manifest.json must contain an assets array");
    }
  }

  const diskFiles = walkFiles(sitePublic)
    .map((full) => ({
      full,
      rel: relative(sitePublic, full).replaceAll("\\", "/"),
    }))
    .filter((f) => f.rel !== "assets.manifest.json");

  const diskSet = new Set(diskFiles.map((f) => f.rel));
  for (const { full, rel } of diskFiles) {
    const entry = manifestMap.get(rel);
    if (!entry) {
      failures.push(`unlisted file under public/site: ${rel}`);
      continue;
    }
    const buf = readFileSync(full);
    const sha256 = createHash("sha256").update(buf).digest("hex");
    if (entry.sha256 !== sha256) {
      failures.push(`sha256 mismatch in assets.manifest.json for ${rel}`);
    }
    if (entry.bytes !== statSync(full).size) {
      failures.push(`byte size mismatch in assets.manifest.json for ${rel}`);
    }
  }

  for (const listedPath of manifestMap.keys()) {
    if (!diskSet.has(listedPath)) {
      failures.push(
        `stale entry in assets.manifest.json (file missing): ${listedPath}`,
      );
    }
  }

  // (c) Every recipe's media files exist and are in assets.manifest.json.
  const recipesDir = join(root, "content", "recipes");
  let checkedRecipes = 0;
  /** @type {string[]} */
  const recipeStrings = [];
  if (existsSync(recipesDir)) {
    for (const entry of readdirSync(recipesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const jsonPath = join(recipesDir, entry.name, "recipe.json");
      if (!existsSync(jsonPath)) {
        failures.push(`missing recipe.json in content/recipes/${entry.name}`);
        continue;
      }
      checkedRecipes += 1;
      const data = JSON.parse(readFileSync(jsonPath, "utf8"));
      collectStrings(data, recipeStrings);
      for (const key of ["cover", "preview", "example"]) {
        const name = data?.media?.[key];
        if (typeof name !== "string") {
          failures.push(`missing media.${key} in ${entry.name}`);
          continue;
        }
        const rel = `recipes/${entry.name}/${name}`;
        if (!diskSet.has(rel)) {
          failures.push(`missing media file public/site/${rel}`);
        }
        if (!manifestMap.has(rel)) {
          failures.push(`recipe media not in assets.manifest.json: ${rel}`);
        }
      }
    }
  }

  // (d) No 8-word shared run between recipe strings and captured reference text.
  let checkedRuns = 0;
  if (checkCapture && existsSync(captureDir) && recipeStrings.length > 0) {
    const refRuns = new Set();
    for (const file of readdirSync(captureDir)) {
      if (!file.endsWith(".json")) continue;
      const payload = JSON.parse(readFileSync(join(captureDir, file), "utf8"));
      for (const s of payload.strings ?? []) {
        const w = wordsOf(String(s));
        for (let i = 0; i + 8 <= w.length; i += 1) {
          refRuns.add(w.slice(i, i + 8).join(" "));
        }
      }
    }
    for (const text of recipeStrings) {
      const w = wordsOf(text);
      for (let i = 0; i + 8 <= w.length; i += 1) {
        checkedRuns += 1;
        const run = w.slice(i, i + 8).join(" ");
        if (refRuns.has(run)) {
          failures.push(`shared 8-word reference run in recipe text: "${run}"`);
          break;
        }
      }
    }
  }

  return {
    pass: failures.length === 0,
    failures,
    checkedSourceFiles,
    checkedAssets: diskFiles.length,
    checkedRecipes,
    checkedRuns,
  };
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const result = runGuard();
  for (const failure of result.failures) {
    console.error(`FAIL ${failure}`);
  }
  console.log(
    `${result.pass ? "PASSED" : "FAILED"}: ${result.checkedSourceFiles} source files, ${result.checkedAssets} site assets, ${result.checkedRecipes} recipes, ${result.checkedRuns} 8-word runs, ${result.failures.length} failures`,
  );
  process.exit(result.pass ? 0 : 1);
}

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const SCRIPT_DIR = import.meta.dirname;
const WEB_DIR = path.resolve(SCRIPT_DIR, "..");
const CORE_DIR = path.join(WEB_DIR, "node_modules/@astryxdesign/core");
const ASTRYX_CSS_PATH = path.join(CORE_DIR, "dist/astryx.css");
const RESET_CSS_PATH = path.join(CORE_DIR, "src/reset.css");

const PRICING_ONLY_FILES = new Set(["components/site/compare-table.tsx"]);

function walkFiles(relDir) {
  const full = path.join(WEB_DIR, relDir);
  if (!fs.existsSync(full)) return [];
  const out = [];
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const childRel = path.posix.join(relDir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(childRel));
    else if (
      /\.(?:ts|tsx)$/u.test(entry.name) &&
      !entry.name.includes(".test.")
    )
      out.push(childRel);
  }
  return out;
}

function collectCoreImports(relFiles) {
  const bySpec = new Map();
  const extraClassTokens = new Set();
  const importRe =
    /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["'](@astryxdesign\/core\/[^"']+)["']/gu;

  for (const rel of relFiles) {
    const full = path.join(WEB_DIR, rel);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, "utf8");
    for (const m of src.matchAll(importRe)) {
      if (m[0].startsWith("import type")) continue;
      const spec = m[2];
      const names = m[1]
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part && !part.startsWith("type "))
        .map((part) => part.split(/\s+as\s+/u)[0].trim())
        .filter(Boolean);
      if (!names.length) continue;
      if (!bySpec.has(spec)) bySpec.set(spec, new Set());
      for (const n of names) bySpec.get(spec).add(n);
    }
    if (rel === "src/site-primitives.tsx") {
      for (const m of src.matchAll(/\bx[0-9a-z]{5,7}\b/gu)) {
        extraClassTokens.add(m[0]);
      }
    }
  }
  return { bySpec, extraClassTokens };
}

function resolveEsbuild() {
  const cliPkg = fs.realpathSync(
    path.join(WEB_DIR, "node_modules/@astryxdesign/cli/package.json"),
  );
  return createRequire(cliPkg)("esbuild");
}

function bundleCoreTokens(bySpec, extraClassTokens) {
  const classes = new Set(extraClassTokens);
  const lines = [];
  let idx = 0;
  for (const [spec, names] of [...bySpec.entries()].sort()) {
    const aliased = [...names]
      .sort()
      .map((n) => `${n} as _e${idx++}`)
      .join(", ");
    lines.push(`export { ${aliased} } from ${JSON.stringify(spec)};`);
  }
  if (!lines.length) return classes;

  const esbuild = resolveEsbuild();
  const res = esbuild.buildSync({
    stdin: {
      contents: lines.join("\n"),
      resolveDir: WEB_DIR,
      loader: "js",
    },
    bundle: true,
    write: false,
    format: "esm",
    treeShaking: true,
    external: ["react", "react-dom", "react/jsx-runtime", "@stylexjs/stylex"],
  });
  const text = res.outputFiles[0].text;
  for (const m of text.matchAll(/\bx[0-9a-z]{5,7}\b/gu)) {
    classes.add(m[0]);
  }
  return classes;
}

function unwrapSelector(line) {
  const open = line.indexOf("{");
  if (open === -1) return "";
  let sel = line.slice(0, open).trim();
  let rest = line.slice(open + 1);
  while (
    sel.startsWith("@media") ||
    sel.startsWith("@starting-style") ||
    sel.startsWith("@supports") ||
    sel.startsWith("@container")
  ) {
    const nextOpen = rest.indexOf("{");
    if (nextOpen === -1) return "";
    sel = rest.slice(0, nextOpen).trim();
    rest = rest.slice(nextOpen + 1);
  }
  return sel;
}

function collectSeedVars() {
  const vars = new Set();
  const cssFiles = [
    path.join(WEB_DIR, "app/(site)/site.css"),
    path.join(WEB_DIR, "components/site/parts.css"),
    path.join(WEB_DIR, "src/themes/mesh/mesh.css"),
    RESET_CSS_PATH,
  ];
  for (const file of cssFiles) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/var\((--[\w-]+)/gu)) vars.add(m[1]);
  }
  return vars;
}

function extractSubset(
  astryxLines,
  allowedClasses,
  { excludeClasses = new Set(), includeRootVars = true, seedVars = new Set() },
) {
  const keptVars = new Set(seedVars);
  const keptKeyframes = new Set();
  const ruleLines = [];

  for (const line of astryxLines) {
    const t = line.trim();
    if (
      !t ||
      t.startsWith("/*") ||
      t.startsWith("@layer") ||
      t === "}" ||
      t.startsWith("@property") ||
      t.startsWith("@keyframes") ||
      t.startsWith(":root")
    ) {
      continue;
    }
    const sel = unwrapSelector(t);
    const cls = [...sel.matchAll(/\.(x[0-9a-z]{5,7})\b/gu)].map((m) => m[1]);
    if (!cls.length) continue;
    if (!cls.every((c) => allowedClasses.has(c))) continue;
    if (excludeClasses.size && cls.every((c) => excludeClasses.has(c)))
      continue;
    ruleLines.push(line);
    for (const m of line.matchAll(/--[\w-]+/gu)) keptVars.add(m[0]);
    for (const m of line.matchAll(/\bx[0-9a-z]{5,7}-B\b/gu))
      keptKeyframes.add(m[0]);
  }

  const rootDecls = new Map();
  if (includeRootVars) {
    for (const line of astryxLines) {
      const t = line.trim();
      if (!t.startsWith(":root")) continue;
      const body = t.slice(t.indexOf("{") + 1, t.lastIndexOf("}"));
      for (const part of body.split(";")) {
        const idx = part.indexOf(":");
        if (idx === -1) continue;
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        if (key.startsWith("--")) rootDecls.set(key, val);
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const v of [...keptVars]) {
        const def = rootDecls.get(v);
        if (!def) continue;
        for (const m of def.matchAll(/var\((--[\w-]+)/gu)) {
          if (!keptVars.has(m[1])) {
            keptVars.add(m[1]);
            changed = true;
          }
        }
      }
    }
  }

  const headerLines = [];
  for (const line of astryxLines) {
    const t = line.trim();
    if (t.startsWith("@property ")) {
      const m = t.match(/@property\s+(--[\w-]+)/u);
      if (m && keptVars.has(m[1])) headerLines.push(line);
    } else if (t.startsWith("@keyframes ")) {
      const m = t.match(/@keyframes\s+([\w-]+)/u);
      if (m && keptKeyframes.has(m[1])) headerLines.push(line);
    }
  }

  if (includeRootVars) {
    const filteredRoot = [...rootDecls.entries()]
      .filter(([k]) => keptVars.has(k))
      .map(([k, v]) => `${k}:${v}`)
      .join(";");
    if (filteredRoot) headerLines.push(`  :root{${filteredRoot}}`);
  }

  if (!ruleLines.length && !headerLines.length) {
    return "/* Generated by scripts/build-site-astryx-css.mjs: no extra Astryx rules needed. */\n";
  }

  return [
    "/* Generated by scripts/build-site-astryx-css.mjs from @astryxdesign/core/astryx.css. */",
    "@layer reset, astryx-base, astryx-theme;",
    "@layer astryx-base {",
    ...headerLines,
    ...ruleLines,
    "}",
    "",
  ].join("\n");
}

export function computeSiteAstryxCss() {
  const astryxLines = fs.readFileSync(ASTRYX_CSS_PATH, "utf8").split(/\r?\n/u);
  const allSiteFiles = [
    ...walkFiles("app/(site)"),
    ...walkFiles("components/site"),
    ...(fs.existsSync(path.join(WEB_DIR, "src/site-primitives.tsx"))
      ? ["src/site-primitives.tsx"]
      : []),
  ];
  const sharedFiles = allSiteFiles.filter((f) => !PRICING_ONLY_FILES.has(f));
  const pricingFiles = allSiteFiles.filter((f) => PRICING_ONLY_FILES.has(f));

  const sharedImports = collectCoreImports(sharedFiles);
  const sharedClasses = bundleCoreTokens(
    sharedImports.bySpec,
    sharedImports.extraClassTokens,
  );

  const pricingImports = collectCoreImports(pricingFiles);
  const pricingClasses = bundleCoreTokens(
    pricingImports.bySpec,
    pricingImports.extraClassTokens,
  );
  const allPricingClasses = new Set([...sharedClasses, ...pricingClasses]);

  const seedVars = collectSeedVars();
  const sharedCss = extractSubset(astryxLines, sharedClasses, {
    includeRootVars: true,
    seedVars,
  });
  const tableCss = extractSubset(astryxLines, allPricingClasses, {
    excludeClasses: sharedClasses,
    includeRootVars: false,
  });

  return { sharedCss, tableCss };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.join(SCRIPT_DIR, "build-site-astryx-css.mjs")
) {
  const { sharedCss, tableCss } = computeSiteAstryxCss();
  const sharedOut = path.join(WEB_DIR, "src/site-astryx.css");
  const tableOut = path.join(WEB_DIR, "src/site-astryx-table.css");
  fs.writeFileSync(sharedOut, sharedCss, "utf8");
  fs.writeFileSync(tableOut, tableCss, "utf8");
  console.log(
    `wrote src/site-astryx.css (${(sharedCss.length / 1024).toFixed(1)} KB) and src/site-astryx-table.css (${(tableCss.length / 1024).toFixed(1)} KB)`,
  );
}

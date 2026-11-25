import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const SCRIPT_DIR = import.meta.dirname;
const WEB_DIR = path.resolve(SCRIPT_DIR, "..");
const CORE_DIR = path.join(WEB_DIR, "node_modules/@astryxdesign/core");
const ASTRYX_CSS_PATH = path.join(CORE_DIR, "dist/astryx.css");
const RESET_CSS_PATH = path.join(CORE_DIR, "src/reset.css");

const PRICING_ONLY_FILES = new Set([
  "components/site/compare-table.tsx",
  "src/site-table-primitives.tsx",
]);

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

function addImportSpec(bySpec, spec, binding) {
  if (!bySpec.has(spec)) bySpec.set(spec, new Set());
  bySpec.get(spec).add(binding);
}

function collectCoreImports(relFiles) {
  const bySpec = new Map();
  const extraClassTokens = new Set();
  const statementRe =
    /\bimport\s+([^;]+?)\s+from\s+["'](@astryxdesign\/core\/[^"']+)["']/gu;

  for (const rel of relFiles) {
    const full = path.join(WEB_DIR, rel);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, "utf8");
    for (const m of src.matchAll(statementRe)) {
      const clause = m[1].trim();
      const spec = m[2];
      if (clause.startsWith("type ") || spec.endsWith(".css")) continue;

      let matchedAny = false;
      const braceMatch = clause.match(/\{([\s\S]*?)\}/u);
      if (braceMatch) {
        matchedAny = true;
        const names = braceMatch[1]
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part && !part.startsWith("type "))
          .map((part) => part.split(/\s+as\s+/u)[0].trim())
          .filter(Boolean);
        for (const n of names) addImportSpec(bySpec, spec, n);
      }
      const withoutBraces = clause
        .replace(/\{[\s\S]*?\}/u, "")
        .replaceAll(",", " ")
        .trim();
      if (withoutBraces) {
        if (/^\*\s+as\s+\w+$/u.test(withoutBraces)) {
          matchedAny = true;
          addImportSpec(bySpec, spec, "*");
        } else if (/^\w+$/u.test(withoutBraces)) {
          matchedAny = true;
          addImportSpec(bySpec, spec, "default");
        } else {
          throw new Error(
            `build-site-astryx-css: unsupported import clause "${clause}" from "${spec}" in ${rel}`,
          );
        }
      }
      if (!matchedAny) {
        throw new Error(
          `build-site-astryx-css: could not parse import "${m[0]}" in ${rel}`,
        );
      }
    }
    if (
      rel === "src/site-primitives.tsx" ||
      rel === "src/site-table-primitives.tsx"
    ) {
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
    const sorted = [...names].sort();
    if (sorted.includes("*")) {
      lines.push(`export * as _ns${idx++} from ${JSON.stringify(spec)};`);
    }
    const named = sorted.filter((n) => n !== "*");
    if (named.length) {
      const aliased = named.map((n) => `${n} as _e${idx++}`).join(", ");
      lines.push(`export { ${aliased} } from ${JSON.stringify(spec)};`);
    }
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

function readResetLayerCss() {
  const raw = fs.readFileSync(RESET_CSS_PATH, "utf8");
  const stripped = raw
    .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/@layer\s+reset\s*,\s*astryx-base\s*,\s*astryx-theme\s*;/u, "")
    .trim();
  return stripped.replaceAll(/\n{3,}/gu, "\n\n");
}

function extractSubset(
  astryxLines,
  allowedClasses,
  {
    excludeClasses = new Set(),
    includeRootVars = true,
    includeReset = false,
    seedVars = new Set(),
    requiredClasses = new Set(),
    label = "site",
  },
) {
  const keptVars = new Set(seedVars);
  const keptKeyframes = new Set();
  const ruleLines = [];
  const astryxRuleClasses = new Set();
  const matchedClasses = new Set();

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
    for (const c of cls) astryxRuleClasses.add(c);
    if (!cls.every((c) => allowedClasses.has(c))) continue;
    for (const c of cls) matchedClasses.add(c);
    if (excludeClasses.size && cls.every((c) => excludeClasses.has(c)))
      continue;
    ruleLines.push(line);
    for (const m of line.matchAll(/--[\w-]+/gu)) keptVars.add(m[0]);
    for (const m of line.matchAll(/\bx[0-9a-z]{5,7}-B\b/gu))
      keptKeyframes.add(m[0]);
  }

  if (requiredClasses.size) {
    const missingFromAstryx = [...requiredClasses]
      .filter((c) => !astryxRuleClasses.has(c))
      .sort();
    if (missingFromAstryx.length) {
      throw new Error(
        `build-site-astryx-css (${label}): ${missingFromAstryx.length} class(es) not found in @astryxdesign/core/dist/astryx.css: ${missingFromAstryx.join(", ")}`,
      );
    }
    const missingFromSubset = [...requiredClasses]
      .filter((c) => !matchedClasses.has(c))
      .sort();
    if (missingFromSubset.length) {
      throw new Error(
        `build-site-astryx-css (${label}): ${missingFromSubset.length} class(es) matched no emitted rule in subset CSS: ${missingFromSubset.join(", ")}`,
      );
    }
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

  const resetBlock = includeReset ? [readResetLayerCss()] : [];

  return [
    "/* Generated by scripts/build-site-astryx-css.mjs from @astryxdesign/core/astryx.css. */",
    "@layer reset, astryx-base, astryx-theme;",
    ...resetBlock,
    "@layer astryx-base {",
    ...headerLines,
    ...ruleLines,
    "}",
    "",
  ].join("\n");
}

export function computeSiteAstryxCss(options = {}) {
  const astryxLines = fs.readFileSync(ASTRYX_CSS_PATH, "utf8").split(/\r?\n/u);
  const allSiteFiles = [
    ...walkFiles("app/(site)"),
    ...walkFiles("components/site"),
    ...[
      "app/global-not-found.tsx",
      "src/site-primitives.tsx",
      "src/site-table-primitives.tsx",
    ].filter((rel) => fs.existsSync(path.join(WEB_DIR, rel))),
  ];
  const sharedFiles = allSiteFiles.filter((f) => !PRICING_ONLY_FILES.has(f));
  const pricingFiles = allSiteFiles.filter((f) => PRICING_ONLY_FILES.has(f));

  const sharedImports = collectCoreImports(sharedFiles);
  for (const t of options.extraTokens?.shared ?? []) {
    sharedImports.extraClassTokens.add(t);
  }
  const sharedClasses = bundleCoreTokens(
    sharedImports.bySpec,
    sharedImports.extraClassTokens,
  );

  const pricingImports = collectCoreImports(pricingFiles);
  for (const t of options.extraTokens?.pricing ?? []) {
    pricingImports.extraClassTokens.add(t);
  }
  const pricingClasses = bundleCoreTokens(
    pricingImports.bySpec,
    pricingImports.extraClassTokens,
  );
  const allPricingClasses = new Set([...sharedClasses, ...pricingClasses]);

  const seedVars = collectSeedVars();
  const sharedCss = extractSubset(astryxLines, sharedClasses, {
    includeRootVars: true,
    includeReset: true,
    seedVars,
    requiredClasses: sharedImports.extraClassTokens,
    label: "shared",
  });
  const tableCss = extractSubset(astryxLines, allPricingClasses, {
    excludeClasses: sharedClasses,
    includeRootVars: false,
    requiredClasses: pricingImports.extraClassTokens,
    label: "pricing-table",
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

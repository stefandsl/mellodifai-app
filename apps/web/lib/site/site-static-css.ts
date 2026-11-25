import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const WEB_DIR = path.resolve(import.meta.dirname, "../..");

type EsbuildMini = {
  transformSync: (
    input: string,
    options: { loader: "css"; minify: boolean },
  ) => { code: string };
};

function resolveEsbuild(): EsbuildMini {
  const cliPkg = fs.realpathSync(
    path.join(WEB_DIR, "node_modules/@astryxdesign/cli/package.json"),
  );
  return createRequire(cliPkg)("esbuild") as EsbuildMini;
}

function unwrapSelector(line: string): string {
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

/**
 * Splits `@font-face` blocks that load `/site/fonts/*.woff2` out of `site.css`
 * so metric-matched fallback `@font-face` rules stay inline for zero-CLS first paint
 * while the web font stylesheet loads right after LCP.
 */
export function splitSiteFontsCss(siteCss: string): {
  inlineSiteCss: string;
  fontsCss: string;
} {
  const webFontBlocks: string[] = [];
  const inlineSiteCss = siteCss.replaceAll(
    /@font-face\s*\{[\s\S]*?\}/gu,
    (block) => {
      if (block.includes("/site/fonts/")) {
        webFontBlocks.push(block);
        return "";
      }
      return block;
    },
  );
  return { inlineSiteCss, fontsCss: webFontBlocks.join("\n") };
}

function collectClassTokensFromHtml(
  html: string,
  extraClasses: readonly string[] = [],
): Set<string> {
  const allowed = new Set<string>(extraClasses);
  for (const attr of html.matchAll(/\bclass="([^"]*)"/gu)) {
    for (const m of attr[1].matchAll(/\bx[0-9a-z]{5,7}\b/gu)) {
      allowed.add(m[0]);
    }
  }
  return allowed;
}

function collectAllCssClasses(
  html: string,
  extraClasses: readonly string[] = [],
): Set<string> {
  const present = new Set<string>(extraClasses);
  for (const attr of html.matchAll(/\bclass="([^"]*)"/gu)) {
    for (const cls of attr[1].split(/\s+/u)) {
      if (cls) present.add(cls);
    }
  }
  return present;
}

// Classes toggled dynamically by vanilla islands (not always present in initial SSR HTML).
const DYNAMIC_SITE_CLASSES = [
  "site-menu-open",
  "site-agents-popover",
  "site-agents-popover__item",
  "site-agents-popover__title",
  "site-agents-popover__desc",
  "site-word--active",
  "site-chip--active",
  "site-stage__play",
  "site-stage__wave",
  "site-recipes-empty",
  "site-recipe-card__video",
] as const;

function selectorHasMissingSiteClass(
  selectorText: string,
  presentClasses: Set<string>,
): boolean {
  const parts = selectorText.split(",");
  // Keep rule if AT LEAST ONE comma-separated selector has all its .site-* classes present.
  for (const part of parts) {
    const siteClasses = [...part.matchAll(/\.(site-[a-zA-Z0-9_-]+)/gu)].map(
      (m) => m[1],
    );
    if (siteClasses.length === 0) return false;
    if (siteClasses.every((c) => presentClasses.has(c))) return false;
  }
  return true;
}

/**
 * Safely prunes rules from `site.css` whose `.site-*` class selectors never
 * appear in the page's HTML (or dynamic island classes). Preserves `@font-face`,
 * `@keyframes`, element rules, and wraps kept rules inside `@media`/`@container`/`@supports`.
 */
export function pruneUnusedSiteCss(
  siteCss: string,
  html: string,
  extraClasses: readonly string[] = [],
): string {
  const present = collectAllCssClasses(html, [
    ...DYNAMIC_SITE_CLASSES,
    ...extraClasses,
  ]);
  const clean = siteCss.replaceAll(/\/\*[\s\S]*?\*\//gu, "");

  function filterBlock(src: string): string {
    const out: string[] = [];
    let i = 0;
    const len = src.length;
    while (i < len) {
      while (i < len && /\s/u.test(src[i])) i++;
      if (i >= len) break;

      let brace = i;
      let semi = -1;
      while (brace < len && src[brace] !== "{") {
        if (src[brace] === ";" && semi === -1) semi = brace;
        brace++;
      }
      if (semi !== -1 && (brace >= len || semi < brace)) {
        out.push(src.slice(i, semi + 1));
        i = semi + 1;
        continue;
      }
      if (brace >= len) {
        out.push(src.slice(i));
        break;
      }

      const prelude = src.slice(i, brace).trim();
      let depth = 1;
      let j = brace + 1;
      while (j < len && depth > 0) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      const inner = src.slice(brace + 1, j - 1);
      i = j;

      if (
        prelude.startsWith("@font-face") ||
        prelude.startsWith("@keyframes") ||
        prelude.startsWith("@property")
      ) {
        out.push(`${prelude}{${inner}}`);
        continue;
      }

      if (
        prelude.startsWith("@media") ||
        prelude.startsWith("@supports") ||
        prelude.startsWith("@container") ||
        prelude.startsWith("@layer")
      ) {
        const filteredInner = filterBlock(inner);
        if (filteredInner.trim()) {
          out.push(`${prelude}{${filteredInner}}`);
        }
        continue;
      }

      if (!selectorHasMissingSiteClass(prelude, present)) {
        out.push(`${prelude}{${inner}}`);
      }
    }
    return out.join("\n");
  }

  return filterBlock(clean);
}

/**
 * Prunes unreferenced `--*` custom property declarations from `mesh.css`,
 * keeping all transitively referenced variables, `--spacing-1` (probed by layout tests),
 * and every non-variable rule (`color-scheme`, reset rules, etc.).
 */
export function pruneMeshCssVars(
  meshCss: string,
  referenceText: string,
): { prunedMeshCss: string; definedMeshVars: Set<string> } {
  const lines = meshCss.split(/\r?\n/u);
  const declMap = new Map<string, string[]>();
  const definedMeshVars = new Set<string>();

  for (const line of lines) {
    const m = line.match(/^\s*(--[\w-]+)\s*:\s*(.+);$/u);
    if (!m) continue;
    const [, name, val] = m;
    definedMeshVars.add(name);
    const list = declMap.get(name) ?? [];
    list.push(val);
    declMap.set(name, list);
  }

  // Seed with every --var referenced in page CSS, HTML, or mesh reset rules (lines outside :scope var decls).
  const keptVars = new Set<string>(["--spacing-1"]);
  for (const m of referenceText.matchAll(/--[\w-]+/gu)) {
    keptVars.add(m[0]);
  }
  for (const line of lines) {
    if (/^\s*--[\w-]+\s*:/u.test(line)) continue;
    for (const m of line.matchAll(/var\((--[\w-]+)/gu)) {
      keptVars.add(m[1]);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const v of [...keptVars]) {
      const vals = declMap.get(v);
      if (!vals) continue;
      for (const val of vals) {
        for (const m of val.matchAll(/var\((--[\w-]+)/gu)) {
          if (!keptVars.has(m[1])) {
            keptVars.add(m[1]);
            changed = true;
          }
        }
      }
    }
  }

  const keptLines = lines.filter((line) => {
    const m = line.match(/^\s*(--[\w-]+)\s*:/u);
    if (!m) return true;
    return keptVars.has(m[1]);
  });

  return { prunedMeshCss: keptLines.join("\n"), definedMeshVars };
}

/**
 * Prunes `site-astryx.css` (and optional `site-astryx-table.css`) to ONLY the
 * StyleX `.x...` rules whose classes appear in `html` (plus `extraClasses`),
 * keeping only transitively referenced `:root` tokens, `@property` and `@keyframes`.
 */
export function pruneAstryxCssForHtml(
  astryxCss: string,
  html: string,
  otherCss: string,
  extraClasses: readonly string[] = [],
  shadowedRootVars: ReadonlySet<string> = new Set(),
): string {
  const allowed = collectClassTokensFromHtml(html, extraClasses);

  const seedVars = new Set<string>();
  for (const m of otherCss.matchAll(/var\((--[\w-]+)/gu)) {
    seedVars.add(m[1]);
  }
  for (const m of html.matchAll(/--[\w-]+/gu)) {
    seedVars.add(m[0]);
  }

  const lines = astryxCss.split(/\r?\n/u);
  const resetLines: string[] = [];
  let inReset = false;
  let resetDepth = 0;

  const keptVars = new Set(seedVars);
  const keptKeyframes = new Set<string>();
  const ruleLines: string[] = [];
  const rootDecls = new Map<string, string>();

  for (const line of lines) {
    const t = line.trim();
    if (!inReset && t.startsWith("@layer reset {")) {
      inReset = true;
      resetDepth = 1;
      resetLines.push(line);
      continue;
    }
    if (inReset) {
      resetLines.push(line);
      for (const ch of t) {
        if (ch === "{") resetDepth++;
        else if (ch === "}") resetDepth--;
      }
      if (resetDepth <= 0) inReset = false;
      continue;
    }
    if (
      !t ||
      t.startsWith("/*") ||
      t.startsWith("@layer") ||
      t === "}" ||
      t.startsWith("@property") ||
      t.startsWith("@keyframes")
    ) {
      continue;
    }
    if (t.startsWith(":root")) {
      const body = t.slice(t.indexOf("{") + 1, t.lastIndexOf("}"));
      for (const part of body.split(";")) {
        const idx = part.indexOf(":");
        if (idx === -1) continue;
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        if (key.startsWith("--")) rootDecls.set(key, val);
      }
      continue;
    }
    // Static islands never set Astryx's React press state machine attribute.
    if (t.includes("data-astryx-press")) continue;
    const sel = unwrapSelector(t);
    const cls = [...sel.matchAll(/\.(x[0-9a-z]{5,7})\b/gu)].map((m) => m[1]);
    if (!cls.length) continue;
    if (!cls.every((c) => allowed.has(c))) continue;
    ruleLines.push(line);
    for (const m of line.matchAll(/--[\w-]+/gu)) keptVars.add(m[0]);
    for (const m of line.matchAll(/\bx[0-9a-z]{5,7}-B\b/gu)) {
      keptKeyframes.add(m[0]);
    }
  }

  for (const line of resetLines) {
    for (const m of line.matchAll(/var\((--[\w-]+)/gu)) keptVars.add(m[1]);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const v of [...keptVars]) {
      if (shadowedRootVars.has(v)) continue;
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

  const headerLines: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("@property ")) {
      const m = t.match(/@property\s+(--[\w-]+)/u);
      if (m && keptVars.has(m[1])) headerLines.push(line);
    } else if (t.startsWith("@keyframes ")) {
      const m = t.match(/@keyframes\s+([\w-]+)/u);
      if (m && keptKeyframes.has(m[1])) headerLines.push(line);
    }
  }

  const filteredRoot = [...rootDecls.entries()]
    .filter(([k]) => keptVars.has(k) && !shadowedRootVars.has(k))
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  if (filteredRoot) headerLines.push(`:root{${filteredRoot}}`);

  return [
    "@layer reset, astryx-base, astryx-theme;",
    ...resetLines,
    "@layer astryx-base {",
    ...headerLines,
    ...ruleLines,
    "}",
  ].join("\n");
}

// Popover styles for the lightweight Agents menu island (uses only mesh tokens).
const AGENTS_MENU_CSS = `
[data-site-agents-menu]{position:relative;display:inline-flex;align-items:center}
.site-agents-popover{position:absolute;top:calc(100% + var(--spacing-1));left:50%;transform:translateX(-50%);z-index:var(--layer-header);display:flex;flex-direction:column;gap:var(--spacing-1);min-width:var(--site-card-min);padding:var(--spacing-2);border-radius:var(--radius-container);border:var(--border-width) solid var(--color-border-emphasized);background:var(--color-background-popover);box-shadow:var(--shadow-high)}
.site-agents-popover[hidden]{display:none}
.site-agents-popover__item{display:flex;flex-direction:column;gap:var(--spacing-0-5);padding:var(--spacing-2) var(--spacing-3);border-radius:var(--radius-inner);text-decoration:none;color:var(--color-text-primary);transition:background-color var(--duration-fast) var(--ease-standard)}
.site-agents-popover__item:hover,.site-agents-popover__item:focus-visible{background:var(--color-overlay-hover);outline:none}
.site-agents-popover__item:focus-visible{box-shadow:inset 0 0 0 var(--focus-outline-width) var(--focus-outline-color)}
.site-agents-popover__title{font-weight:var(--font-weight-medium);font-size:var(--text-body-size);line-height:var(--text-body-leading);color:var(--color-text-primary)}
.site-agents-popover__desc{font-size:var(--text-supporting-size);line-height:var(--text-supporting-leading);color:var(--color-text-secondary)}
`;

// Skip initial layout and paint of below-the-fold sections until needed.
const BELOW_FOLD_CV_CSS: Record<"home" | "pricing" | "recipes", string> = {
  home: `.site-show,.site-steps,.site-features__head,.site-feature,.site-platform,.site-kinds,.site-plans,.site-faq,.site-close,.site-footer{content-visibility:auto;contain-intrinsic-size:auto var(--site-close-band)}`,
  pricing: `.site-price-compare,.site-faq,.site-footer{content-visibility:auto;contain-intrinsic-size:auto var(--site-close-band)}`,
  recipes: "",
};

export function buildMinifiedPageCss(options: {
  page: "home" | "pricing" | "recipes";
  bodyHtml: string;
  extraClasses?: readonly string[];
}): { inlineCss: string; fontsCss: string } {
  const esbuild = resolveEsbuild();
  const siteAstryx = fs.readFileSync(
    path.join(WEB_DIR, "src/site-astryx.css"),
    "utf8",
  );
  const meshCss = fs.readFileSync(
    path.join(WEB_DIR, "src/themes/mesh/mesh.css"),
    "utf8",
  );
  const rawSiteCss = fs.readFileSync(
    path.join(WEB_DIR, "app/(site)/site.css"),
    "utf8",
  );
  const { inlineSiteCss: unprunedSiteCss, fontsCss: rawFontsCss } =
    splitSiteFontsCss(rawSiteCss);

  const prunedSiteCss = pruneUnusedSiteCss(
    unprunedSiteCss,
    options.bodyHtml,
    options.extraClasses,
  );

  let extraPageCss = "";
  let combinedAstryx = siteAstryx;

  if (options.page === "pricing") {
    const tableAstryx = fs.readFileSync(
      path.join(WEB_DIR, "src/site-astryx-table.css"),
      "utf8",
    );
    combinedAstryx = `${siteAstryx}\n${tableAstryx}`;
    extraPageCss = fs.readFileSync(
      path.join(WEB_DIR, "components/site/parts.css"),
      "utf8",
    );
  } else if (options.page === "recipes") {
    extraPageCss = fs.readFileSync(
      path.join(WEB_DIR, "components/site/recipes.css"),
      "utf8",
    );
  }

  const pageCvCss = BELOW_FOLD_CV_CSS[options.page];
  const nonAstryxCss = [
    prunedSiteCss,
    extraPageCss,
    AGENTS_MENU_CSS,
    pageCvCss,
  ].join("\n");

  const { prunedMeshCss: initialMesh, definedMeshVars } = pruneMeshCssVars(
    meshCss,
    `${nonAstryxCss}\n${options.bodyHtml}`,
  );
  const prunedAstryx = pruneAstryxCssForHtml(
    combinedAstryx,
    options.bodyHtml,
    `${initialMesh}\n${nonAstryxCss}`,
    options.extraClasses ?? [],
    definedMeshVars,
  );
  const { prunedMeshCss } = pruneMeshCssVars(
    meshCss,
    `${prunedAstryx}\n${nonAstryxCss}\n${options.bodyHtml}`,
  );

  const combinedHead = [
    prunedAstryx,
    prunedMeshCss,
    prunedSiteCss,
    extraPageCss,
    AGENTS_MENU_CSS,
    pageCvCss,
  ].join("\n");

  const inlineCss = esbuild.transformSync(combinedHead, {
    loader: "css",
    minify: true,
  }).code;
  const fontsCss = esbuild.transformSync(rawFontsCss, {
    loader: "css",
    minify: true,
  }).code;

  return { inlineCss, fontsCss };
}

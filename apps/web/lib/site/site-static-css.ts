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
): string {
  const allowed = new Set<string>(extraClasses);
  for (const m of html.matchAll(/\bx[0-9a-z]{5,7}\b/gu)) {
    allowed.add(m[0]);
  }

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
    .filter(([k]) => keptVars.has(k))
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
  const { inlineSiteCss, fontsCss: rawFontsCss } =
    splitSiteFontsCss(rawSiteCss);

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

  const otherCss = [meshCss, inlineSiteCss, extraPageCss, AGENTS_MENU_CSS].join(
    "\n",
  );
  const prunedAstryx = pruneAstryxCssForHtml(
    combinedAstryx,
    options.bodyHtml,
    otherCss,
    options.extraClasses ?? [],
  );

  const combined = [
    prunedAstryx,
    meshCss,
    inlineSiteCss,
    extraPageCss,
    AGENTS_MENU_CSS,
  ].join("\n");

  const inlineCss = esbuild.transformSync(combined, {
    loader: "css",
    minify: true,
  }).code;
  const fontsCss = esbuild.transformSync(rawFontsCss, {
    loader: "css",
    minify: true,
  }).code;

  return { inlineCss, fontsCss };
}

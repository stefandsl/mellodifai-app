// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSiteStatic,
  verifySiteStaticOutput,
} from "../../scripts/build-site-static.mjs";
import {
  normalizeMeshLightDarkShadows,
  pruneAstryxCssForHtml,
  pruneMeshCssVars,
  pruneUnusedSiteCss,
  splitSiteFontsCss,
} from "./site-static-css";

const WEB_DIR = resolve(import.meta.dirname, "../..");
const TEST_TMP_PARENT = join(WEB_DIR, ".tmp-site-static-tests");

function makeRepoTmpDir(prefix: string): string {
  mkdirSync(TEST_TMP_PARENT, { recursive: true });
  return mkdtempSync(join(TEST_TMP_PARENT, prefix));
}

describe("static site CSS helpers", () => {
  it("splits /site/fonts/ @font-face rules while keeping metric-matched fallback faces inline", () => {
    const sample = [
      '@font-face { font-family: "Figtree"; src: url("/site/fonts/figtree.woff2") format("woff2"); }',
      '@font-face { font-family: "Figtree Fallback"; src: local("Segoe UI"); size-adjust: 100%; }',
      ".site-hero { color: var(--color-text-primary); }",
    ].join("\n");

    const { inlineSiteCss, fontsCss } = splitSiteFontsCss(sample);
    expect(fontsCss).toContain("/site/fonts/figtree.woff2");
    expect(fontsCss).not.toContain("Figtree Fallback");
    expect(inlineSiteCss).toContain("Figtree Fallback");
    expect(inlineSiteCss).toContain(".site-hero");
    expect(inlineSiteCss).not.toContain("/site/fonts/figtree.woff2");
  });

  it("prunes unused .site-* rules while preserving present classes, dynamic classes, and media blocks", () => {
    const css = [
      ".site-hero { display: flex; }",
      ".site-price-compare { display: grid; }",
      "@media (max-width: 48em) { .site-hero { padding: 0; } .site-price-compare { gap: 0; } }",
      ".site-menu-open { overflow: hidden; }",
    ].join("\n");

    const pruned = pruneUnusedSiteCss(
      css,
      '<section class="site-hero"></section>',
    );
    expect(pruned).toContain(".site-hero");
    expect(pruned).toContain(".site-menu-open");
    expect(pruned).not.toContain(".site-price-compare");
  });

  it("prunes unreferenced mesh custom properties while keeping transitive references and --spacing-1", () => {
    const mesh = [
      "@layer astryx-theme {",
      "  :scope {",
      "    --color-used: var(--color-helper);",
      "    --color-helper: rgb(1 2 3);",
      "    --color-unused: rgb(9 9 9);",
      "    --spacing-1: 0.25rem;",
      "  }",
      "}",
    ].join("\n");

    const { prunedMeshCss, definedMeshVars } = pruneMeshCssVars(
      mesh,
      ".a { color: var(--color-used); }",
    );
    expect(definedMeshVars.has("--color-used")).toBe(true);
    expect(prunedMeshCss).toContain("--color-used:");
    expect(prunedMeshCss).toContain("--color-helper:");
    expect(prunedMeshCss).toContain("--spacing-1:");
    expect(prunedMeshCss).not.toContain("--color-unused:");
  });

  it("moves light-dark() onto the color component of shadow tokens so native CSS parses them", () => {
    const raw =
      "--shadow-med: light-dark(0 12px 30px rgb(20 20 22 / 0.1), 0 12px 30px rgb(0 0 0 / 0.4));\n--glass-edge: light-dark(inset 0 1px 0 rgb(20 20 22 / 0.12), inset 0 1px 0 rgb(247 244 239 / 0.1));";
    const out = normalizeMeshLightDarkShadows(raw);
    expect(out).toContain(
      "--shadow-med: 0 12px 30px light-dark(rgb(20 20 22 / 0.1), rgb(0 0 0 / 0.4));",
    );
    expect(out).toContain(
      "--glass-edge: inset 0 1px 0 light-dark(rgb(20 20 22 / 0.12), rgb(247 244 239 / 0.1));",
    );
  });

  it("prunes Astryx StyleX rules to used classes, drops data-astryx-press, and omits shadowed :root vars", () => {
    const astryx = [
      "@layer reset { *, ::before { box-sizing: border-box; } }",
      "@layer astryx-base {",
      ":root{--used-only:1px;--shadowed:2px;--unused:3px}",
      ".x111111{padding:var(--used-only);margin:var(--shadowed)}",
      ".x111111[data-astryx-press=pressed]{opacity:.5}",
      ".x222222{color:var(--unused)}",
      "}",
    ].join("\n");

    const pruned = pruneAstryxCssForHtml(
      astryx,
      '<div class="x111111"></div>',
      "",
      [],
      new Set(["--shadowed"]),
    );
    expect(pruned).toContain(".x111111{");
    expect(pruned).not.toContain(".x222222");
    expect(pruned).not.toContain("data-astryx-press");
    expect(pruned).toContain("--used-only:1px");
    expect(pruned).not.toContain("--shadowed:");
    expect(pruned).not.toContain("--unused:");
  });
});

describe("buildSiteStatic prerender pipeline", () => {
  it("generates hashed assets, cleans stale files, keeps favicon.ico, and fails verification on missing output", async () => {
    const outDir = makeRepoTmpDir("build-");
    const staleFile = join(outDir, "stale-old-page.html");
    writeFileSync(staleFile, "stale", "utf8");

    try {
      const result = await buildSiteStatic(outDir);

      // Old files from previous builds must be removed.
      expect(existsSync(staleFile)).toBe(false);

      expect(result.pages).toEqual(
        expect.arrayContaining([
          "home-en.html",
          "home-it.html",
          "pricing-en.html",
          "pricing-it.html",
          "recipes-canvas-en.html",
          "recipes-canvas-it.html",
          "recipes-grid-en.html",
          "recipes-grid-it.html",
          "recipes-canvas-24-en.html",
          "recipes-canvas-24-it.html",
          "recipes-grid-24-en.html",
          "recipes-grid-24-it.html",
        ]),
      );

      // Island and fonts filenames are content-hashed.
      expect(result.fontsFile).toMatch(/^fonts\.[0-9a-f]{12}\.css$/u);
      expect(result.fontsUrl).toBe(`/site/styles/${result.fontsFile}`);
      expect(result.islands).toHaveLength(3);
      for (const base of ["home", "pricing", "recipes"] as const) {
        const hashed = result.islandFiles[base];
        expect(hashed).toMatch(
          new RegExp(`^${base}\\.[0-9a-f]{12}\\.js$`, "u"),
        );
        expect(result.islandUrls[base]).toBe(`/site/islands/${hashed}`);
      }

      const fontsCss = readFileSync(join(outDir, result.fontsFile), "utf8");
      expect(fontsCss).toContain("/site/fonts/");

      const expectedFaviconB64 = readFileSync(
        join(WEB_DIR, "app/favicon.ico"),
      ).toString("base64");

      for (const page of result.pages) {
        const html = readFileSync(join(outDir, page), "utf8");
        const lang = page.endsWith("-it.html") ? "it" : "en";
        expect(html.startsWith("<!DOCTYPE html>"), page).toBe(true);
        expect(html, page).toContain(`<html lang="${lang}"`);
        expect(html, page).toContain('data-astryx-theme="mesh"');
        expect(html, page).toContain("<style>");
        expect(html, page).toContain(
          `<noscript><link rel="stylesheet" href="${result.fontsUrl}"/></noscript>`,
        );
        expect(html, page).toContain(
          `data-site-fonts-url="${result.fontsUrl}"`,
        );
        // Restore app/favicon.ico (never replace with an inline SVG icon).
        if (page.startsWith("recipes-")) {
          expect(html, page).toContain(
            `href="data:image/x-icon;base64,${expectedFaviconB64}"`,
          );
        } else {
          expect(html, page).toContain('href="/favicon.ico"');
        }
        expect(html, page).not.toContain("data:image/svg+xml");
        expect(html, page).not.toContain("/_next/static/chunks/");

        const expectedIsland = page.startsWith("home-")
          ? result.islandUrls.home
          : page.startsWith("pricing-")
            ? result.islandUrls.pricing
            : result.islandUrls.recipes;
        expect(html, page).toContain(expectedIsland);
      }

      const recipesCanvas = readFileSync(
        join(outDir, "recipes-canvas-en.html"),
        "utf8",
      );
      expect(recipesCanvas).toContain(
        '<link rel="alternate" type="text/markdown" href="/recipes.md"/>',
      );
      expect(recipesCanvas).toContain("data:image/jpeg;base64,");

      for (const island of result.islands) {
        const full = join(outDir, "islands", island);
        expect(existsSync(full), island).toBe(true);
        const js = readFileSync(full, "utf8");
        expect(js.length, `${island} raw size`).toBeLessThan(25_000);
        expect(js, `${island} must not bundle Zod`).not.toContain("ZodError");
        expect(js, `${island} must not bundle React DOM`).not.toContain(
          "react-dom",
        );
        expect(js, `${island} embeds hashed fonts URL`).toContain(
          result.fontsUrl,
        );
      }

      // Verification passes on complete output, and throws if a page or island goes missing.
      expect(() => verifySiteStaticOutput(outDir)).not.toThrow();

      rmSync(join(outDir, "home-en.html"));
      expect(() => verifySiteStaticOutput(outDir)).toThrow(/home-en\.html/u);

      writeFileSync(join(outDir, "home-en.html"), "<html></html>", "utf8");
      rmSync(join(outDir, "islands", result.islandFiles.home));
      expect(() => verifySiteStaticOutput(outDir)).toThrow(
        new RegExp(result.islandFiles.home.replaceAll(".", "\\."), "u"),
      );
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(TEST_TMP_PARENT, { recursive: true, force: true });
    }
  }, 30_000);

  it("runs as a CLI entrypoint even when invoked through a directory junction or symlink", () => {
    const tmpRoot = makeRepoTmpDir("junction-");
    const linkScripts = join(tmpRoot, "scripts-link");
    const outDir = join(tmpRoot, "out");
    try {
      symlinkSync(
        join(WEB_DIR, "scripts"),
        linkScripts,
        process.platform === "win32" ? "junction" : "dir",
      );
      execFileSync(
        process.execPath,
        [join(linkScripts, "build-site-static.mjs")],
        {
          cwd: WEB_DIR,
          env: { ...process.env, SITE_STATIC_OUT_DIR: outDir },
          stdio: "pipe",
        },
      );
      expect(() => verifySiteStaticOutput(outDir)).not.toThrow();
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
      rmSync(TEST_TMP_PARENT, { recursive: true, force: true });
    }
  }, 30_000);
});

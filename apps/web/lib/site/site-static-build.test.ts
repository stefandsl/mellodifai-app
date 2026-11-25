// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSiteStatic } from "../../scripts/build-site-static.mjs";
import {
  pruneAstryxCssForHtml,
  pruneMeshCssVars,
  pruneUnusedSiteCss,
  splitSiteFontsCss,
} from "./site-static-css";

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
  it("generates all static public HTML documents and tiny React-free, Zod-free island bundles", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "mellodifai-site-static-"));
    try {
      const result = await buildSiteStatic(outDir);
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
      expect(result.islands.sort()).toEqual([
        "home.js",
        "pricing.js",
        "recipes.js",
      ]);

      const fontsCss = readFileSync(join(outDir, "fonts.css"), "utf8");
      expect(fontsCss).toContain("/site/fonts/");

      for (const page of result.pages) {
        const html = readFileSync(join(outDir, page), "utf8");
        const lang = page.endsWith("-it.html") ? "it" : "en";
        expect(html.startsWith("<!DOCTYPE html>"), page).toBe(true);
        expect(html, page).toContain(`<html lang="${lang}"`);
        expect(html, page).toContain('data-astryx-theme="mesh"');
        expect(html, page).toContain("<style>");
        expect(html, page).toContain(
          '<noscript><link rel="stylesheet" href="/site/fonts.css"/></noscript>',
        );
        expect(html, page).not.toContain("/_next/static/chunks/");
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
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 30_000);
});

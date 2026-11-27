// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSafeOutDir,
  buildSiteStatic,
  verifySiteStaticOutput,
} from "../../scripts/build-site-static.mjs";
import { SITE_STATIC_SOURCES } from "./serve-static-site";
import {
  normalizeMeshLightDarkShadows,
  pruneAstryxCssForHtml,
  pruneMeshCssVars,
  pruneUnusedMeshBlocks,
  pruneUnusedSiteCss,
  splitSiteFontsCss,
} from "./site-static-css";

const WEB_DIR = resolve(import.meta.dirname, "../..");
const REPO_ROOT = resolve(WEB_DIR, "../..");
// At the repo root, outside apps/web: the root node_modules has no @astryxdesign/core, so a
// build here fails if the prerender runner is written into the output folder.
const TEST_TMP_PARENT = join(REPO_ROOT, ".tmp-site-static-tests");

function makeRepoTmpDir(prefix: string): string {
  mkdirSync(TEST_TMP_PARENT, { recursive: true });
  return mkdtempSync(join(TEST_TMP_PARENT, prefix));
}

function outsideTmpParent(): string {
  const realRepo = realpathSync.native(REPO_ROOT);
  for (const candidate of [
    process.env.TEMP,
    process.env.TMP,
    process.env.RUNNER_TEMP,
  ]) {
    if (!candidate || !existsSync(candidate)) continue;
    if (process.platform === "win32" && /^[cC]:/u.test(candidate)) continue;
    const realCandidate = realpathSync.native(candidate);
    const rel = relative(realRepo, realCandidate);
    const insideRepo =
      rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    if (!insideRepo) return realCandidate;
  }
  return resolve(REPO_ROOT, "..");
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

  it("prunes unused mesh reset tag blocks and only the balanced media-dark-page block while preserving later rules", () => {
    const sample = [
      "@layer reset { :where(h1) { font-size: 2rem; } :where(h4) { font-size: 1rem; } :where(hr) { border: 0; } }",
      '@layer astryx-theme { @scope ([data-astryx-theme="mesh"]) { :scope { --a: 1; } } }',
      '@layer astryx-theme { @scope ([data-astryx-theme="mesh"]) { [data-astryx-media="dark"] { color-scheme: dark; } } }',
      "@layer astryx-theme { .later-theme-rule { color: var(--a); } }",
    ].join("\n");

    const pruned = pruneUnusedMeshBlocks(sample, "<h1>Title</h1>");
    expect(pruned).toContain(":where(h1)");
    expect(pruned).not.toContain(":where(h4)");
    expect(pruned).not.toContain(":where(hr)");
    expect(pruned).not.toContain('data-astryx-media="dark"');
    expect(pruned).toContain(".later-theme-rule");

    const kept = pruneUnusedMeshBlocks(
      sample,
      '<h4 data-astryx-media="dark">Sub</h4><hr/>',
    );
    expect(kept).toContain(":where(h4)");
    expect(kept).toContain(":where(hr)");
    expect(kept).toContain('data-astryx-media="dark"');
    expect(kept).toContain(".later-theme-rule");

    const mixedBlock = [
      '@layer astryx-theme { @scope ([data-astryx-theme="mesh"]) {',
      '  [data-astryx-media="dark"] { color-scheme: dark; }',
      "  .non-media-rule { color: red; }",
      "} }",
    ].join("\n");
    expect(() => pruneUnusedMeshBlocks(mixedBlock, "<h1>Title</h1>")).toThrow(
      /non-media rules/u,
    );

    const mixedSelectorList = [
      '@layer astryx-theme { @scope ([data-astryx-theme="mesh"]) {',
      '  .keep-me, [data-astryx-media="dark"] .x { color: red; }',
      "} }",
    ].join("\n");
    expect(() =>
      pruneUnusedMeshBlocks(mixedSelectorList, "<h1>Title</h1>"),
    ).toThrow(/non-media rules/u);
  });

  it("prunes Astryx StyleX rules to used classes, drops data-astryx-press and absent attribute selectors, and omits shadowed :root vars", () => {
    const astryx = [
      "@layer reset { *, ::before { box-sizing: border-box; } }",
      "@layer astryx-base {",
      ":root{--used-only:1px;--shadowed:2px;--unused:3px}",
      ".x111111{padding:var(--used-only);margin:var(--shadowed)}",
      ".x111111[data-astryx-press=pressed]{opacity:.5}",
      '.x111111[aria-disabled="true"]{opacity:.4}',
      '[data-container-corner="top"] .x111111{border-radius:0}',
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
    expect(pruned).not.toContain('aria-disabled="true"');
    expect(pruned).not.toContain("data-container-corner");
    expect(pruned).toContain("--used-only:1px");
    expect(pruned).not.toContain("--shadowed:");
    expect(pruned).not.toContain("--unused:");

    // Rules are preserved when the HTML actually contains those attributes.
    const kept = pruneAstryxCssForHtml(
      astryx,
      '<div class="x111111" aria-disabled="true" data-container-corner="top"></div>',
      "",
    );
    expect(kept).toContain('aria-disabled="true"');
    expect(kept).toContain("data-container-corner");
  });
});

describe("buildSiteStatic prerender pipeline", () => {
  it("generates hashed assets, cleans stale files, keeps favicon.ico, and fails verification on missing output", async () => {
    const outDir = makeRepoTmpDir("build-");
    // A previous build's folder (marked with .site-static-output) with a stale file left in it.
    writeFileSync(join(outDir, ".site-static-output"), "", "utf8");
    const staleFile = join(outDir, "stale-old-page.html");
    writeFileSync(staleFile, "stale", "utf8");

    try {
      const result = await buildSiteStatic(outDir);

      // Old files from previous builds must be removed.
      expect(existsSync(staleFile)).toBe(false);
      // The prerender runner never lands in the output folder.
      expect(readdirSync(outDir).filter((f) => f.endsWith(".mjs"))).toEqual([]);

      // Every bundled source file sits under a path the dev server watches.
      expect(result.sourceInputs).toContain(
        "apps/web/lib/site/render-static-entry.tsx",
      );
      const unwatched = result.sourceInputs.filter(
        (input) =>
          !SITE_STATIC_SOURCES.some(
            (src) => input === src || input.startsWith(`${src}/`),
          ),
      );
      expect(unwatched).toEqual([]);

      expect(result.pages).toEqual(
        expect.arrayContaining([
          "home-en.html",
          "home-it.html",
          "pricing-en.html",
          "pricing-it.html",
          "not-found-en.html",
          "not-found-it.html",
          "recipes-canvas-en.html",
          "recipes-canvas-it.html",
          "recipes-grid-en.html",
          "recipes-grid-it.html",
          "recipes-canvas-24-en.html",
          "recipes-canvas-24-it.html",
          "recipes-grid-24-en.html",
          "recipes-grid-24-it.html",
          "recipe-acoustic-voice-swap-en.html",
          "recipe-acoustic-voice-swap-it.html",
          "recipe-group-chat-ballad-en.html",
          "recipe-group-chat-ballad-it.html",
        ]),
      );

      // Island and fonts filenames are content-hashed.
      expect(result.fontsFile).toMatch(/^fonts\.[0-9a-f]{12}\.css$/u);
      expect(result.fontsUrl).toBe(`/site/styles/${result.fontsFile}`);
      expect(result.islands).toHaveLength(4);
      for (const base of [
        "home",
        "pricing",
        "recipes",
        "recipe-detail",
      ] as const) {
        const hashed = result.islandFiles[base];
        expect(hashed).toMatch(
          new RegExp(`^${base}\\.[0-9a-f]{12}\\.js$`, "u"),
        );
        expect(result.islandUrls[base]).toBe(`/site/islands/${hashed}`);
      }

      const fontsCss = readFileSync(join(outDir, result.fontsFile), "utf8");
      expect(fontsCss).toContain("/site/fonts/");

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
        // app/favicon.ico on every page, never inlined.
        expect(html, page).toContain(
          '<link rel="icon" href="/favicon.ico" sizes="64x64" type="image/x-icon"/>',
        );
        expect(html, page).not.toContain("data:image/x-icon");
        expect(html, page).not.toContain("data:image/svg+xml");
        expect(html, page).not.toContain("/_next/static/chunks/");

        const expectedIsland = page.startsWith("home-")
          ? result.islandUrls.home
          : page.startsWith("pricing-")
            ? result.islandUrls.pricing
            : page.startsWith("recipe-")
              ? result.islandUrls["recipe-detail"]
              : page.startsWith("not-found-")
                ? null
                : result.islandUrls.recipes;
        if (expectedIsland) {
          expect(html, page).toContain(expectedIsland);
        }
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
      rmSync(join(outDir, "recipe-acoustic-voice-swap-en.html"));
      expect(() => verifySiteStaticOutput(outDir)).toThrow(
        /recipe-acoustic-voice-swap-en\.html/u,
      );

      writeFileSync(
        join(outDir, "recipe-acoustic-voice-swap-en.html"),
        "<html></html>",
        "utf8",
      );
      rmSync(join(outDir, "islands", result.islandFiles.home));
      expect(() => verifySiteStaticOutput(outDir)).toThrow(
        new RegExp(result.islandFiles.home.replaceAll(".", "\\."), "u"),
      );
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(TEST_TMP_PARENT, { recursive: true, force: true });
    }
  }, 30_000);

  it("rejects when an expected output is missing at the output check", async () => {
    const outDir = makeRepoTmpDir("verify-");
    try {
      await expect(
        buildSiteStatic(outDir, {
          beforeVerify: (dir: string) => rmSync(join(dir, "pricing-it.html")),
        }),
      ).rejects.toThrow(/missing expected output .*pricing-it\.html/u);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(TEST_TMP_PARENT, { recursive: true, force: true });
    }
  }, 30_000);

  it("refuses an output folder outside the repo, tracked folders, or bare manifest folders before removing anything", async () => {
    const outside = mkdtempSync(
      join(outsideTmpParent(), ".tmp-site-static-guard-"),
    );
    const outsideSentinel = join(outside, "keep.txt");
    writeFileSync(outsideSentinel, "keep", "utf8");
    const notABuild = makeRepoTmpDir("not-a-build-");
    const notABuildSentinel = join(notABuild, "keep.txt");
    writeFileSync(notABuildSentinel, "keep", "utf8");
    const bareManifest = makeRepoTmpDir("bare-manifest-");
    writeFileSync(join(bareManifest, "manifest.json"), "{}", "utf8");
    const bareManifestSentinel = join(bareManifest, "keep.txt");
    writeFileSync(bareManifestSentinel, "keep", "utf8");
    const junctionParent = mkdtempSync(
      join(outsideTmpParent(), ".tmp-site-static-junction-"),
    );
    const checkoutLink = join(junctionParent, "repo-link");
    try {
      await expect(buildSiteStatic(outside)).rejects.toThrow(
        /outside the repo/u,
      );
      expect(existsSync(outsideSentinel)).toBe(true);

      await expect(buildSiteStatic(notABuild)).rejects.toThrow(
        /not a previous static site build/u,
      );
      expect(existsSync(notABuildSentinel)).toBe(true);

      await expect(buildSiteStatic(bareManifest)).rejects.toThrow(
        /not a previous static site build/u,
      );
      expect(existsSync(bareManifestSentinel)).toBe(true);

      const trackedWithManifest = join(REPO_ROOT, "ops", "lib", "native");
      expect(existsSync(join(trackedWithManifest, "manifest.json"))).toBe(true);
      expect(() => assertSafeOutDir(trackedWithManifest)).toThrow(
        /git-tracked/u,
      );

      for (const dangerous of [
        REPO_ROOT,
        resolve(REPO_ROOT, ".."),
        join(REPO_ROOT, "apps"),
        WEB_DIR,
        join(WEB_DIR, "lib"),
        join(WEB_DIR, "node_modules", "site-static"),
        join(REPO_ROOT, ".git", "site-static"),
        join(WEB_DIR, "package.json"),
      ]) {
        expect(() => assertSafeOutDir(dangerous), dangerous).toThrow(
          /build-site-static: refusing/u,
        );
      }

      const realWebDir = realpathSync.native(WEB_DIR);
      expect(assertSafeOutDir(join(WEB_DIR, ".next", "site-static"))).toBe(
        join(realWebDir, ".next", "site-static"),
      );

      symlinkSync(
        REPO_ROOT,
        checkoutLink,
        process.platform === "win32" ? "junction" : "dir",
      );
      const viaJunction = join(
        checkoutLink,
        "apps",
        "web",
        ".next",
        "site-static-via-junction",
      );
      expect(assertSafeOutDir(viaJunction)).toBe(
        join(realWebDir, ".next", "site-static-via-junction"),
      );
      expect(() =>
        assertSafeOutDir(join(checkoutLink, "ops", "lib", "native")),
      ).toThrow(/git-tracked/u);
    } finally {
      rmSync(junctionParent, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
      rmSync(notABuild, { recursive: true, force: true });
      rmSync(bareManifest, { recursive: true, force: true });
      rmSync(TEST_TMP_PARENT, { recursive: true, force: true });
    }
  });

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

// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { RecipeSchema, searchRecipesLocal } from "@mellodifai/shared";
import { describe, expect, it } from "vitest";
import {
  ARROW_PAN_STEP,
  applyWheelZoom,
  canvasCardRect,
  canvasCardStyle,
  clampZoom,
  computeVisibleCanvasCards,
  MAX_CANVAS_DOM_CARDS,
  placeCanvasRecipes,
  stepZoom,
  ZOOM_STEPS,
  zoomAroundAnchor,
} from "./recipe-canvas-layout";
import { buildRecipeTestFixture } from "./recipes.fixture";

describe("recipe test fixture (24 schema-validated records)", () => {
  it("produces 24 distinct recipes that all pass RecipeSchema and have bilingual texts", () => {
    const fixture = buildRecipeTestFixture(24);
    expect(fixture).toHaveLength(24);
    const ids = new Set(fixture.map((r) => r.id));
    const slugs = new Set(fixture.map((r) => r.slug));
    expect(ids.size).toBe(24);
    expect(slugs.size).toBe(24);
    for (const item of fixture) {
      const { mediaUrls: _u, targets: _t, ...raw } = item;
      expect(RecipeSchema.safeParse(raw).success, item.slug).toBe(true);
      expect(item.title.en.length).toBeGreaterThanOrEqual(3);
      expect(item.title.it.length).toBeGreaterThanOrEqual(3);
      expect(item.mediaUrls.cover).toMatch(/^\/site\/recipes\//u);
    }
  });
});

describe("recipe canvas layout and virtualization", () => {
  const recipes24 = buildRecipeTestFixture(24);

  it("caps DOM cards at <= 20 at 1440x900 across all zoom levels for 24 recipes", () => {
    const placements = placeCanvasRecipes(recipes24, {
      viewportWidth: 1440,
      viewportHeight: 900,
    });
    expect(placements).toHaveLength(24);

    for (const zoom of ZOOM_STEPS) {
      const visible = computeVisibleCanvasCards({
        placements,
        viewportWidth: 1440,
        viewportHeight: 900,
        panX: 0,
        panY: 0,
        zoom,
      });
      expect(visible.length, `zoom ${zoom}`).toBeGreaterThan(0);
      expect(visible.length, `zoom ${zoom}`).toBeLessThanOrEqual(
        MAX_CANVAS_DOM_CARDS,
      );
      expect(MAX_CANVAS_DOM_CARDS).toBeLessThanOrEqual(20);
    }

    // At 100% zoom, virtualization mounts a subset of the 24 recipes (not all 24).
    const initial = computeVisibleCanvasCards({
      placements,
      viewportWidth: 1440,
      viewportHeight: 900,
      panX: 0,
      panY: 0,
      zoom: 100,
    });
    expect(initial.length).toBeLessThan(24);
  });

  it("moves every card by exactly the drag delta (300 px) with 1:1 pan", () => {
    const placements = placeCanvasRecipes(recipes24, {
      viewportWidth: 1440,
      viewportHeight: 900,
    });
    for (const p of placements) {
      const before = canvasCardRect(p, {
        viewportWidth: 1440,
        viewportHeight: 900,
        panX: 0,
        panY: 0,
        zoom: 100,
      });
      const after = canvasCardRect(p, {
        viewportWidth: 1440,
        viewportHeight: 900,
        panX: -300,
        panY: -200,
        zoom: 100,
      });
      expect(after.x - before.x).toBe(-300);
      expect(after.y - before.y).toBe(-200);
    }
  });

  it("scales card dimensions cleanly across zoom steps 50, 75, 100, 125, 150", () => {
    expect([...ZOOM_STEPS]).toEqual([50, 75, 100, 125, 150]);
    expect(clampZoom(20)).toBe(50);
    expect(clampZoom(200)).toBe(150);
    expect(stepZoom(100, -1)).toBe(75);
    expect(stepZoom(75, -1)).toBe(50);
    expect(stepZoom(50, -1)).toBe(50);
    expect(stepZoom(100, 1)).toBe(125);
    expect(stepZoom(125, 1)).toBe(150);
    expect(stepZoom(150, 1)).toBe(150);
    expect(ARROW_PAN_STEP).toBe(120);

    const placements = placeCanvasRecipes(recipes24, {
      viewportWidth: 1440,
      viewportHeight: 900,
    });
    const vertical = placements.find((p) => p.recipe.format === "9:16");
    expect(vertical).toBeDefined();
    if (!vertical) return;
    const at100 = canvasCardRect(vertical, {
      viewportWidth: 1440,
      viewportHeight: 900,
      panX: 0,
      panY: 0,
      zoom: 100,
    });
    const at75 = canvasCardRect(vertical, {
      viewportWidth: 1440,
      viewportHeight: 900,
      panX: 0,
      panY: 0,
      zoom: 75,
    });
    expect(at100.width).toBe(168);
    expect(at100.height).toBe(299);
    expect(Math.round(at75.width)).toBe(126);
    expect(Math.round(at75.height)).toBe(224);
  });

  it("brings matching cards to the visible set when searching locally", () => {
    const search = searchRecipesLocal(recipes24, "tiktok", "en");
    const matchIds = new Set(search.matches.map((m) => m.id));
    expect(matchIds.size).toBeGreaterThan(0);
    const placements = placeCanvasRecipes(recipes24, {
      viewportWidth: 1440,
      viewportHeight: 900,
      matchIds,
    });
    const visible = computeVisibleCanvasCards({
      placements,
      viewportWidth: 1440,
      viewportHeight: 900,
      panX: 0,
      panY: 0,
      zoom: 100,
      matchIds,
    });
    expect(visible.length).toBeLessThanOrEqual(MAX_CANVAS_DOM_CARDS);
    expect(visible.some((v) => matchIds.has(v.recipe.id))).toBe(true);
  });

  it("never drops a card whose box intersects the viewport across all zooms, pans and screen sizes", () => {
    const placements = placeCanvasRecipes(recipes24, {
      viewportWidth: 1440,
      viewportHeight: 900,
    });
    const viewports = [
      [1440, 900],
      [1920, 1080],
      [2560, 1440],
    ] as const;
    const pans = [-600, -300, 0, 300, 600] as const;

    for (const [viewportWidth, viewportHeight] of viewports) {
      for (const zoom of ZOOM_STEPS) {
        for (const panX of pans) {
          for (const panY of [-400, 0, 400]) {
            const visible = computeVisibleCanvasCards({
              placements,
              viewportWidth,
              viewportHeight,
              panX,
              panY,
              zoom,
            });
            const visibleIds = new Set(visible.map((v) => v.recipe.id));
            const intersecting = placements.filter((p) => {
              const r = canvasCardRect(p, {
                viewportWidth,
                viewportHeight,
                panX,
                panY,
                zoom,
              });
              return (
                r.x + r.width >= 0 &&
                r.x <= viewportWidth &&
                r.y + r.height >= 0 &&
                r.y <= viewportHeight
              );
            });
            for (const p of intersecting) {
              expect(
                visibleIds.has(p.recipe.id),
                `dropped on-screen card ${p.recipe.slug} (slot ${p.slotIndex}) at ${viewportWidth}x${viewportHeight} zoom=${zoom} pan=(${panX},${panY})`,
              ).toBe(true);
            }
            if (viewportWidth === 1440 && viewportHeight === 900) {
              expect(
                visible.length,
                `DOM cap exceeded at 1440x900 zoom=${zoom} pan=(${panX},${panY})`,
              ).toBeLessThanOrEqual(MAX_CANVAS_DOM_CARDS);
            }
          }
        }
      }
    }
  });

  it("computes viewport-independent CSS positioning so first paint matches at 390 and 1440", () => {
    const placements = placeCanvasRecipes(recipes24, {
      viewportWidth: 1440,
      viewportHeight: 900,
    });
    const visible390 = computeVisibleCanvasCards({
      placements,
      viewportWidth: 390,
      viewportHeight: 844,
      panX: 0,
      panY: 0,
      zoom: 100,
    });
    const visible1440 = computeVisibleCanvasCards({
      placements,
      viewportWidth: 1440,
      viewportHeight: 900,
      panX: 0,
      panY: 0,
      zoom: 100,
    });
    expect(visible390.length).toBeGreaterThan(0);
    const first390 = visible390[0];
    expect(first390).toBeDefined();
    if (!first390) return;
    const match1440 = visible1440.find(
      (c) => c.recipe.id === first390.recipe.id,
    );
    expect(match1440).toBeDefined();
    if (!match1440) return;

    // First card order near centre and CSS custom properties must not shift with viewport size.
    expect(visible1440[0]?.recipe.id).toBe(first390.recipe.id);
    expect(canvasCardStyle(first390)).toEqual(canvasCardStyle(match1440));
  });

  it("anchors zoom around viewport centre and arbitrary pointer positions after a pan", () => {
    const start = { panX: 600, panY: -240, zoom: 100 };
    // Viewport centre anchor (0, 0): world point (-600, 240) stays at (0, 0).
    const out = zoomAroundAnchor(start, 50, 0, 0);
    expect(out.zoom).toBe(50);
    expect(out.panX).toBeCloseTo(300, 6);
    expect(out.panY).toBeCloseTo(-120, 6);

    // Off-centre pointer anchor (anchorRelX=320, anchorRelY=-190):
    const anchorRelX = 320;
    const anchorRelY = -190;
    const worldBeforeX = (anchorRelX - start.panX) / (start.zoom / 100);
    const worldBeforeY = (anchorRelY - start.panY) / (start.zoom / 100);
    const zoomed = zoomAroundAnchor(start, 125, anchorRelX, anchorRelY);
    const screenAfterX = worldBeforeX * (zoomed.zoom / 100) + zoomed.panX;
    const screenAfterY = worldBeforeY * (zoomed.zoom / 100) + zoomed.panY;
    expect(screenAfterX).toBeCloseTo(anchorRelX, 6);
    expect(screenAfterY).toBeCloseTo(anchorRelY, 6);
  });

  it("accumulates small Ctrl+wheel deltas continuously without jumping limit to limit", () => {
    let zoom = 100;
    for (let i = 0; i < 8; i += 1) {
      zoom = applyWheelZoom(zoom, -4);
    }
    expect(zoom).toBeGreaterThan(105);
    expect(zoom).toBeLessThan(120);
    for (let i = 0; i < 8; i += 1) {
      zoom = applyWheelZoom(zoom, 4);
    }
    expect(zoom).toBeCloseTo(100, 4);

    // Stepping from an intermediate continuous zoom snaps cleanly to the next 25% step.
    expect(stepZoom(112, 1)).toBe(125);
    expect(stepZoom(112, -1)).toBe(100);
    expect(stepZoom(88, 1)).toBe(100);
    expect(stepZoom(88, -1)).toBe(75);
  });
});

describe("recipes client bundle stays free of zod", () => {
  const repoRoot = resolve(import.meta.dirname, "../../../..");

  it("does not import runtime schema or zod in shared recipe search or recipes-index client", () => {
    const searchSrc = readFileSync(
      join(repoRoot, "packages/shared/src/recipes/search.ts"),
      "utf8",
    );
    expect(searchSrc).not.toMatch(/from\s+["']zod["']/u);
    expect(searchSrc).not.toMatch(
      /import\s+\{[^}]*\btargetsForRecipe\b[^}]*\}\s+from\s+["']\.\/schema\.js["']/u,
    );

    const indexSrc = readFileSync(
      join(repoRoot, "apps/web/components/site/recipes-index.tsx"),
      "utf8",
    );
    expect(indexSrc).not.toMatch(/from\s+["']zod["']/u);
    expect(indexSrc).not.toMatch(
      /import\s+(?!type\b)[^;]+from\s+["']@mellodifai\/shared["']/u,
    );
  });

  it("ships zero ZodError references in any built /recipes client chunk when .next exists", () => {
    const nextDir = join(repoRoot, "apps/web/.next");
    const manifestPath = join(
      nextDir,
      "server/app/(site)/recipes/page_client-reference-manifest.js",
    );
    if (!existsSync(manifestPath)) return;

    const manifestText = readFileSync(manifestPath, "utf8");
    const chunks = [
      ...new Set(
        [...manifestText.matchAll(/static\/chunks\/[a-zA-Z0-9._-]+\.js/gu)].map(
          (m) => m[0],
        ),
      ),
    ];
    expect(chunks.length).toBeGreaterThan(0);

    const offending = chunks.filter((rel) => {
      const full = join(nextDir, rel);
      return (
        existsSync(full) && readFileSync(full, "utf8").includes("ZodError")
      );
    });
    expect(offending).toEqual([]);
  });
});

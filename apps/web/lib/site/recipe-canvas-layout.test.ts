// @vitest-environment node
import { RecipeSchema, searchRecipesLocal } from "@mellodifai/shared";
import { describe, expect, it } from "vitest";
import {
  ARROW_PAN_STEP,
  canvasCardRect,
  clampZoom,
  computeVisibleCanvasCards,
  MAX_CANVAS_DOM_CARDS,
  placeCanvasRecipes,
  stepZoom,
  ZOOM_STEPS,
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
});

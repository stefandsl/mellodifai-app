import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { SITE_COPY } from "../../lib/site/copy";
import { cleanRoom } from "../../lib/site/judge/clean-room";
import {
  compareLayout,
  type LayoutRef,
  measureLayoutInPage,
} from "../../lib/site/judge/likeness";
import { collectPageText } from "../../lib/site/judge/page-text";
import {
  canvasCardRect,
  placeCanvasRecipes,
  ZOOM_STEPS,
} from "../../lib/site/recipe-canvas-layout";
import { buildRecipeTestFixture } from "../../lib/site/recipes.fixture";

// Recipes index (C05) on Chromium, Firefox and WebKit at 1440, 1024 and 390.
// Tests both the real 12 C14 recipes and the 24-recipe test fixture (for DOM cap & dense columns).
const WIDTHS = [
  [1440, 900, 5],
  [1024, 768, 4],
  [390, 844, 2],
] as const;

const en = SITE_COPY.en;
const itCopy = SITE_COPY.it;

async function open(page: Page, path = "/recipes") {
  await page.goto(path);
  await expect(page.locator(".site-header")).toHaveAttribute(
    "data-scrolled",
    "false",
  );
  if (!path.includes("view=grid")) {
    await expect(
      page.locator('[data-recipes-canvas-stage="true"]'),
    ).toHaveAttribute("data-ready", "true");
  }
  await page.waitForFunction(() => {
    if (!document.documentElement.hasAttribute("data-site-fonts-url")) {
      return true;
    }
    const link = document.querySelector<HTMLLinkElement>(
      'link[data-site-fonts="true"]',
    );
    return Boolean(link?.sheet);
  });
  await page.evaluate(() => document.fonts.ready);
}

async function cardBoxes(page: Page) {
  return page.locator('[data-recipe-card="canvas"]').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        slug: el.getAttribute("data-recipe-slug") ?? "",
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
      };
    }),
  );
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    {
      name: "mellodifai_lang",
      value: "en",
      url: baseURL ?? "http://127.0.0.1",
    },
  ]);
});

for (const [width, height] of [
  [1440, 900],
  [1024, 768],
  [390, 844],
] as const) {
  test(`canvas at ${width}x${height}: viewport locked, 300 px drag is 1:1 with zero inertia, wheel pan & Ctrl+wheel zoom`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const apiRequests: string[] = [];
    page.on("request", (req) => {
      if (new URL(req.url()).pathname.startsWith("/api/v1/recipes")) {
        apiRequests.push(req.url());
      }
    });

    await open(page, "/recipes");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText(en.recipes.title);

    // Embedded catalog: zero list/search API calls on load.
    expect(apiRequests).toEqual([]);

    // Viewport locked, no page scroll, footer hidden in canvas view.
    const frame = await page.evaluate(() => ({
      scrollH: document.documentElement.scrollHeight,
      innerH: window.innerHeight,
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      footerVisible:
        getComputedStyle(document.querySelector(".site-footer") as Element)
          .display !== "none",
    }));
    expect(frame.scrollH).toBeLessThanOrEqual(frame.innerH + 1);
    expect(frame.scrollW).toBeLessThanOrEqual(frame.innerW + 1);
    expect(frame.footerVisible).toBe(false);

    // Canvas cursor and touch-action contract.
    const stage = page.locator('[data-recipes-canvas-stage="true"]');
    const stageCss = await stage.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        cursor: s.cursor,
        touchAction: s.touchAction,
      };
    });
    expect(stageCss.cursor).toBe("grab");
    expect(stageCss.touchAction).toBe("none");

    // 300 px horizontal drag moves every visible card by 300 px +/- 2 px, no movement 200 ms after release.
    const dragDx = -300;
    const dragDy = 0;
    const startX = width - 40;
    const startY = 150;

    const before = await cardBoxes(page);
    expect(before.length).toBeGreaterThan(0);

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + dragDx / 2, startY + dragDy / 2, {
      steps: 4,
    });
    await expect(stage).toHaveAttribute("data-dragging", "true");
    await page.mouse.move(startX + dragDx, startY + dragDy, { steps: 4 });
    await page.mouse.up();

    const atRelease = await cardBoxes(page);
    const beforeBySlug = new Map(before.map((c) => [c.slug, c]));
    let compared = 0;
    for (const card of atRelease) {
      const prev = beforeBySlug.get(card.slug);
      if (!prev) continue;
      compared += 1;
      expect(Math.abs(card.x - prev.x - dragDx)).toBeLessThanOrEqual(2);
      expect(Math.abs(card.y - prev.y - dragDy)).toBeLessThanOrEqual(2);
    }
    expect(compared).toBeGreaterThan(0);

    // Zero inertia: positions 200 ms and 400 ms after release match release exactly.
    await page.waitForTimeout(220);
    const after200 = await cardBoxes(page);
    await page.waitForTimeout(200);
    const after400 = await cardBoxes(page);
    const releaseBySlug = new Map(atRelease.map((c) => [c.slug, c]));
    for (const snap of [after200, after400]) {
      for (const card of snap) {
        const rel = releaseBySlug.get(card.slug);
        if (!rel) continue;
        expect(Math.abs(card.x - rel.x)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(card.y - rel.y)).toBeLessThanOrEqual(0.5);
      }
    }

    // Wheel pan keeps document scroll at 0 and moves cards 1:1.
    const preWheel = await cardBoxes(page);
    await page.mouse.move(startX, startY);
    await page.mouse.wheel(100, 80);
    await page.waitForTimeout(50);
    const postWheel = await cardBoxes(page);
    const scrollAfterWheel = await page.evaluate(() => window.scrollY);
    expect(scrollAfterWheel).toBe(0);
    const preWheelBySlug = new Map(preWheel.map((c) => [c.slug, c]));
    let wheelCompared = 0;
    for (const card of postWheel) {
      const prev = preWheelBySlug.get(card.slug);
      if (!prev) continue;
      wheelCompared += 1;
      expect(Math.abs(card.x - prev.x - -100)).toBeLessThanOrEqual(2);
      expect(Math.abs(card.y - prev.y - -80)).toBeLessThanOrEqual(2);
    }
    expect(wheelCompared).toBeGreaterThan(0);

    // Zoom bar is visible at 1440 and 1024, hidden at 390.
    const zoomBar = page.locator('[data-recipes-zoom="true"]');
    if (width === 390) {
      await expect(zoomBar).toBeHidden();
    } else {
      await expect(zoomBar).toBeVisible();
    }
  });
}

test("at 1440: zoom buttons step 50, 75, 100, 125, 150, minus disabled at 50, plus disabled at 150, value resets to 100", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/recipes");

  const stage = page.locator('[data-recipes-canvas-stage="true"]');
  const zoomBar = page.locator('[data-recipes-zoom="true"]');
  const minus = zoomBar.getByRole("button", { name: en.recipes.zoomOut });
  const reset = zoomBar.getByRole("button", { name: en.recipes.zoomReset });
  const plus = zoomBar.getByRole("button", { name: en.recipes.zoomIn });

  await expect(reset).toHaveText("100%");
  await expect(minus).toBeEnabled();
  await expect(plus).toBeEnabled();

  await minus.click();
  await expect(reset).toHaveText("75%");
  await minus.click();
  await expect(reset).toHaveText("50%");
  await expect(minus).toBeDisabled();
  await expect(stage).toHaveAttribute("data-zoom", "50");

  await plus.click();
  await expect(reset).toHaveText("75%");
  await expect(minus).toBeEnabled();
  await plus.click();
  await expect(reset).toHaveText("100%");
  await plus.click();
  await expect(reset).toHaveText("125%");
  await plus.click();
  await expect(reset).toHaveText("150%");
  await expect(plus).toBeDisabled();
  await expect(stage).toHaveAttribute("data-zoom", "150");

  await reset.click();
  await expect(reset).toHaveText("100%");
  await expect(stage).toHaveAttribute("data-zoom", "100");

  // Ctrl+wheel zooms and clamps to 50..150.
  await page.mouse.move(1200, 200);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await expect(reset).toHaveText("150%");
  await page.mouse.wheel(0, 300);
  await page.mouse.wheel(0, 300);
  await expect(reset).toHaveText("50%");
  await page.keyboard.up("Control");
});

test("at 1440: zoom keeps viewport centre fixed (buttons, keys) and pointer fixed (Ctrl+wheel, pinch) after a pan", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "/recipes");

  const stage = page.locator('[data-recipes-canvas-stage="true"]');
  const zoomBar = page.locator('[data-recipes-zoom="true"]');
  const minus = zoomBar.getByRole("button", { name: en.recipes.zoomOut });
  const plus = zoomBar.getByRole("button", { name: en.recipes.zoomIn });

  // Pan the canvas so pan is non-zero before zooming.
  await stage.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");

  const measureAnchorDrift = (
    beforeBoxes: Awaited<ReturnType<typeof cardBoxes>>,
    afterBoxes: Awaited<ReturnType<typeof cardBoxes>>,
    anchorX: number,
    anchorY: number,
  ) => {
    const afterBySlug = new Map(afterBoxes.map((c) => [c.slug, c]));
    for (const b of beforeBoxes) {
      const a = afterBySlug.get(b.slug);
      if (!a || b.width <= 0 || b.height <= 0) continue;
      // Normalized position of anchor relative to this card before zoom:
      const u = (anchorX - b.x) / b.width;
      const v = (anchorY - b.y) / b.height;
      // Where that exact world point landed after zoom:
      const landedX = a.x + u * a.width;
      const landedY = a.y + v * a.height;
      return {
        dx: Math.abs(landedX - anchorX),
        dy: Math.abs(landedY - anchorY),
      };
    }
    throw new Error("No shared card found before and after zoom");
  };

  // 1) Zoom buttons anchor at viewport centre (720, 450).
  const beforeBtnOut = await cardBoxes(page);
  await minus.click();
  await expect(stage).toHaveAttribute("data-zoom", "75");
  const afterBtnOut = await cardBoxes(page);
  const btnOutDrift = measureAnchorDrift(beforeBtnOut, afterBtnOut, 720, 450);
  expect(btnOutDrift.dx).toBeLessThanOrEqual(2);
  expect(btnOutDrift.dy).toBeLessThanOrEqual(2);

  await plus.click();
  await expect(stage).toHaveAttribute("data-zoom", "100");
  const afterBtnIn = await cardBoxes(page);
  const btnInDrift = measureAnchorDrift(afterBtnOut, afterBtnIn, 720, 450);
  expect(btnInDrift.dx).toBeLessThanOrEqual(2);
  expect(btnInDrift.dy).toBeLessThanOrEqual(2);

  // 2) Keyboard zoom anchors at viewport centre (720, 450).
  await stage.focus();
  await page.keyboard.press("-");
  await expect(stage).toHaveAttribute("data-zoom", "75");
  const afterKeyOut = await cardBoxes(page);
  const keyOutDrift = measureAnchorDrift(afterBtnIn, afterKeyOut, 720, 450);
  expect(keyOutDrift.dx).toBeLessThanOrEqual(2);
  expect(keyOutDrift.dy).toBeLessThanOrEqual(2);

  await page.keyboard.press("+");
  await expect(stage).toHaveAttribute("data-zoom", "100");
  const afterKeyIn = await cardBoxes(page);
  const keyInDrift = measureAnchorDrift(afterKeyOut, afterKeyIn, 720, 450);
  expect(keyInDrift.dx).toBeLessThanOrEqual(2);
  expect(keyInDrift.dy).toBeLessThanOrEqual(2);

  // 3) Ctrl+wheel anchors at the pointer (1040, 260).
  const wheelAnchor = { x: 1040, y: 260 };
  const beforeWheelZoom = await cardBoxes(page);
  await page.mouse.move(wheelAnchor.x, wheelAnchor.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect
    .poll(async () => Number(await stage.getAttribute("data-zoom")))
    .toBeGreaterThan(100);
  const afterWheelZoom = await cardBoxes(page);
  const wheelDrift = measureAnchorDrift(
    beforeWheelZoom,
    afterWheelZoom,
    wheelAnchor.x,
    wheelAnchor.y,
  );
  expect(wheelDrift.dx).toBeLessThanOrEqual(2);
  expect(wheelDrift.dy).toBeLessThanOrEqual(2);

  // 4) Two-finger pinch anchors at pinch midpoint (900, 300).
  const pinchAnchor = { x: 900, y: 300 };
  const beforePinch = await cardBoxes(page);
  await stage.evaluate((el, anchor) => {
    const dispatch = (
      type: string,
      pointerId: number,
      clientX: number,
      clientY: number,
    ) => {
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: "touch",
          clientX,
          clientY,
        }),
      );
    };
    dispatch("pointerdown", 101, anchor.x - 60, anchor.y);
    dispatch("pointerdown", 102, anchor.x + 60, anchor.y);
    dispatch("pointermove", 101, anchor.x - 45, anchor.y);
    dispatch("pointermove", 102, anchor.x + 45, anchor.y);
    dispatch("pointerup", 101, anchor.x - 45, anchor.y);
    dispatch("pointerup", 102, anchor.x + 45, anchor.y);
  }, pinchAnchor);
  const afterPinch = await cardBoxes(page);
  const pinchDrift = measureAnchorDrift(
    beforePinch,
    afterPinch,
    pinchAnchor.x,
    pinchAnchor.y,
  );
  expect(pinchDrift.dx).toBeLessThanOrEqual(2);
  expect(pinchDrift.dy).toBeLessThanOrEqual(2);
});

test("at 1440: sequence of small Ctrl+wheel pinch events zooms gradually without jumping limit to limit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/recipes");

  const stage = page.locator('[data-recipes-canvas-stage="true"]');
  await page.mouse.move(900, 300);
  await page.keyboard.down("Control");
  for (let i = 0; i < 8; i += 1) {
    await page.mouse.wheel(0, -4);
  }
  await page.keyboard.up("Control");

  const zoomAfterPinchIn = Number(await stage.getAttribute("data-zoom"));
  expect(zoomAfterPinchIn).toBeGreaterThan(100);
  expect(zoomAfterPinchIn).toBeLessThan(135);

  await page.keyboard.down("Control");
  for (let i = 0; i < 8; i += 1) {
    await page.mouse.wheel(0, 4);
  }
  await page.keyboard.up("Control");

  const zoomAfterPinchOut = Number(await stage.getAttribute("data-zoom"));
  expect(zoomAfterPinchOut).toBeGreaterThan(75);
  expect(zoomAfterPinchOut).toBeLessThan(110);
});

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`first paint at ${width}x${height}: card box matches before and after hydration (<= 1 px), works with JS off, CLS < 0.05`, async ({
    browser,
    baseURL,
  }) => {
    const noJsContext = await browser.newContext({
      baseURL,
      javaScriptEnabled: false,
      viewport: { width, height },
    });
    await noJsContext.addCookies([
      {
        name: "mellodifai_lang",
        value: "en",
        url: baseURL ?? "http://127.0.0.1",
      },
    ]);
    const noJsPage = await noJsContext.newPage();
    let ssrFirst: {
      slug: string;
      x: number;
      y: number;
      width: number;
      height: number;
    };
    try {
      await noJsPage.goto("/recipes");
      const ssrBoxes = await cardBoxes(noJsPage);
      expect(ssrBoxes.length).toBeGreaterThan(0);
      const ssrOnScreen = ssrBoxes.filter(
        (b) =>
          b.x + b.width >= 0 &&
          b.x <= width &&
          b.y + b.height >= 0 &&
          b.y <= height,
      );
      expect(ssrOnScreen.length).toBeGreaterThan(0);
      ssrFirst = ssrBoxes[0];
    } finally {
      await noJsContext.close();
    }

    const jsContext = await browser.newContext({
      baseURL,
      viewport: { width, height },
    });
    await jsContext.addCookies([
      {
        name: "mellodifai_lang",
        value: "en",
        url: baseURL ?? "http://127.0.0.1",
      },
    ]);
    const jsPage = await jsContext.newPage();
    await jsPage.addInitScript(() => {
      (window as unknown as { __c05Cls: number }).__c05Cls = 0;
      if (typeof PerformanceObserver !== "undefined") {
        try {
          const obs = new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as Array<
              PerformanceEntry & { hadRecentInput?: boolean; value?: number }
            >) {
              if (!entry.hadRecentInput && typeof entry.value === "number") {
                (window as unknown as { __c05Cls: number }).__c05Cls +=
                  entry.value;
              }
            }
          });
          obs.observe({ type: "layout-shift", buffered: true });
        } catch {
          // Non-Chromium engines may not support layout-shift observer.
        }
      }
    });
    try {
      await open(jsPage, "/recipes");
      const hydratedBoxes = await cardBoxes(jsPage);
      expect(hydratedBoxes.length).toBeGreaterThan(0);
      const hydratedFirst = hydratedBoxes[0];
      expect(hydratedFirst.slug).toBe(ssrFirst.slug);
      expect(Math.abs(hydratedFirst.x - ssrFirst.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(hydratedFirst.y - ssrFirst.y)).toBeLessThanOrEqual(1);
      expect(
        Math.abs(hydratedFirst.width - ssrFirst.width),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(hydratedFirst.height - ssrFirst.height),
      ).toBeLessThanOrEqual(1);

      const cls = await jsPage.evaluate(
        () => (window as unknown as { __c05Cls: number }).__c05Cls,
      );
      expect(cls).toBeLessThan(0.05);
    } finally {
      await jsContext.close();
    }
  });
}

test("at 1440: /recipes ships zero ZodError client chunks to the browser", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const jsBodies: Array<{ url: string; body: string }> = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (
      res.status() === 200 &&
      (url.includes("/_next/static/") || url.includes("/site/islands/")) &&
      url.endsWith(".js") &&
      // The dev server also serves the Next dev overlay, which never ships in a production build.
      !url.includes("next-devtools")
    ) {
      try {
        jsBodies.push({ url, body: await res.text() });
      } catch {
        // Ignore aborted bodies during teardown.
      }
    }
  });
  await open(page, "/recipes");
  expect(jsBodies.length).toBeGreaterThan(0);
  const offending = jsBodies
    .filter((entry) => entry.body.includes("ZodError"))
    .map((entry) => entry.url);
  expect(offending).toEqual([]);
});

test("at 1440: arrow keys pan and plus/minus/0 zoom when canvas has focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/recipes");

  const stage = page.locator('[data-recipes-canvas-stage="true"]');
  await stage.focus();
  await expect(stage).toBeFocused();

  const before = await cardBoxes(page);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  const after = await cardBoxes(page);

  const beforeBySlug = new Map(before.map((c) => [c.slug, c]));
  let compared = 0;
  for (const card of after) {
    const prev = beforeBySlug.get(card.slug);
    if (!prev) continue;
    compared += 1;
    expect(Math.abs(card.x - prev.x - -120)).toBeLessThanOrEqual(2);
    expect(Math.abs(card.y - prev.y - -120)).toBeLessThanOrEqual(2);
  }
  expect(compared).toBeGreaterThan(0);

  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");

  await page.keyboard.press("+");
  await expect(stage).toHaveAttribute("data-zoom", "125");
  await page.keyboard.press("-");
  await expect(stage).toHaveAttribute("data-zoom", "100");
  await page.keyboard.press("-");
  await expect(stage).toHaveAttribute("data-zoom", "75");
  await page.keyboard.press("0");
  await expect(stage).toHaveAttribute("data-zoom", "100");
});

test("search: `/` focuses search, Ctrl+F is not taken, local filter makes zero network calls, no-match shows empty state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const apiRequests: string[] = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname.startsWith("/api/v1/recipes")) {
      apiRequests.push(req.url());
    }
  });

  await open(page, "/recipes");
  const search = page.getByRole("searchbox", { name: en.recipes.searchLabel });
  await expect(search).not.toBeFocused();

  // Ctrl+F must NOT be taken by the page.
  const ctrlFPrevented = await page.evaluate(() => {
    const ev = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(ctrlFPrevented).toBe(false);
  await expect(search).not.toBeFocused();

  // `/` focuses search.
  await page.keyboard.press("/");
  await expect(search).toBeFocused();

  // Target filter (tiktok -> 9:16) works locally with zero network requests.
  const startUrl = page.url();
  await search.fill("tiktok");
  await expect(
    page.locator('[data-recipe-card="canvas"][data-match="true"]').first(),
  ).toBeVisible();
  const matchedCount = await page
    .locator('[data-recipe-card="canvas"][data-match="true"]')
    .count();
  const dimmedCount = await page
    .locator('[data-recipe-card="canvas"][data-match="false"]')
    .count();
  expect(matchedCount).toBeGreaterThan(0);
  expect(dimmedCount).toBeGreaterThan(0);
  expect(page.url()).toBe(startUrl);

  // Dimmed card has reduced opacity.
  const dimmedOpacity = await page
    .locator('[data-recipe-card="canvas"][data-match="false"]')
    .first()
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).opacity));
  expect(dimmedOpacity).toBeLessThan(0.5);

  // No-match query shows empty-state line.
  await search.fill("zzzz-no-song-match");
  const empty = page.locator('[data-recipes-empty="true"]');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText(en.recipes.empty);

  // Escape clears and blurs.
  await page.keyboard.press("Escape");
  await expect(search).toHaveValue("");
  await expect(search).not.toBeFocused();
  await expect(empty).toBeHidden();

  // Zero network calls during all searches.
  expect(apiRequests).toEqual([]);
});

test("at 1440 with 24-recipe test fixture: every intersecting card is in DOM at every zoom step and during drag, and DOM stays <= 20", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "/recipes?fixture=24");

  const fixture24 = buildRecipeTestFixture(24);
  const placements = placeCanvasRecipes(fixture24, {
    viewportWidth: 1440,
    viewportHeight: 900,
  });

  const expectedIntersectingSlugs = (
    panX: number,
    panY: number,
    zoom: number,
  ) =>
    placements
      .filter((p) => {
        const r = canvasCardRect(p, {
          viewportWidth: 1440,
          viewportHeight: 900,
          panX,
          panY,
          zoom,
        });
        return (
          r.x + r.width >= 0 && r.x <= 1440 && r.y + r.height >= 0 && r.y <= 900
        );
      })
      .map((p) => p.recipe.slug)
      .sort();

  const assertVisibleMatchesViewport = async (
    panX: number,
    panY: number,
    zoom: number,
    label: string,
  ) => {
    const expected = expectedIntersectingSlugs(panX, panY, zoom);
    await expect
      .poll(
        async () => {
          const boxes = await cardBoxes(page);
          return {
            total: boxes.length,
            intersecting: boxes
              .filter(
                (b) =>
                  b.x + b.width >= 0 &&
                  b.x <= 1440 &&
                  b.y + b.height >= 0 &&
                  b.y <= 900,
              )
              .map((b) => b.slug)
              .sort(),
          };
        },
        { message: `${label} intersecting slugs` },
      )
      .toEqual({
        total: expect.any(Number),
        intersecting: expected,
      });
    const finalCount = await page
      .locator('[data-recipe-card="canvas"]')
      .count();
    expect(finalCount, `${label} count`).toBeGreaterThan(0);
    expect(finalCount, `${label} cap`).toBeLessThanOrEqual(20);
  };

  const initialSlugs = await page
    .locator('[data-recipe-card="canvas"]')
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-recipe-slug") ?? ""),
    );
  expect(initialSlugs.length).toBeLessThan(24);

  const stage = page.locator('[data-recipes-canvas-stage="true"]');
  const zoomBar = page.locator('[data-recipes-zoom="true"]');
  const minus = zoomBar.getByRole("button", { name: en.recipes.zoomOut });
  const plus = zoomBar.getByRole("button", { name: en.recipes.zoomIn });
  const reset = zoomBar.getByRole("button", { name: en.recipes.zoomReset });

  // Walk through every zoom step: 100 -> 75 -> 50 -> 75 -> 100 -> 125 -> 150.
  await assertVisibleMatchesViewport(0, 0, 100, "initial 100%");
  await minus.click();
  await expect(reset).toHaveText("75%");
  await assertVisibleMatchesViewport(0, 0, 75, "zoom 75%");
  await minus.click();
  await expect(reset).toHaveText("50%");
  await assertVisibleMatchesViewport(0, 0, 50, "zoom 50%");

  // During and after a 300 px drag at 50% zoom, every intersecting card stays in DOM.
  await page.mouse.move(1400, 150);
  await page.mouse.down();
  await page.mouse.move(1250, 150, { steps: 3 });
  await assertVisibleMatchesViewport(-150, 0, 50, "mid-drag -150px at 50%");
  await page.mouse.move(1100, 150, { steps: 3 });
  await assertVisibleMatchesViewport(-300, 0, 50, "end-drag -300px at 50%");
  await page.mouse.up();
  await assertVisibleMatchesViewport(-300, 0, 50, "after-drag -300px at 50%");

  // Drag back to pan (0, 0) and verify 125% and 150% zoom steps too.
  await page.mouse.move(1100, 150);
  await page.mouse.down();
  await page.mouse.move(1400, 150, { steps: 4 });
  await page.mouse.up();
  await reset.click();
  await expect(reset).toHaveText("100%");
  for (const targetZoom of ZOOM_STEPS.filter((z) => z > 100)) {
    await plus.click();
    await expect(stage).toHaveAttribute("data-zoom", String(targetZoom));
    await assertVisibleMatchesViewport(0, 0, targetZoom, `zoom ${targetZoom}%`);
  }

  // Reset zoom and pan far right to reveal off-screen fixture cards.
  await reset.click();
  await stage.focus();
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("ArrowRight");
  }
  const afterPanSlugs = await page
    .locator('[data-recipe-card="canvas"]')
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-recipe-slug") ?? ""),
    );
  expect(afterPanSlugs.length).toBeLessThanOrEqual(20);
  expect(afterPanSlugs).not.toEqual(initialSlugs);
});

for (const [width, height, expectedCols] of WIDTHS) {
  test(`grid at ${width}x${height}: ${expectedCols} columns with 24-recipe fixture, no sideways scroll`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await open(page, "/recipes?view=grid&fixture=24");

    const cards = page.locator('[data-recipe-card="grid"]');
    await expect(cards).toHaveCount(24);

    // Count distinct column X positions in the multi-column layout.
    const colXs = await cards.evaluateAll((els) => {
      const xs = els.map((el) => Math.round(el.getBoundingClientRect().left));
      return [...new Set(xs)].sort((a, b) => a - b);
    });
    expect(colXs).toHaveLength(expectedCols);

    // No horizontal overflow.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // Footer is visible in grid view; zoom bar is absent.
    await expect(page.locator(".site-footer")).toBeVisible();
    await expect(page.locator('[data-recipes-zoom="true"]')).toHaveCount(0);

    if (width === 390) {
      const spacing = await page.evaluate(() => {
        const section = document.querySelector(".site-recipes-grid-section");
        const list = document.querySelector(".site-recipes-grid-list");
        const item = document.querySelector(".site-recipes-grid-item");
        if (!section || !list || !item) return null;
        const ss = getComputedStyle(section);
        const ls = getComputedStyle(list);
        const is = getComputedStyle(item);
        return {
          padLeft: Number.parseFloat(ss.paddingLeft),
          padRight: Number.parseFloat(ss.paddingRight),
          colGap: Number.parseFloat(ls.columnGap),
          rowGap: Number.parseFloat(ls.rowGap),
          itemMarginBottom: Number.parseFloat(is.marginBottom),
        };
      });
      expect(spacing).toEqual({
        padLeft: 14,
        padRight: 14,
        colGap: 18,
        rowGap: 18,
        itemMarginBottom: 18,
      });
    }
  });
}

test("?view=grid renders the grid on the server and works with JavaScript off", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { width: 1440, height: 900 },
  });
  await context.addCookies([
    {
      name: "mellodifai_lang",
      value: "en",
      url: baseURL ?? "http://127.0.0.1",
    },
  ]);
  const page = await context.newPage();
  try {
    await page.goto("/recipes?view=grid");
    await expect(page.locator("h1")).toHaveText(en.recipes.title);
    const cards = page.locator('[data-recipe-card="grid"]');
    await expect(cards).toHaveCount(12);
    const colXs = await cards.evaluateAll((els) => {
      const xs = els.map((el) => Math.round(el.getBoundingClientRect().left));
      return [...new Set(xs)].sort((a, b) => a - b);
    });
    expect(colXs).toHaveLength(5);

    const gridLink = page
      .locator('[data-recipes-switch="true"]')
      .getByRole("link", { name: en.recipes.viewGrid });
    await expect(gridLink).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".site-footer")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("view switch updates URL without reload and preserves view across reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/recipes");

  const sw = page.locator('[data-recipes-switch="true"]');
  const canvasLink = sw.getByRole("link", { name: en.recipes.viewCanvas });
  const gridLink = sw.getByRole("link", { name: en.recipes.viewGrid });

  await expect(canvasLink).toHaveAttribute("aria-current", "page");
  await page.evaluate(() => {
    (window as unknown as { __c05Marker: number }).__c05Marker = 42;
  });

  await gridLink.click();
  await expect(page.locator('[data-recipes-view="grid"]')).toBeVisible();
  await expect(gridLink).toHaveAttribute("aria-current", "page");
  expect(new URL(page.url()).searchParams.get("view")).toBe("grid");

  // Client-side transition kept the same JS document context.
  expect(
    await page.evaluate(
      () => (window as unknown as { __c05Marker?: number }).__c05Marker,
    ),
  ).toBe(42);

  // Reload stays in grid view.
  await page.reload();
  await expect(page.locator('[data-recipes-view="grid"]')).toBeVisible();
  await expect(page.locator('[data-recipe-card="grid"]')).toHaveCount(12);

  // Switch back to canvas.
  await sw.getByRole("link", { name: en.recipes.viewCanvas }).click();
  await expect(page.locator('[data-recipes-view="canvas"]')).toBeVisible();
  expect(new URL(page.url()).searchParams.get("view")).toBeNull();
});

test("Italian page renders Italian titles and UI copy on canvas and grid", async ({
  page,
  baseURL,
}) => {
  await page.context().addCookies([
    {
      name: "mellodifai_lang",
      value: "it",
      url: baseURL ?? "http://127.0.0.1",
    },
  ]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/recipes");
  await expect(page.locator("h1")).toHaveText(itCopy.recipes.title);

  await open(page, "/recipes?view=grid");
  await expect(page.locator("h1")).toHaveText(itCopy.recipes.title);
  await expect(page.locator('[data-recipe-card="grid"]')).toHaveCount(12);
});

test("no link on /recipes or /recipes?view=grid ends on a missing page, and every cover loads", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const path of ["/recipes", "/recipes?view=grid"]) {
    await open(page, path);
    const hrefs = await page
      .locator("a[href]")
      .evaluateAll((as) => [
        ...new Set(
          as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""),
        ),
      ]);
    for (const h of hrefs.filter((x) => x.startsWith("/"))) {
      const [pathname] = h.split("#");
      const res = await request.get(pathname || "/", { maxRedirects: 5 });
      expect(res.status(), `${path} -> ${h}`).toBeLessThan(400);
    }
    const brokenImages = await page
      .locator("img")
      .evaluateAll((imgs) =>
        imgs
          .filter(
            (img) =>
              !(img as HTMLImageElement).complete ||
              (img as HTMLImageElement).naturalWidth === 0,
          )
          .map((img) => (img as HTMLImageElement).getAttribute("src")),
      );
    expect(brokenImages, path).toEqual([]);
  }
});

test("reduced motion disables canvas transitions and preview video autoplay", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "/recipes");
  await page.waitForTimeout(350);
  await expect(page.locator(".site-recipe-card__video")).toHaveCount(0);
  const durations = await page
    .locator('[data-recipe-card="canvas"]')
    .evaluateAll((els) =>
      els.map((el) => getComputedStyle(el).transitionDuration),
    );
  for (const d of durations) {
    expect(d.split(",").every((v) => Number.parseFloat(v) === 0)).toBe(true);
  }
});

for (const theme of ["dark", "light"] as const) {
  for (const width of [1440, 390]) {
    for (const path of ["/recipes", "/recipes?view=grid"]) {
      test(`axe: zero serious or critical issues on ${path} (${theme} theme, ${width}px)`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        if (theme === "light") {
          await page.addInitScript(() =>
            localStorage.setItem("mellodifai-theme", "light"),
          );
        }
        await page.emulateMedia({ reducedMotion: "reduce" });
        await open(page, path);
        if (theme === "light") {
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  getComputedStyle(document.querySelector(".site") as Element)
                    .colorScheme,
              ),
            )
            .toBe("light");
        }
        await page.waitForTimeout(300);
        const result = await new AxeBuilder({ page }).analyze();
        const bad = result.violations.filter(
          (v) => v.impact === "serious" || v.impact === "critical",
        );
        expect(
          bad.map(
            (v) =>
              `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
          ),
        ).toEqual([]);
      });
    }
  }
}

test("likeness judge (J1): canvas layout matches reference within one spacing step, and grid columns match STUDY.md 4.3", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "the reference was measured in Chromium",
  );
  const reference = JSON.parse(
    readFileSync(join(import.meta.dirname, "layout-ref/recipes.json"), "utf8"),
  ) as LayoutRef;
  const candidate: LayoutRef = { sections: reference.sections, widths: {} };
  for (const [w, h] of WIDTHS) {
    await page.setViewportSize({ width: w, height: h });
    await open(page, "/recipes");
    candidate.widths[String(w)] = await page.evaluate(measureLayoutInPage, {
      names: reference.sections,
      width: w,
    });
  }
  const step = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.width = "var(--spacing-1)";
    document.querySelector("[data-astryx-theme]")?.append(probe);
    const px = probe.getBoundingClientRect().width;
    probe.remove();
    return px;
  });
  expect(step).toBe(4);
  const result = compareLayout(reference, candidate, { stepPx: step });
  expect(result.failures).toEqual([]);

  // Canvas fixed chrome geometry vs STUDY.md 4.1 & pages/recipes/outline-*.json (within 4 px):
  // Canvas has no CSS grid (layout-ref/recipes.json uses grid: null because raw auto-capture
  // picked up header logo 116x19 at 1440 and 780x560 backdrop at 390), so verify the study's
  // measured canvas controls directly at all 3 widths.
  for (const [w, h] of WIDTHS) {
    await page.setViewportSize({ width: w, height: h });
    await open(page, "/recipes");
    const canvasGeom = await page.evaluate(() => {
      const sw = document
        .querySelector('[data-recipes-switch="true"]')
        ?.getBoundingClientRect();
      const zoom = document
        .querySelector('[data-recipes-zoom="true"]')
        ?.getBoundingClientRect();
      const search = document
        .querySelector(".site-recipes-search")
        ?.getBoundingClientRect();
      return {
        docH: document.documentElement.scrollHeight,
        swCenter: sw ? sw.left + sw.width / 2 : 0,
        swBottom: sw ? window.innerHeight - sw.bottom : 0,
        zoomRight: zoom ? window.innerWidth - zoom.right : 0,
        zoomBottom: zoom ? window.innerHeight - zoom.bottom : 0,
        zoomVisible: Boolean(zoom && zoom.width > 0 && zoom.height > 0),
        searchCenter: search ? search.left + search.width / 2 : 0,
        searchW: search ? search.width : 0,
      };
    });
    expect(canvasGeom.docH, `canvas height at ${w}`).toBeLessThanOrEqual(h + 1);
    expect(
      Math.abs(canvasGeom.swCenter - w / 2),
      `view switch centre at ${w}`,
    ).toBeLessThanOrEqual(4);
    expect(
      Math.abs(canvasGeom.swBottom - 28),
      `view switch bottom inset at ${w}`,
    ).toBeLessThanOrEqual(4);
    expect(
      Math.abs(canvasGeom.searchCenter - w / 2),
      `search centre at ${w}`,
    ).toBeLessThanOrEqual(4);
    if (w === 390) {
      expect(canvasGeom.zoomVisible, "zoom hidden at 390").toBe(false);
    } else {
      expect(canvasGeom.zoomVisible, `zoom visible at ${w}`).toBe(true);
      expect(
        Math.abs(canvasGeom.zoomRight - 60),
        `zoom right inset at ${w}`,
      ).toBeLessThanOrEqual(4);
      expect(
        Math.abs(canvasGeom.zoomBottom - 28),
        `zoom bottom inset at ${w}`,
      ).toBeLessThanOrEqual(4);
      expect(
        Math.abs(canvasGeom.searchW - 400),
        `search width at ${w}`,
      ).toBeLessThanOrEqual(4);
    }
  }

  // Real J1 compareLayout check on grid view (/recipes?view=grid) with non-null study grid values
  // measured from interactions/recipes.json, recipes-grid-1024.json and recipes-grid-390.json.
  const gridRef = JSON.parse(
    readFileSync(
      join(import.meta.dirname, "layout-ref/recipes-grid.json"),
      "utf8",
    ),
  ) as LayoutRef;
  const gridCand: LayoutRef = { sections: gridRef.sections, widths: {} };
  for (const [w, h] of WIDTHS) {
    await page.setViewportSize({ width: w, height: h });
    await open(page, "/recipes?view=grid&fixture=24");
    gridCand.widths[String(w)] = await page.evaluate(measureLayoutInPage, {
      names: gridRef.sections,
      width: w,
    });
  }
  const gridResult = compareLayout(gridRef, gridCand, { stepPx: step });
  expect(gridResult.failures).toEqual([]);
  expect(gridCand.widths["390"].sections[1]).toMatchObject({
    contentLeft: 14,
    contentRight: 14,
    grid: {
      perRow: 2,
      colGap: 18,
      rowGap: 18,
      itemW: 172,
      x: 14,
      w: 362,
    },
  });
});

const CAPTURE =
  process.env.SITE_TEXT_CAPTURE ??
  "E:/mellodifai/research/2026-11-20/cardboard/text-capture";

test("clean-room judge (J6): no shared sentence and no equal string with the reference", async ({
  page,
  baseURL,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium" || !existsSync(CAPTURE),
    "needs the captured reference text",
  );
  const reference = readdirSync(CAPTURE).flatMap(
    (f) =>
      (
        JSON.parse(readFileSync(join(CAPTURE, f), "utf8")) as {
          strings: string[];
        }
      ).strings,
  );
  const ours: string[] = [];
  for (const lang of ["en", "it"] as const) {
    await page.context().addCookies([
      {
        name: "mellodifai_lang",
        value: lang,
        url: baseURL ?? "http://127.0.0.1",
      },
    ]);
    for (const path of ["/recipes", "/recipes?view=grid"]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await open(page, path);
      ours.push(...(await page.evaluate(collectPageText, undefined)));
      // Also capture the empty-state text.
      await page
        .getByRole("searchbox", { name: SITE_COPY[lang].recipes.searchLabel })
        .fill("zzzz-no-match");
      ours.push(...(await page.evaluate(collectPageText, undefined)));
    }
  }
  const result = cleanRoom({
    ours,
    reference,
    allow: ["Notifications alt+T"],
  });
  expect(
    [...result.sharedRuns, ...result.equalStrings].map(
      (h) => `${h.ours} = ${h.reference}`,
    ),
  ).toEqual([]);
});

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { chromium, expect, type Page, test } from "@playwright/test";
import { SITE_COPY } from "../../lib/site/copy";
import { cleanRoom } from "../../lib/site/judge/clean-room";
import {
  compareLayout,
  type LayoutRef,
  measureLayoutInPage,
} from "../../lib/site/judge/likeness";
import { collectPageText } from "../../lib/site/judge/page-text";
import { HEADER_LINKS } from "../../lib/site/nav";
import { HERO_SAMPLE } from "../../lib/site/sample";

// The public home page and the site shell (C02), on Chromium, Firefox and WebKit.
const SIZES = [
  [320, 568],
  [390, 844],
  [1024, 768],
  [1366, 657],
  [1440, 900],
  [1920, 1080],
] as const;
const en = SITE_COPY.en;

async function open(page: Page, path = "/") {
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
  // Hydrated: the header reads the scroll position.
  await expect(page.locator(".site-header")).toHaveAttribute(
    "data-scrolled",
    "false",
  );
}

async function inView(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return (
        r.width > 0 &&
        r.height > 0 &&
        r.top >= 0 &&
        r.bottom <= window.innerHeight + 0.5 &&
        r.left >= -0.5 &&
        r.right <= window.innerWidth + 0.5 &&
        s.visibility !== "hidden"
      );
    });
}

async function mainActionInView(page: Page) {
  return (
    (await inView(page, ".site-header__cta")) ||
    (await inView(page, ".site-hero__primary"))
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

for (const [width, height] of SIZES) {
  test(`first screen at ${width}x${height}: brand, main action, the editable line, no sideways scroll, no empty band`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const header = await page.locator(".site-header").boundingBox();
    expect(header?.height).toBeGreaterThanOrEqual(72);
    expect(header?.height).toBeLessThanOrEqual(77);
    expect(await inView(page, ".site-header .site-brand__name")).toBe(true);
    expect(await inView(page, ".site-hero__primary")).toBe(true);
    // The proof: the whole lyric line and the changed word are in the first screen.
    expect(await inView(page, ".site-studio__lyric")).toBe(true);
    expect(await inView(page, ".site-studio__word")).toBe(true);
    // The hero ends with its content: below the last part there is only the hero's end padding.
    const band = await page.evaluate(() => {
      const hero = document.querySelector(".site-hero") as HTMLElement;
      const stage = document.querySelector(".site-hero__stage") as HTMLElement;
      const last = stage.lastElementChild as HTMLElement;
      const end = Number.parseFloat(getComputedStyle(stage).paddingBottom);
      return (
        hero.getBoundingClientRect().bottom -
        last.getBoundingClientRect().bottom -
        end
      );
    });
    expect(band).toBeLessThanOrEqual(1);
  });
}

for (const [width, height] of [
  [320, 568],
  [390, 844],
] as const) {
  test(`first screen at ${width}x${height} (it): brand and main action fully inside the first screen`, async ({
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
    await page.setViewportSize({ width, height });
    await open(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(await inView(page, ".site-header .site-brand__name")).toBe(true);
    expect(await mainActionInView(page)).toBe(true);
  });
}

// C19: the first load stays light. The home page fetches only the site's own font files (the
// studio face is not preloaded and not drawn here) and no image heavier than its drawn size needs.
// A phone context in full Chromium (new headless), as Lighthouse mobile loads the page: the
// headless shell of the default project does not fetch a block's first font for its metrics.
test("first load on a phone: only the site's own fonts, no image over 16 KB", async ({
  browserName,
  baseURL,
}) => {
  test.skip(browserName !== "chromium", "phone emulation is Chromium only");
  const browser = await chromium.launch({ channel: "chromium" });
  const fonts: string[] = [];
  const heavy: string[] = [];
  try {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 412, height: 823 },
      deviceScaleFactor: 1.75,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const images: { url: string; size: Promise<number> }[] = [];
    page.on("response", (r) => {
      const type = r.request().resourceType();
      if (type === "font") fonts.push(new URL(r.url()).pathname);
      if (type === "image")
        images.push({
          url: new URL(r.url()).pathname,
          size: r.body().then(
            (b) => b.length,
            () => 0,
          ),
        });
    });
    await open(page);
    await page.waitForLoadState("networkidle");
    for (const i of images)
      if ((await i.size) > 16 * 1024) heavy.push(`${i.url} ${await i.size}`);
  } finally {
    await browser.close();
  }
  expect(fonts.length).toBeGreaterThan(0);
  // The dev server's own overlay draws in Geist from /__nextjs_font/; a build has no overlay.
  expect(
    fonts.filter(
      (f) => !f.startsWith("/site/fonts/") && !f.startsWith("/__nextjs_font/"),
    ),
  ).toEqual([]);
  expect(heavy).toEqual([]);
});

// C19 council: one order and one look for the main action. On a phone the hero reads title,
// line, main action, as on a wide window, and the main action looks like the header's.
for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`hero at ${width}x${height}: title, line, then the main action in the header's look`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    const top = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((el) => el.getBoundingClientRect().top);
    const title = await top(".site-hero__title");
    const lede = await top(".site-hero__lede");
    const action = await top(".site-hero__primary");
    expect(title).toBeLessThan(lede);
    expect(lede).toBeLessThan(action);
    const look = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((el) => {
          const s = getComputedStyle(el);
          return [s.backgroundColor, s.color, s.borderRadius].join(" | ");
        });
    expect(await look(".site-hero__primary")).toBe(
      await look(".site-header__cta"),
    );
  });
}

test("no empty band at any window height from 568 to 1080", async ({
  page,
}) => {
  for (const height of [568, 657, 720, 800, 900, 1080]) {
    await page.setViewportSize({ width: 1366, height });
    await open(page);
    const gap = await page.evaluate(() => {
      const hero = document.querySelector(".site-hero") as HTMLElement;
      const next = hero.nextElementSibling as HTMLElement;
      const stage = document.querySelector(".site-hero__stage") as HTMLElement;
      const last = stage.lastElementChild as HTMLElement;
      // Distance from the last thing in the hero to the first thing of the next section.
      const first = next.firstElementChild as HTMLElement;
      return (
        first.getBoundingClientRect().top - last.getBoundingClientRect().bottom
      );
    });
    expect(gap, `height ${height}`).toBeLessThanOrEqual(200);
  }
});

test("header: clear at the top, glass after scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const look = () =>
    page.locator(".site-header").evaluate((el) => {
      const s = getComputedStyle(el);
      const filter =
        s.backdropFilter ||
        (s as unknown as Record<string, string>).webkitBackdropFilter ||
        "none";
      const alpha = /rgba?\([^)]*[,/]\s*([\d.]+)\)/u.exec(
        s.backgroundColor,
      )?.[1];
      return {
        filter,
        alpha:
          alpha === undefined
            ? s.backgroundColor === "rgba(0, 0, 0, 0)"
              ? 0
              : 1
            : Number(alpha),
      };
    });
  expect((await look()).alpha).toBe(0);
  await page.mouse.wheel(0, 600);
  await expect(page.locator(".site-header")).toHaveAttribute(
    "data-scrolled",
    "true",
  );
  await expect.poll(async () => (await look()).filter).not.toBe("none");
  // The background fades in (300 ms); read it when it settles.
  await expect
    .poll(async () => (await look()).alpha)
    .toBeGreaterThanOrEqual(0.6);
  const { alpha } = await look();
  expect(alpha).toBeGreaterThanOrEqual(0.6);
  expect(alpha).toBeLessThanOrEqual(0.8);
});

test("agents menu opens on hover within 200 ms and closes on Escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const trigger = page.getByRole("button", { name: en.agentsMenu });
  // Timed inside the page: from the pointer entering the trigger to the menu reporting itself
  // open; the rendered frame count goes into the failure message.
  await trigger.evaluate((el) => {
    const w = window as unknown as { menuMs?: number; menuFrames?: number };
    el.addEventListener(
      "pointerenter",
      () => {
        const t0 = performance.now();
        let frames = 0;
        const count = () => {
          if (w.menuMs !== undefined) return;
          frames += 1;
          requestAnimationFrame(count);
        };
        requestAnimationFrame(count);
        new MutationObserver((_, observer) => {
          if (el.getAttribute("aria-expanded") === "true") {
            w.menuFrames = frames;
            w.menuMs = performance.now() - t0;
            observer.disconnect();
          }
        }).observe(el, { attributes: true });
      },
      { once: true },
    );
  });
  await trigger.hover();
  await expect(
    page.getByRole("link", { name: /Claude/u }).first(),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { menuMs?: number }).menuMs),
    )
    .toBeDefined();
  const { menuMs, menuFrames } = await page.evaluate(() => {
    const w = window as unknown as { menuMs: number; menuFrames: number };
    return { menuMs: w.menuMs, menuFrames: w.menuFrames };
  });
  // 200 ms is the budget on a developer machine. A shared CI runner renders three browsers
  // beside a running lab, so it gets four times that; a real hover delay still fails there.
  const budget = process.env.CI ? 800 : 200;
  expect(
    menuMs,
    `opened after ${Math.round(menuMs)} ms and ${menuFrames} frames`,
  ).toBeLessThanOrEqual(budget);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("link", { name: /Use MellodifAI from Claude/u }),
  ).toBeHidden();
});

test("phone menu: full screen, keeps focus inside, stops page scroll, Escape closes and restores focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const opener = page.getByRole("button", { name: en.menu.open });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: en.menu.label });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box?.width).toBe(390);
  expect(box?.height).toBe(844);
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).overflow,
    ),
  ).toBe("hidden");
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => {
      const a = document.activeElement;
      return !a || a === document.body || !!a.closest("dialog[open]");
    });
    expect(inside, `tab ${i + 1}`).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).overflow,
    ),
  ).not.toBe("hidden");
});

test("keyboard only: skip link, pick the word, play the line", async ({
  page,
  browserName,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(/\/site\/sample\//u, (route) =>
    route.fulfill({
      status: 200,
      contentType: "audio/wav",
      body: silentWav(4),
    }),
  );
  await open(page);
  const skip = page.getByRole("link", { name: en.skip });
  // Safari's default keyboard setting skips links on Tab, so WebKit starts on the skip link itself.
  if (browserName === "webkit") await skip.focus();
  else await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  const love = page.getByRole("button", { name: /^love,/u });
  const studio = page.locator(".site-studio");
  await love.focus();
  await page.keyboard.press("Space");
  await expect(love).toHaveAttribute("aria-pressed", "true");
  await expect(studio.locator(".site-studio__new")).toHaveText("love");
  await expect(studio.locator(".site-studio__old")).toHaveText("hate");
  const play = page.getByRole("button", { name: en.hero.play });
  // Recorded as it happens: on a slow machine the clip can end before a later check.
  await play.evaluate((el) => {
    const w = window as unknown as { playingLabel?: string };
    new MutationObserver((_, observer) => {
      if (el.getAttribute("data-state") !== "playing") return;
      w.playingLabel = el.getAttribute("aria-label") ?? el.textContent ?? "";
      observer.disconnect();
    }).observe(el, { attributes: true, childList: true, subtree: true });
  });
  await play.focus();
  await page.keyboard.press("Enter");
  // The clip of the picked word is the one that loads.
  await expect
    .poll(() => page.locator("audio").evaluate((a: HTMLAudioElement) => a.src))
    .toMatch(new RegExp(`${HERO_SAMPLE.clips.love}$`, "u"));
  // Playwright's WebKit build for Windows has no media playback, so it cannot play the clip.
  if (browserName === "webkit") return;
  // The button turned into Pause while the clip played, and the clip really played.
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { playingLabel?: string }).playingLabel,
      ),
    )
    .toContain(en.hero.pause);
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.played.length),
    )
    .toBeGreaterThan(0);
});

test("a missing sample says so and turns the play button off", async ({
  page,
}) => {
  await page.route(/\/site\/sample\//u, (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await open(page);
  // The page checks for the clip when it loads, before any press of play.
  await expect(
    page.getByRole("status").filter({ hasText: en.hero.missing }),
  ).toBeVisible();
  await expect(page.locator(".site-studio__play")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

for (const [scale, width, lang] of [
  [150, 390, "en"],
  [150, 390, "it"],
  [200, 390, "en"],
  [200, 390, "it"],
  [200, 1440, "en"],
] as const) {
  test(`text at ${scale}% on ${width} (${lang}): brand name and main action in the first screen, nothing cut`, async ({
    page,
    baseURL,
  }) => {
    await page.context().addCookies([
      {
        name: "mellodifai_lang",
        value: lang,
        url: baseURL ?? "http://127.0.0.1",
      },
    ]);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.addInitScript((s) => {
      document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.style.fontSize = `${s}%`;
      });
    }, scale);
    await open(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(await inView(page, ".site-header .site-brand__name")).toBe(true);
    expect(await mainActionInView(page)).toBe(true);
    // Brand and header actions do not overlap.
    const overlap = await page.evaluate(() => {
      const brand = document
        .querySelector(".site-header .site-brand")
        ?.getBoundingClientRect();
      const acts = document
        .querySelector(".site-header__actions")
        ?.getBoundingClientRect();
      return brand && acts ? brand.right - acts.left : 0;
    });
    expect(overlap).toBeLessThanOrEqual(0);
    const clipped = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          ".site-studio, .site-studio__body, .site-hero, .site-plan, .site-pill, .site-chip",
        ),
      ]
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.className),
    );
    expect(clipped).toEqual([]);
  });
}

test("fonts arriving 1.2 s late move nothing; blocked fonts cut nothing", async ({
  page,
  browserName,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(/\/site\/fonts\//u, async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    await route.continue();
  });
  if (browserName === "chromium") {
    await page.addInitScript(() => {
      (window as unknown as { cls: number }).cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as {
          value: number;
          hadRecentInput: boolean;
        }[])
          if (!e.hadRecentInput)
            (window as unknown as { cls: number }).cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
  }
  const before = await (async () => {
    await page.goto("/");
    return page.locator("#hero-title").boundingBox();
  })();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const after = await page.locator("#hero-title").boundingBox();
  expect(
    Math.abs((after?.height ?? 0) - (before?.height ?? 0)),
  ).toBeLessThanOrEqual(4);
  if (browserName === "chromium")
    expect(
      await page.evaluate(() => (window as unknown as { cls: number }).cls),
    ).toBeLessThan(0.05);

  // A font request can still sit in the slow handler; drop it without "Route is already handled".
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route(/\/site\/fonts\//u, (route) => route.abort());
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(await inView(page, ".site-hero__primary")).toBe(true);
});

test("forced colours: the word being changed stays marked", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "forced-colors emulation exists in Chromium only",
  );
  await page.emulateMedia({ forcedColors: "active" });
  await open(page);
  const outline = await page
    .locator(".site-chip[aria-pressed='true']")
    .evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
  const other = await page
    .locator(".site-chip[aria-pressed='false']")
    .evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(other).toBe("none");
});

for (const theme of ["dark", "light"] as const) {
  for (const width of [1440, 390]) {
    test(`axe: no serious issue, ${theme} theme at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      if (theme === "light")
        await page.addInitScript(() =>
          localStorage.setItem("mellodifai-theme", "light"),
        );
      // Colours change with a short transition when the light mode applies; read them settled.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await open(page);
      if (theme === "light")
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                getComputedStyle(document.querySelector(".site") as Element)
                  .colorScheme,
            ),
          )
          .toBe("light");
      await page.waitForTimeout(500);
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

test("Italian page: same structure, Italian words", async ({
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
  await page.goto("/");
  await expect(page.locator("#hero-title")).toContainText(
    SITE_COPY.it.hero.titleA,
  );
  await expect(page.locator("[data-ref-section]")).toHaveCount(12);
});

test("no link of the site ends on a missing page", async ({
  page,
  request,
}) => {
  await open(page);
  const hrefs = await page
    .locator("a[href]")
    .evaluateAll((as) => [
      ...new Set(
        as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""),
      ),
    ]);
  expect(hrefs.filter((h) => h === "#" || h === "#top")).toEqual([]);
  for (const h of hrefs.filter((x) => x.startsWith("/"))) {
    const [path, hash] = h.split("#");
    const res = await request.get(path || "/", { maxRedirects: 5 });
    expect(res.status(), h).toBeLessThan(400);
    if (hash) expect(await page.locator(`#${hash}`).count(), h).toBe(1);
  }
});

test("unknown URL returns 404 with lang, site look, link home and no axe violations", async ({
  page,
  baseURL,
}) => {
  const missingPath = "/this-url-does-not-exist-404-check";
  const res = await page.goto(missingPath);
  expect(res?.status()).toBe(404);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute(
    "data-astryx-theme",
    "mesh",
  );
  await expect(page.locator(".site")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    en.notFound.title,
  );
  const homeLink = page.getByRole("link", { name: en.notFound.home });
  await expect(homeLink).toHaveAttribute("href", "/");

  await page.emulateMedia({ reducedMotion: "reduce" });
  const result = await new AxeBuilder({ page }).analyze();
  const bad = result.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    bad.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    ),
  ).toEqual([]);

  await page.context().addCookies([
    {
      name: "mellodifai_lang",
      value: "it",
      url: baseURL ?? "http://127.0.0.1",
    },
  ]);
  const itRes = await page.goto(missingPath);
  expect(itRes?.status()).toBe(404);
  await expect(page.locator("html")).toHaveAttribute("lang", "it");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    SITE_COPY.it.notFound.title,
  );

  await page.getByRole("link", { name: SITE_COPY.it.notFound.home }).click();
  await expect(page).toHaveURL(/\/$/u);
});

test("likeness judge: section order and grid of the study within one spacing step", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "the reference was measured in Chromium",
  );
  const reference = JSON.parse(
    readFileSync(join(import.meta.dirname, "layout-ref/home.json"), "utf8"),
  ) as LayoutRef;
  const candidate: LayoutRef = { sections: reference.sections, widths: {} };
  for (const [w, h] of [
    [1440, 900],
    [1024, 768],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await open(page);
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
});

// The captured text of the reference stays outside the repo (clean room); the judge reads it from
// the research folder when it is there.
const CAPTURE =
  process.env.SITE_TEXT_CAPTURE ??
  "E:/mellodifai/research/2026-11-20/cardboard/text-capture";
test("clean-room judge: no shared sentence and no equal string with the reference", async ({
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
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      if (width === 1440)
        await page
          .getByRole("button", { name: SITE_COPY[lang].agentsMenu })
          .hover();
      // The function runs in the page; with no argument it reads the whole document.
      ours.push(...(await page.evaluate(collectPageText, undefined)));
    }
  }
  const header = (lang: "en" | "it") => [
    ...HEADER_LINKS.map((n) =>
      n === "agents" ? SITE_COPY[lang].agentsMenu : SITE_COPY[lang].nav[n],
    ),
    SITE_COPY[lang].nav.signIn,
    SITE_COPY[lang].nav.start,
  ];
  const result = cleanRoom({
    ours,
    reference,
    allow: SITE_ALLOW_WORDS,
    strict: [...header("en"), ...header("it")],
  });
  expect(
    [...result.sharedRuns, ...result.equalStrings].map(
      (h) => `${h.ours} = ${h.reference}`,
    ),
  ).toEqual([]);
});

// Interface words every site uses; equal to a reference string is not copying.
// "Notifications alt+T" is the label of the toast area of the app shell (sonner), not site text.
const SITE_ALLOW_WORDS = ["Notifications alt+T"];

// Silence as 16-bit PCM at 44.1 kHz, which every engine plays (made in the test, not a song).
function silentWav(seconds: number) {
  const rate = 44100;
  const bytes = rate * seconds * 2;
  const b = Buffer.alloc(44 + bytes);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + bytes, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(bytes, 40);
  return b;
}

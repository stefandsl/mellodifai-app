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
import { diffPngPixels } from "../../lib/site/judge/png-diff";
import { HEADER_LINKS } from "../../lib/site/nav";

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
    // The hero composer field is visible in the first screen.
    expect(await inView(page, ".site-composer__input")).toBe(true);
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

test("keyboard only: skip link, pick a prompt chip, focus composer, submit to sign-in without POST", async ({
  page,
  browserName,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const posts: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST") posts.push(req.url());
  });
  await open(page);
  const skip = page.getByRole("link", { name: en.skip });
  // Safari's default keyboard setting skips links on Tab, so WebKit starts on the skip link itself.
  if (browserName === "webkit") await skip.focus();
  else await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();

  const chip = page
    .locator(".site-composer__chips .site-chip[data-chip-prompt]")
    .first();
  const expectedPrompt = (await chip.getAttribute("data-chip-prompt")) ?? "";
  expect(expectedPrompt.length).toBeGreaterThan(10);
  await chip.focus();
  await page.keyboard.press("Space");
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  const input = page.locator("#hero-composer-input");
  await expect(input).toHaveValue(expectedPrompt);
  await expect(input).toBeFocused();

  await page.keyboard.press("Control+Enter");
  await page.waitForURL(/\/login\?/u);
  const landed = new URL(page.url());
  expect(landed.pathname).toBe("/login");
  expect(landed.searchParams.get("prompt")).toBeNull();
  expect(landed.searchParams.get("next")).toBe("/create?draft=1");
  expect(page.url()).not.toContain(expectedPrompt.slice(0, 12));
  expect(
    await page.evaluate(() => {
      const raw = window.localStorage.getItem("mellodifai:composer-draft");
      return raw ? (JSON.parse(raw) as { text: string }).text : null;
    }),
  ).toBe(expectedPrompt);
  expect(posts).toEqual([]);
});

for (const [width, height] of [
  [1440, 900],
  [1024, 768],
  [390, 844],
] as const) {
  test(`C04 hero composer and chips at ${width}x${height}: chip fills and focuses composer, send goes to sign-in with multi-line draft in localStorage and zero text in URL`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const posts: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST") posts.push(req.url());
    });
    await open(page);

    const chips = page.locator(
      ".site-composer__chips .site-chip[data-chip-prompt]",
    );
    await expect(chips).toHaveCount(6);
    const chip = chips.nth(2);
    const expectedPrompt = (await chip.getAttribute("data-chip-prompt")) ?? "";
    expect(expectedPrompt.length).toBeGreaterThan(10);

    await chip.click();
    const input = page.locator("#hero-composer-input");
    await expect(input).toHaveValue(expectedPrompt);
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("maxlength", "500");
    await expect(chip).toHaveAttribute("aria-pressed", "true");

    // Type two lines and submit; draft stays in localStorage and never enters the URL.
    const twoLines = "First chorus line in slow tempo\nSecond line in Italian";
    await input.fill(twoLines);
    await page.locator(".site-composer .site-hero__primary").click();
    await page.waitForURL(/\/login\?/u);
    const dest = new URL(page.url());
    expect(dest.pathname).toBe("/login");
    expect(dest.searchParams.get("prompt")).toBeNull();
    expect(dest.searchParams.get("next")).toBe("/create?draft=1");
    expect(page.url()).not.toContain("First");
    expect(page.url()).not.toContain("Second");
    expect(
      await page.evaluate(() => {
        const raw = window.localStorage.getItem("mellodifai:composer-draft");
        return raw ? (JSON.parse(raw) as { text: string }).text : null;
      }),
    ).toBe(twoLines);
    expect(posts).toEqual([]);
  });
}

test("C04 rotating hero line changes every 6.0 s +/- 0.3 s and keeps one fixed text for screen readers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install();
  await page.goto("/");
  await expect(page.locator('[data-hero-rotator="true"]')).toHaveAttribute(
    "data-rotator-running",
    "true",
  );

  // One fixed screen-reader title text inside #hero-title stays constant across rotations.
  const srOnly = page.locator("#hero-title .site-sr-only");
  await expect(srOnly).toHaveText(en.hero.fixedTitle);

  await page.evaluate(() => {
    const el = document.querySelector('[data-hero-rotator="true"]');
    const w = window as unknown as {
      rotatorTimes: { index: string; t: number }[];
    };
    w.rotatorTimes = [
      {
        index: el?.getAttribute("data-rotator-index") ?? "",
        t: performance.now(),
      },
    ];
    if (!el) return;
    new MutationObserver(() => {
      const idx = el.getAttribute("data-rotator-index") ?? "";
      const last = w.rotatorTimes[w.rotatorTimes.length - 1];
      if (!last || last.index !== idx) {
        w.rotatorTimes.push({ index: idx, t: performance.now() });
      }
    }).observe(el, {
      attributes: true,
      attributeFilter: ["data-rotator-index"],
    });
  });

  const readLineStyle = (idx: number) =>
    page.evaluate((i) => {
      const el = document.querySelector<HTMLElement>(
        `[data-rotator-line="${i}"]`,
      );
      if (!el) return { opacity: "", visibility: "" };
      const s = getComputedStyle(el);
      return { opacity: s.opacity, visibility: s.visibility };
    }, idx);

  expect(await readLineStyle(0)).toEqual({
    opacity: "1",
    visibility: "visible",
  });
  expect(await readLineStyle(1)).toEqual({
    opacity: "0",
    visibility: "hidden",
  });

  await page.clock.runFor(6100);
  await expect
    .poll(() => readLineStyle(1), { timeout: 3000 })
    .toEqual({ opacity: "1", visibility: "visible" });
  await expect
    .poll(() => readLineStyle(0), { timeout: 3000 })
    .toEqual({ opacity: "0", visibility: "hidden" });

  await page.clock.runFor(6100);
  await expect
    .poll(() => readLineStyle(2), { timeout: 3000 })
    .toEqual({ opacity: "1", visibility: "visible" });
  await expect
    .poll(() => readLineStyle(1), { timeout: 3000 })
    .toEqual({ opacity: "0", visibility: "hidden" });

  const times = await page.evaluate(
    () =>
      (
        window as unknown as {
          rotatorTimes: { index: string; t: number }[];
        }
      ).rotatorTimes,
  );
  expect(times.length).toBeGreaterThanOrEqual(3);
  expect(times[0].index).toBe("0");
  expect(times[1].index).toBe("1");
  expect(times[2].index).toBe("2");
  const dt1 = times[1].t - times[0].t;
  const dt2 = times[2].t - times[1].t;
  expect(dt1).toBeGreaterThanOrEqual(5700);
  expect(dt1).toBeLessThanOrEqual(6300);
  expect(dt2).toBeGreaterThanOrEqual(5700);
  expect(dt2).toBeLessThanOrEqual(6300);
  await expect(srOnly).toHaveText(en.hero.fixedTitle);
});

for (const [width, height] of [
  [1440, 900],
  [1024, 768],
  [390, 844],
] as const) {
  test(`C04 showcase marquee at ${width}x${height}: moves at 32 px/s +/- 4 and stops on hover and focus inside`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.clock.install();
    await page.goto("/");
    await expect(page.locator('[data-marquee-row="0"]')).toHaveAttribute(
      "data-marquee-paused",
      "false",
    );

    const readX = (rowIdx: number) =>
      page.evaluate((idx) => {
        const card = document.querySelector(
          `[data-marquee-row="${idx}"] [data-marquee-copy="0"] .site-show__card`,
        );
        return {
          x: card ? card.getBoundingClientRect().left : Number.NaN,
          t: performance.now(),
        };
      }, rowIdx);

    // Prime one frame so initial transforms settle before measuring velocity.
    await page.clock.runFor(50);
    const a0 = await readX(0);
    const a1 = await readX(1);
    await page.clock.runFor(1500);
    const b0 = await readX(0);
    const b1 = await readX(1);

    const dx0 = b0.x - a0.x;
    const dx1 = b1.x - a1.x;
    expect(Math.sign(dx0)).toBe(-Math.sign(dx1));
    expect(dx0).toBeLessThan(0);
    expect(dx1).toBeGreaterThan(0);

    const speed0 = Math.abs(dx0) / ((b0.t - a0.t) / 1000);
    const speed1 = Math.abs(dx1) / ((b1.t - a1.t) / 1000);
    expect(speed0).toBeGreaterThanOrEqual(28);
    expect(speed0).toBeLessThanOrEqual(36);
    expect(speed1).toBeGreaterThanOrEqual(28);
    expect(speed1).toBeLessThanOrEqual(36);

    // Hover stops row 0; leaving resumes it.
    const row0 = page.locator('[data-marquee-row="0"]');
    await row0.scrollIntoViewIfNeeded();
    await row0.hover();
    await expect(row0).toHaveAttribute("data-marquee-paused", "true");
    const h0 = await readX(0);
    await page.clock.runFor(1000);
    const h1 = await readX(0);
    expect(Math.abs(h1.x - h0.x)).toBeLessThan(0.5);

    await page.mouse.move(1, 1);
    await expect(row0).toHaveAttribute("data-marquee-paused", "false");

    // Keyboard focus inside stops row 1, keeps the focused card inside the viewport with outline inset, and blur resumes it.
    const row1 = page.locator('[data-marquee-row="1"]');
    const row1Link = row1.locator("a").first();
    // Switch modality to keyboard before focusing so :focus-visible matches.
    await page.keyboard.press("Tab");
    await row1Link.focus();
    await expect(row1).toHaveAttribute("data-marquee-paused", "true");
    const focusedBounds = await page.evaluate(() => {
      const vp = document.querySelector<HTMLElement>('[data-marquee-row="1"]');
      const link = document.activeElement as HTMLElement | null;
      const card = link?.closest<HTMLElement>(".site-show__card");
      const vpRect = vp?.getBoundingClientRect();
      const cardRect = card?.getBoundingClientRect();
      const linkRect = link?.getBoundingClientRect();
      return {
        scrollLeft: vp?.scrollLeft ?? -1,
        insideRow:
          Boolean(vpRect && cardRect && linkRect) &&
          (cardRect?.left ?? -1) >= (vpRect?.left ?? 0) - 1 &&
          (cardRect?.right ?? 99999) <= (vpRect?.right ?? 0) + 1 &&
          (linkRect?.left ?? -1) >= (vpRect?.left ?? 0) - 1 &&
          (linkRect?.right ?? 99999) <= (vpRect?.right ?? 0) + 1,
        insideViewport:
          Boolean(cardRect) &&
          (cardRect?.left ?? -1) >= -1 &&
          (cardRect?.right ?? 99999) <= window.innerWidth + 1,
      };
    });
    expect(focusedBounds.scrollLeft).toBe(0);
    expect(focusedBounds.insideRow).toBe(true);
    expect(focusedBounds.insideViewport).toBe(true);
    const f0 = await readX(1);
    await page.clock.runFor(1000);
    const f1 = await readX(1);
    expect(Math.abs(f1.x - f0.x)).toBeLessThan(0.5);

    await row1Link.evaluate((el: HTMLElement) => el.blur());
    await expect(row1).toHaveAttribute("data-marquee-paused", "false");
  });
}

for (const [width, height] of [
  [1440, 900],
  [390, 844],
] as const) {
  test(`C04 showcase keyboard tabbing at ${width}x${height} keeps every focused card and outline inside the row and viewport`, async ({
    page,
    browserName,
  }) => {
    await page.setViewportSize({ width, height });
    await page.clock.install();
    await page.goto("/");
    await page.clock.runFor(500);

    // Establish keyboard modality so :focus-visible matches when focusing the first card.
    await page.keyboard.press("Tab");

    for (const rowIdx of [0, 1]) {
      const row = page.locator(`[data-marquee-row="${rowIdx}"]`);
      await row.scrollIntoViewIfNeeded();
      const links = row.locator('[data-marquee-copy="0"] a');
      const count = await links.count();
      expect(count).toBe(6);

      for (let i = 0; i < count; i++) {
        if (i === 0 || browserName === "webkit") {
          await links.nth(i).focus();
        } else {
          await page.keyboard.press("Tab");
        }
        await expect(links.nth(i)).toBeFocused();
        await expect(row).toHaveAttribute("data-marquee-paused", "true");
        const check = await page.evaluate((idx) => {
          const vp = document.querySelector<HTMLElement>(
            `[data-marquee-row="${idx}"]`,
          );
          const active = document.activeElement as HTMLElement | null;
          const card = active?.closest<HTMLElement>(".site-show__card");
          const vpRect = vp?.getBoundingClientRect();
          const cardRect = card?.getBoundingClientRect();
          const linkRect = active?.getBoundingClientRect();
          return {
            scrollLeft: vp?.scrollLeft ?? -1,
            vpLeft: vpRect?.left ?? 0,
            vpRight: vpRect?.right ?? 0,
            vpWidth: vpRect?.width ?? 0,
            cardLeft: cardRect?.left ?? -9999,
            cardRight: cardRect?.right ?? 9999,
            cardWidth: cardRect?.width ?? 0,
            linkLeft: linkRect?.left ?? -9999,
            linkRight: linkRect?.right ?? 9999,
            winW: window.innerWidth,
          };
        }, rowIdx);
        expect(check.scrollLeft).toBe(0);
        // Card and link stay inside viewport and leave ~8 px outline inset when card fits.
        const expectedInset = check.cardWidth + 16 <= check.vpWidth ? 6 : 0;
        expect(check.cardLeft).toBeGreaterThanOrEqual(
          check.vpLeft + expectedInset - 1,
        );
        expect(check.cardRight).toBeLessThanOrEqual(
          check.vpRight - expectedInset + 1,
        );
        expect(check.linkLeft).toBeGreaterThanOrEqual(
          check.vpLeft + expectedInset - 1,
        );
        expect(check.linkRight).toBeLessThanOrEqual(
          check.vpRight - expectedInset + 1,
        );
        expect(check.cardLeft).toBeGreaterThanOrEqual(-1);
        expect(check.cardRight).toBeLessThanOrEqual(check.winW + 1);
      }
      await links.last().evaluate((el: HTMLElement) => el.blur());
      await expect(row).toHaveAttribute("data-marquee-paused", "false");
    }
  });
}

test("C04 showcase mouse click on a card cut at the row edge does not jump and opens its link", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixedTime = Date.UTC(2026, 10, 26, 12, 0, 0);
  await page.clock.install({ time: fixedTime });
  await page.clock.pauseAt(fixedTime);
  await page.goto("/");
  const row0 = page.locator('[data-marquee-row="0"]');
  await expect(row0).toHaveAttribute("data-marquee-paused", "false");
  await row0.scrollIntoViewIfNeeded();

  // Step the paused virtual clock deterministically until a card in copy 0 is clearly
  // cut across the right edge of the row with enough visible link width to click.

  const findCutCard = () =>
    page.evaluate(() => {
      const vp = document.querySelector<HTMLElement>('[data-marquee-row="0"]');
      if (!vp) return null;
      const vpRect = vp.getBoundingClientRect();
      const cards = Array.from(
        vp.querySelectorAll<HTMLElement>(
          '[data-marquee-copy="0"] .site-show__card',
        ),
      );
      for (const card of cards) {
        const cardRect = card.getBoundingClientRect();
        const link = card.querySelector<HTMLAnchorElement>("a");
        if (!link) continue;
        const linkRect = link.getBoundingClientRect();
        const isCutRight =
          cardRect.left < vpRect.right - 60 &&
          cardRect.right > vpRect.right + 40;
        const visibleLeft = Math.max(linkRect.left, vpRect.left);
        const visibleRight = Math.min(linkRect.right, vpRect.right);
        if (isCutRight && visibleRight - visibleLeft >= 24) {
          return {
            x: visibleLeft + Math.min(16, (visibleRight - visibleLeft) / 2),
            y: linkRect.top + linkRect.height / 2,
            href: link.getAttribute("href") ?? "",
          };
        }
      }
      return null;
    });

  let clickTarget = await findCutCard();
  for (let step = 0; !clickTarget && step < 40; step++) {
    await page.clock.runFor(250);
    clickTarget = await findCutCard();
  }

  await row0.hover();
  await expect(row0).toHaveAttribute("data-marquee-paused", "true");
  clickTarget = await findCutCard();

  expect(clickTarget).not.toBeNull();
  expect(clickTarget?.href).toBe("/recipes");
  await page.mouse.click(clickTarget?.x ?? 0, clickTarget?.y ?? 0);
  await page.waitForURL(/\/recipes$/u);
});

for (const [width, height] of [
  [1440, 900],
  [1024, 768],
  [390, 844],
] as const) {
  test(`C04 feature reels at ${width}x${height}: step every 5.0 s +/- 0.3 s and stop on hover`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.clock.install();
    await page.goto("/");
    const reel0 = page.locator('[data-feature-reel="0"]');
    await expect(reel0).toHaveAttribute("data-reel-paused", "false");

    await page.evaluate(() => {
      const el = document.querySelector('[data-feature-reel="0"]');
      const w = window as unknown as {
        reelTimes: { step: string; t: number }[];
      };
      w.reelTimes = [
        {
          step: el?.getAttribute("data-reel-step") ?? "",
          t: performance.now(),
        },
      ];
      if (!el) return;
      new MutationObserver(() => {
        const step = el.getAttribute("data-reel-step") ?? "";
        const last = w.reelTimes[w.reelTimes.length - 1];
        if (!last || last.step !== step) {
          w.reelTimes.push({ step, t: performance.now() });
        }
      }).observe(el, { attributes: true, attributeFilter: ["data-reel-step"] });
    });

    const readTrackTx = () =>
      page.evaluate(() => {
        const track = document.querySelector<HTMLElement>(
          '[data-feature-reel="0"] [data-reel-track="true"]',
        );
        if (!track) return { tx: Number.NaN, width: 0, inline: "" };
        const style = getComputedStyle(track).transform;
        let tx = 0;
        if (style && style !== "none") {
          const m = style.match(/matrix\(([^)]+)\)/u);
          if (m) tx = Number(m[1].split(",")[4]);
        }
        return {
          tx,
          width: track.getBoundingClientRect().width,
          inline: track.style.transform,
        };
      });

    const tr0 = await readTrackTx();
    expect(Math.abs(tr0.tx)).toBeLessThan(1);

    await page.clock.runFor(5100);
    await expect
      .poll(
        async () => {
          const tr = await readTrackTx();
          return (
            tr.inline.includes("-33.33") && Math.abs(tr.tx - -tr.width / 3) < 2
          );
        },
        { timeout: 3000 },
      )
      .toBe(true);

    await page.clock.runFor(5100);
    await expect
      .poll(
        async () => {
          const tr = await readTrackTx();
          return (
            tr.inline.includes("-66.66") &&
            Math.abs(tr.tx - (-2 * tr.width) / 3) < 2
          );
        },
        { timeout: 3000 },
      )
      .toBe(true);

    const times = await page.evaluate(
      () =>
        (window as unknown as { reelTimes: { step: string; t: number }[] })
          .reelTimes,
    );
    expect(times.length).toBeGreaterThanOrEqual(3);
    expect(times[0].step).toBe("0");
    expect(times[1].step).toBe("1");
    expect(times[2].step).toBe("2");
    const dt1 = times[1].t - times[0].t;
    const dt2 = times[2].t - times[1].t;
    expect(dt1).toBeGreaterThanOrEqual(4700);
    expect(dt1).toBeLessThanOrEqual(5300);
    expect(dt2).toBeGreaterThanOrEqual(4700);
    expect(dt2).toBeLessThanOrEqual(5300);

    // Hover stops the feature reel across more than a full 5 s period.
    await reel0.scrollIntoViewIfNeeded();
    await reel0.hover();
    await expect(reel0).toHaveAttribute("data-reel-paused", "true");
    const pausedStep = await reel0.getAttribute("data-reel-step");
    await page.clock.runFor(6500);
    await expect(reel0).toHaveAttribute("data-reel-step", pausedStep ?? "2");

    // Moving pointer off the article resumes stepping.
    await page.mouse.move(1, 1);
    await expect(reel0).toHaveAttribute("data-reel-paused", "false");
    await page.clock.runFor(5100);
    await expect(reel0).not.toHaveAttribute(
      "data-reel-step",
      pausedStep ?? "2",
    );
  });
}

test("C04 reduced motion: no loop runs and 0 changed pixels in the hero over 3 s", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);

  await expect(page.locator('[data-hero-rotator="true"]')).toHaveAttribute(
    "data-rotator-running",
    "false",
  );
  await expect(page.locator('[data-marquee-row="0"]')).toHaveAttribute(
    "data-marquee-paused",
    "true",
  );
  await expect(page.locator('[data-marquee-row="1"]')).toHaveAttribute(
    "data-marquee-paused",
    "true",
  );
  await expect(page.locator('[data-feature-reel="0"]')).toHaveAttribute(
    "data-reel-paused",
    "true",
  );

  // Wait for deferred post-LCP web fonts stylesheet and font faces to settle before measuring
  // the 3.0 s reduced-motion window, so initial font swap does not land inside the window.
  await page.waitForFunction(() => {
    const link = document.querySelector<HTMLLinkElement>(
      'link[data-site-fonts="true"]',
    );
    return Boolean(link?.sheet);
  });
  await page.evaluate(async () => {
    const nextFrame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await nextFrame();
    await document.fonts.ready;
    await nextFrame();
    await document.fonts.ready;
    await nextFrame();
  });

  // Measure real 3.0 s elapsed time and compare decoded hero RGBA pixels (excluding any <video>).
  const hero = page.locator(".site-hero");
  const startState = await page.evaluate(() => ({
    t0: performance.now(),
    row0X:
      document
        .querySelector('[data-marquee-row="0"] .site-show__card')
        ?.getBoundingClientRect().left ?? 0,
  }));
  const shotBefore = await hero.screenshot({ animations: "allow" });
  await page.waitForFunction(
    (t0) => performance.now() - t0 >= 3000,
    startState.t0,
  );
  const shotAfter = await hero.screenshot({ animations: "allow" });
  const videoMasks = await page.evaluate(() => {
    const heroEl = document.querySelector(".site-hero");
    const heroRect = heroEl?.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return Array.from(heroEl?.querySelectorAll("video") ?? []).map((v) => {
      const r = v.getBoundingClientRect();
      return {
        x: Math.max(0, Math.floor((r.left - (heroRect?.left ?? 0)) * dpr)),
        y: Math.max(0, Math.floor((r.top - (heroRect?.top ?? 0)) * dpr)),
        width: Math.ceil(r.width * dpr),
        height: Math.ceil(r.height * dpr),
      };
    });
  });

  const diff = diffPngPixels(shotBefore, shotAfter, videoMasks);
  expect(
    diff.changedPixels,
    `changedPixels=${diff.changedPixels}/${diff.totalPixels} changedBox=${JSON.stringify(diff.changedBox)}`,
  ).toBe(0);
  await expect(page.locator('[data-hero-rotator="true"]')).toHaveAttribute(
    "data-rotator-index",
    "0",
  );
  await expect(page.locator('[data-feature-reel="0"]')).toHaveAttribute(
    "data-reel-step",
    "0",
  );
  const endRow0X = await page.evaluate(
    () =>
      document
        .querySelector('[data-marquee-row="0"] .site-show__card')
        ?.getBoundingClientRect().left ?? 0,
  );
  expect(Math.abs(endRow0X - startState.row0X)).toBe(0);
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
          ".site-composer, .site-hero, .site-plan, .site-pill, .site-chip",
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

test("forced colours: the chosen prompt chip stays marked", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "forced-colors emulation exists in Chromium only",
  );
  await page.emulateMedia({ forcedColors: "active" });
  await open(page);
  await page.locator(".site-composer__chips .site-chip").first().click();
  const outline = await page
    .locator(".site-chip[aria-pressed='true']")
    .evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
  const other = await page
    .locator(".site-chip[aria-pressed='false']")
    .first()
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

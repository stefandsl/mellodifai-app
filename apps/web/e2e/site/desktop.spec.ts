import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { SITE_COPY } from "../../lib/site/copy";
import {
  DESKTOP_DOWNLOADS,
  DESKTOP_PLATFORMS,
  type DesktopPlatformId,
  WINDOWS_INSTALLER_GUIDE_URL,
} from "../../lib/site/downloads";
import { cleanRoom } from "../../lib/site/judge/clean-room";
import {
  compareLayout,
  type LayoutRef,
  measureLayoutInPage,
} from "../../lib/site/judge/likeness";
import { collectPageText } from "../../lib/site/judge/page-text";
import { diffPngPixels } from "../../lib/site/judge/png-diff";

// Desktop app page (C07) on Chromium, Firefox and WebKit at 1440, 1024 and 390.
const WIDTHS = [
  [1440, 900],
  [1024, 768],
  [390, 844],
] as const;

const en = SITE_COPY.en;

const FAKE_PLATFORM_ENV: Record<
  DesktopPlatformId,
  { uadPlatform: string; platform: string; userAgent: string }
> = {
  windows: {
    uadPlatform: "Windows",
    platform: "Win32",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0",
  },
  macos: {
    uadPlatform: "macOS",
    platform: "MacIntel",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
  },
  linux: {
    uadPlatform: "Linux",
    platform: "Linux x86_64",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
  },
};

const FAKE_MOBILE_ENV = {
  uadPlatform: "Android",
  platform: "Linux armv8l",
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36",
};

async function fakeClientNavigator(
  page: Page,
  spec: { uadPlatform: string; platform: string; userAgent: string },
) {
  await page.addInitScript((s) => {
    try {
      Object.defineProperty(Navigator.prototype, "userAgentData", {
        get: () => ({ platform: s.uadPlatform, brands: [], mobile: false }),
        configurable: true,
      });
    } catch {
      // Fallback to instance override.
    }
    try {
      Object.defineProperty(navigator, "userAgentData", {
        get: () => ({ platform: s.uadPlatform, brands: [], mobile: false }),
        configurable: true,
      });
    } catch {
      // Ignore if non-configurable.
    }
    try {
      Object.defineProperty(Navigator.prototype, "platform", {
        get: () => s.platform,
        configurable: true,
      });
    } catch {
      // Fallback to instance override.
    }
    try {
      Object.defineProperty(navigator, "platform", {
        get: () => s.platform,
        configurable: true,
      });
    } catch {
      // Ignore if non-configurable.
    }
    try {
      Object.defineProperty(Navigator.prototype, "userAgent", {
        get: () => s.userAgent,
        configurable: true,
      });
    } catch {
      // Fallback to instance override.
    }
  }, spec);
}

async function fakeClientPlatform(page: Page, target: DesktopPlatformId) {
  await fakeClientNavigator(page, FAKE_PLATFORM_ENV[target]);
}

async function open(page: Page) {
  await page.goto("/desktop");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".site-header")).toHaveAttribute(
    "data-scrolled",
    "false",
  );
}

async function noSideways(page: Page) {
  const out = await page.evaluate(() => {
    const main = document.querySelector("main") as HTMLElement;
    const parts = [
      ...document.querySelectorAll<HTMLElement>("[data-ref-section]"),
    ].map((s) => {
      const r = s.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        inner: s.scrollWidth - s.clientWidth,
      };
    });
    return {
      width: window.innerWidth,
      main: main.scrollWidth - main.clientWidth,
      parts,
    };
  });
  expect(out.main).toBeLessThanOrEqual(0);
  for (const p of out.parts) {
    expect(p.left).toBeGreaterThanOrEqual(-0.5);
    expect(p.right).toBeLessThanOrEqual(out.width + 0.5);
    expect(p.inner).toBeLessThanOrEqual(0);
  }
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

for (const [width, height] of WIDTHS) {
  test(`at ${width}: header action is the download button, all 3 platforms reachable, no sideways scroll`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await fakeClientPlatform(page, "windows");
    await open(page);

    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText(en.desktop.hero.title);

    // Header action is the desktop download button.
    const headerCta = page.locator(
      '.site-header__cta[data-desktop-download-cta="true"]',
    );
    await expect(headerCta).toHaveCount(1);
    await expect(headerCta).toHaveAttribute(
      "href",
      WINDOWS_INSTALLER_GUIDE_URL,
    );
    await expect(headerCta).toContainText(en.desktop.ctaLabel.windows);

    // All three platforms are always present and reachable in the table.
    const table = page.getByRole("table", { name: en.desktop.platforms.title });
    await expect(table).toHaveCount(1);
    for (const id of DESKTOP_PLATFORMS) {
      const row = page.locator(`[data-platform-row="${id}"]`);
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(en.desktop.platforms.names[id]);
    }

    // Planned platforms (macOS, Linux) show "planned" with zero download link and offer browser.
    for (const plannedId of ["macos", "linux"] as const) {
      const row = page.locator(`[data-platform-row="${plannedId}"]`);
      await expect(row).toHaveAttribute("data-platform-status", "planned");
      await expect(row).toContainText(/planned/iu);
      await expect(
        row.locator(`[data-platform-link="${plannedId}"]`),
      ).toHaveCount(0);
      await expect(
        row.locator(`[data-platform-browser-link="${plannedId}"]`),
      ).toHaveAttribute("href", "/create");
    }

    // Closing band matches desktop study: hidden at 390 (outline-390.json has no measure), visible at 1024/1440.
    const closingBand = page.locator('[data-ref-section="8"]');
    if (width === 390) {
      await expect(closingBand).toBeHidden();
    } else {
      await expect(closingBand).toBeVisible();
    }

    await noSideways(page);
  });
}

for (const platform of DESKTOP_PLATFORMS) {
  test(`client platform detection for ${platform}: updates download CTAs and highlights row cleanly`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await fakeClientPlatform(page, platform);
    await open(page);

    const spec = DESKTOP_DOWNLOADS[platform];
    const expectedHref = spec.downloadUrl ?? "#platforms";

    const headerCta = page.locator(
      '.site-header__cta[data-desktop-download-cta="true"]',
    );
    await expect(headerCta).toHaveAttribute("data-detected-platform", platform);
    await expect(headerCta).toHaveAttribute(
      "data-platform-status",
      spec.status,
    );
    await expect(headerCta).toHaveAttribute("href", expectedHref);
    await expect(headerCta).toContainText(en.desktop.ctaLabel[platform]);

    // Hero note reflects detected platform honestly.
    await expect(
      page.locator('[data-desktop-platform-note="true"]'),
    ).toHaveText(en.desktop.heroNote[platform]);

    // Detected row is highlighted; all 3 rows stay visible.
    for (const id of DESKTOP_PLATFORMS) {
      const row = page.locator(`[data-platform-row="${id}"]`);
      await expect(row).toHaveAttribute(
        "data-current-platform",
        String(id === platform),
      );
      const badge = row.locator(`[data-platform-current-badge="${id}"]`);
      if (id === platform) {
        await expect(badge).toBeVisible();
      } else {
        await expect(badge).toBeHidden();
      }
    }

    // For planned platforms, clicking the header download CTA scrolls to #platforms (no dead link).
    if (!spec.downloadUrl) {
      await headerCta.click();
      await expect(page).toHaveURL(/\/desktop#platforms$/u);
      await expect(page.locator("#platforms")).toBeVisible();
    }
  });
}

for (const lang of ["en", "it"] as const) {
  for (const platform of ["macos", "linux"] as const) {
    test(`at 390 (${lang}, ${platform}): swapped CTA labels never clip and hero height and CLS stay stable`, async ({
      browser,
      page,
      baseURL,
    }) => {
      const origin = baseURL ?? "http://127.0.0.1";
      // Measure pure server-rendered hero height (island script blocked) with fonts ready as the baseline.
      const ssrContext = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      let ssrHeroHeight = 0;
      try {
        await ssrContext.addCookies([
          { name: "mellodifai_lang", value: lang, url: origin },
        ]);
        const ssrPage = await ssrContext.newPage();
        await ssrPage.route("**/site/islands/**", (route) => route.abort());
        await ssrPage.goto(`${origin}/desktop`);
        await ssrPage.evaluate(async () => {
          const fontsUrl = document.documentElement.getAttribute(
            "data-site-fonts-url",
          );
          if (fontsUrl) {
            await new Promise<void>((resolve) => {
              const link = document.createElement("link");
              link.rel = "stylesheet";
              link.href = fontsUrl;
              link.onload = () => resolve();
              link.onerror = () => resolve();
              document.head.appendChild(link);
            });
          }
          await document.fonts.ready;
        });
        ssrHeroHeight = await ssrPage.evaluate(() => {
          const hero = document.querySelector(".site-desk-hero");
          return hero ? Math.round(hero.getBoundingClientRect().height) : 0;
        });
      } finally {
        await ssrContext.close();
      }
      expect(ssrHeroHeight).toBeGreaterThan(200);

      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .context()
        .addCookies([{ name: "mellodifai_lang", value: lang, url: origin }]);
      await fakeClientPlatform(page, platform);
      await page.addInitScript(() => {
        const w = window as unknown as { __clsTotal?: number };
        w.__clsTotal = 0;
        try {
          if (
            typeof PerformanceObserver !== "undefined" &&
            PerformanceObserver.supportedEntryTypes?.includes("layout-shift")
          ) {
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries() as Array<
                PerformanceEntry & { hadRecentInput?: boolean; value?: number }
              >) {
                if (!entry.hadRecentInput && typeof entry.value === "number") {
                  w.__clsTotal = (w.__clsTotal ?? 0) + entry.value;
                }
              }
            }).observe({ type: "layout-shift", buffered: true });
          }
        } catch {
          // Non-Chromium engines may not expose layout-shift entries.
        }
      });

      await open(page);
      // Wait for deferred fonts stylesheet too so font metrics match the SSR <noscript> baseline.
      await page.waitForFunction(() => {
        const link = document.querySelector<HTMLLinkElement>(
          'link[data-site-fonts="true"]',
        );
        return Boolean(link?.sheet);
      });
      await page.evaluate(() => document.fonts.ready);

      const copy = SITE_COPY[lang].desktop;
      const headerCta = page.locator(
        '.site-header__cta[data-desktop-download-cta="true"]',
      );
      await expect(headerCta).toHaveAttribute(
        "data-detected-platform",
        platform,
      );
      await expect(
        page.locator('[data-desktop-platform-note="true"]'),
      ).toHaveText(copy.heroNote[platform]);

      // Every visible download CTA label (header + hero + included + showcase) must fit without clipping.
      const labelCheck = await page.evaluate(() => {
        const out: Array<{
          inHeader: boolean;
          text: string;
          scrollWidth: number;
          clientWidth: number;
          hasIcon: boolean;
        }> = [];
        for (const a of document.querySelectorAll<HTMLAnchorElement>(
          'a[data-desktop-download-cta="true"]',
        )) {
          const r = a.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const span = a.querySelector<HTMLElement>(
            '[data-site-button-label="true"]',
          );
          if (!span) continue;
          out.push({
            inHeader: a.classList.contains("site-header__cta"),
            text: span.textContent ?? "",
            scrollWidth: span.scrollWidth,
            clientWidth: span.clientWidth,
            hasIcon: a.querySelector("svg") !== null,
          });
        }
        const hero = document.querySelector(".site-desk-hero");
        const w = window as unknown as { __clsTotal?: number };
        return {
          labels: out,
          cls: w.__clsTotal ?? 0,
          heroHeightAfter: hero
            ? Math.round(hero.getBoundingClientRect().height)
            : 0,
        };
      });

      expect(labelCheck.labels.length).toBeGreaterThanOrEqual(2);
      expect(labelCheck.labels.some((l) => l.inHeader)).toBe(true);
      for (const l of labelCheck.labels) {
        expect(l.text).toBe(copy.ctaLabel[platform]);
        expect(l.hasIcon).toBe(true);
        expect(
          l.scrollWidth,
          `${lang}/${platform} label "${l.text}" clipped (${l.scrollWidth} > ${l.clientWidth})`,
        ).toBeLessThanOrEqual(l.clientWidth);
      }
      expect(labelCheck.cls).toBeLessThan(0.05);
      expect(
        Math.abs(labelCheck.heroHeightAfter - ssrHeroHeight),
        `hero height shifted from ${ssrHeroHeight} to ${labelCheck.heroHeightAfter}`,
      ).toBeLessThanOrEqual(1);
      await noSideways(page);
    });
  }
}

for (const lang of ["it", "en"] as const) {
  test(`at 390, 412, 600, 767 (${lang}): delayed web fonts match fallback heading height with no empty line and CLS < 0.05`, async ({
    browser,
    baseURL,
    browserName,
  }) => {
    const origin = baseURL ?? "http://127.0.0.1";

    for (const width of [390, 412, 600, 767] as const) {
      // Fresh context per width guarantees a cold font cache so fallback -> web-font swap runs every time.
      const context = await browser.newContext({
        viewport: { width, height: 844 },
      });
      await context.addCookies([
        { name: "mellodifai_lang", value: lang, url: origin },
      ]);
      const page = await context.newPage();

      let releaseFonts = () => {};
      const fontGate = new Promise<void>((resolve) => {
        releaseFonts = resolve;
      });
      await page.route(/\/site\/fonts\//u, async (route) => {
        await fontGate;
        await route.continue();
      });
      await page.addInitScript(() => {
        const w = window as unknown as { __clsFontDelay?: number };
        w.__clsFontDelay = 0;
        try {
          if (
            typeof PerformanceObserver !== "undefined" &&
            PerformanceObserver.supportedEntryTypes?.includes("layout-shift")
          ) {
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries() as Array<
                PerformanceEntry & { hadRecentInput?: boolean; value?: number }
              >) {
                if (!entry.hadRecentInput && typeof entry.value === "number") {
                  w.__clsFontDelay = (w.__clsFontDelay ?? 0) + entry.value;
                }
              }
            }).observe({ type: "layout-shift", buffered: true });
          }
        } catch {
          // Non-Chromium engines may not expose layout-shift entries.
        }
      });

      await page.goto(`${origin}/desktop`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#desktop-hero-title");
      // Wait for at least one paint with the fallback face before releasing the web font files.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );

      const measureTitle = () =>
        page.evaluate(() => {
          const title = document.querySelector<HTMLElement>(
            "#desktop-hero-title",
          );
          const lede = document.querySelector<HTMLElement>(
            ".site-desk-hero .site-lede",
          );
          if (!title || !lede) return null;
          const range = document.createRange();
          range.selectNodeContents(title);
          const lineTops = new Set(
            [...range.getClientRects()].map((r) => Math.round(r.top)),
          );
          const style = getComputedStyle(title);
          const fontSize = Number.parseFloat(style.fontSize);
          const lineHeight = Number.parseFloat(style.lineHeight) || fontSize;
          const webFontLoaded = [...document.fonts].some(
            (f) =>
              f.family.replaceAll('"', "") === "Instrument Serif" &&
              /U\+0{1,4}-0{0,2}FF/iu.test(f.unicodeRange) &&
              f.status === "loaded",
          );
          return {
            titleHeight: title.getBoundingClientRect().height,
            ledeY: lede.getBoundingClientRect().y,
            lines: lineTops.size,
            lineHeight,
            webFontLoaded,
          };
        });

      const before = await measureTitle();
      expect(before).not.toBeNull();
      expect(
        before?.webFontLoaded,
        `${lang} @ ${width}px must measure fallback before web font loads`,
      ).toBe(false);

      // Release blocked font files and wait for Instrument Serif to load and settle.
      releaseFonts();
      await page.waitForFunction(() => {
        const link = document.querySelector<HTMLLinkElement>(
          'link[data-site-fonts="true"]',
        );
        return Boolean(link?.sheet);
      });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() =>
        [...document.fonts].some(
          (f) =>
            f.family.replaceAll('"', "") === "Instrument Serif" &&
            /U\+0{1,4}-0{0,2}FF/iu.test(f.unicodeRange) &&
            f.status === "loaded",
        ),
      );
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );

      const after = await measureTitle();
      expect(after).not.toBeNull();
      expect(after?.webFontLoaded).toBe(true);
      expect(
        Math.abs((after?.titleHeight ?? 0) - (before?.titleHeight ?? 0)),
        `${lang} @ ${width}px title height shifted from ${before?.titleHeight} to ${after?.titleHeight}`,
      ).toBeLessThanOrEqual(2);
      expect(
        after?.lines,
        `${lang} @ ${width}px line count changed from ${before?.lines} to ${after?.lines}`,
      ).toBe(before?.lines);
      expect(
        Math.abs((after?.ledeY ?? 0) - (before?.ledeY ?? 0)),
        `${lang} @ ${width}px lede top shifted from ${before?.ledeY} to ${after?.ledeY}`,
      ).toBeLessThanOrEqual(2);
      // No empty reserved line: box height must match its actual wrapped line count.
      const expectedBoxHeight = (after?.lines ?? 1) * (after?.lineHeight ?? 0);
      expect(
        Math.abs((after?.titleHeight ?? 0) - expectedBoxHeight),
        `${lang} @ ${width}px title box height ${after?.titleHeight} has empty space vs ${after?.lines} line(s) * ${after?.lineHeight}px`,
      ).toBeLessThanOrEqual(4);
      // At 412, 600, and 767 (and 390 for Italian), the title fits on 1 line with no empty second line.
      if (width >= 412 || lang === "it") {
        expect(
          after?.lines,
          `${lang} @ ${width}px should fit on one line`,
        ).toBe(1);
      }

      if (browserName === "chromium") {
        const cls = await page.evaluate(
          () =>
            (window as unknown as { __clsFontDelay?: number }).__clsFontDelay ??
            0,
        );
        expect(cls, `${lang} @ ${width}px delayed-font CLS`).toBeLessThan(0.05);
      }
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await context.close();
    }
  });
}

test("phone visitor (Android): CTA falls back to Windows guide and no 'Your system' badge is shown", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fakeClientNavigator(page, FAKE_MOBILE_ENV);
  await open(page);

  const headerCta = page.locator(
    '.site-header__cta[data-desktop-download-cta="true"]',
  );
  await expect(headerCta).toHaveAttribute("href", WINDOWS_INSTALLER_GUIDE_URL);
  for (const id of DESKTOP_PLATFORMS) {
    const row = page.locator(`[data-platform-row="${id}"]`);
    await expect(row).toHaveAttribute("data-current-platform", "false");
    await expect(
      row.locator(`[data-platform-current-badge="${id}"]`),
    ).toBeHidden();
  }
});

test("server HTML without JS: no 'Your system' badge is pre-shown on any row", async ({
  request,
}) => {
  const res = await request.get("/desktop", {
    headers: { cookie: "mellodifai_lang=en" },
  });
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).not.toContain('data-current-platform="true"');
  for (const id of DESKTOP_PLATFORMS) {
    expect(html).toMatch(
      new RegExp(`data-platform-current-badge="${id}"[^>]*\\bhidden`, "u"),
    );
  }
});

test("C07 showcase marquee: moves at 32 px/s +/- 4 in opposite directions and pauses on hover and focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixedTime = Date.UTC(2026, 10, 28, 12, 0, 0);
  await page.clock.install({ time: fixedTime });
  await page.goto("/desktop");
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

  // Hover pauses row 0.
  const row0 = page.locator('[data-marquee-row="0"]');
  await row0.scrollIntoViewIfNeeded();
  await row0.hover();
  await expect(row0).toHaveAttribute("data-marquee-paused", "true");
  const h0 = await readX(0);
  await page.clock.runFor(1000);
  const h1 = await readX(0);
  expect(Math.abs(h1.x - h0.x)).toBeLessThan(0.5);

  // Keyboard focus inside row 1 pauses it and keeps the focused card in view.
  const row1 = page.locator('[data-marquee-row="1"]');
  const row1Link = row1.locator('[data-marquee-copy="0"] a').first();
  await page.keyboard.press("Tab");
  await row1Link.focus();
  await expect(row1).toHaveAttribute("data-marquee-paused", "true");
  const f0 = await readX(1);
  await page.clock.runFor(1000);
  const f1 = await readX(1);
  expect(Math.abs(f1.x - f0.x)).toBeLessThan(0.5);
  await row1Link.evaluate((el: HTMLElement) => el.blur());
  await expect(row1).toHaveAttribute("data-marquee-paused", "false");
});

test("C07 reduced motion: no loop runs and 0 changed pixels in the hero over 2 s after deferred fonts settle", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);

  await expect(page.locator('[data-marquee-row="0"]')).toHaveAttribute(
    "data-marquee-paused",
    "true",
  );
  await expect(page.locator('[data-marquee-row="1"]')).toHaveAttribute(
    "data-marquee-paused",
    "true",
  );

  // Wait for deferred post-LCP web fonts stylesheet and faces to settle before pixel comparison.
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

  const hero = page.locator(".site-desk-hero");
  const t0 = await page.evaluate(() => performance.now());
  const shotBefore = await hero.screenshot({ animations: "allow" });
  await page.waitForFunction((start) => performance.now() - start >= 2000, t0);
  const shotAfter = await hero.screenshot({ animations: "allow" });
  const diff = diffPngPixels(shotBefore, shotAfter);
  expect(
    diff.changedPixels,
    `changedPixels=${diff.changedPixels}/${diff.totalPixels}`,
  ).toBe(0);
});

test("FAQ accordion: 10 questions open one at a time, each answer is a region and closes inert", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const faq = page.locator("#faq");
  const q = (i: number) =>
    faq.getByRole("button", { name: en.desktop.faq[i].q });

  await expect(faq.locator(".site-faq__item")).toHaveCount(10);
  await expect(q(0)).toHaveAttribute("aria-expanded", "true");
  await expect(q(1)).toHaveAttribute("aria-expanded", "false");

  const panel0 = page.locator(
    `[id="${await q(0).getAttribute("aria-controls")}"]`,
  );
  await expect(panel0).toHaveAttribute("role", "region");
  await expect(panel0).toContainText(en.desktop.faq[0].a);

  await q(1).click();
  await expect(q(1)).toHaveAttribute("aria-expanded", "true");
  await expect(q(0)).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(() =>
      panel0.evaluate((el) => Math.round(el.getBoundingClientRect().height)),
    )
    .toBe(0);
});

test("link check: every href on /desktop answers 200 in the lab and real release/guide URL answers 200/302", async ({
  page,
  request,
  browserName,
}) => {
  await open(page);
  const links = await page.locator("a[href]").evaluateAll((as) =>
    as.map((a) => ({
      href: (a as HTMLAnchorElement).getAttribute("href") ?? "",
      rel: (a as HTMLAnchorElement).getAttribute("rel") ?? "",
    })),
  );
  const hrefs = [...new Set(links.map((l) => l.href))];
  expect(hrefs.length).toBeGreaterThan(0);
  expect(hrefs.filter((h) => h === "#" || h === "#top")).toEqual([]);
  expect(hrefs).toContain(WINDOWS_INSTALLER_GUIDE_URL);

  for (const h of hrefs) {
    if (h.startsWith("#")) {
      expect(await page.locator(h).count(), h).toBe(1);
    } else if (h.startsWith("/")) {
      const [pathPart, hash] = h.split("#");
      const res = await request.get(pathPart || "/", { maxRedirects: 5 });
      expect(res.status(), h).toBe(200);
      if (hash && pathPart === "/desktop") {
        expect(await page.locator(`#${hash}`).count(), h).toBe(1);
      }
    } else if (h.startsWith("https://")) {
      expect(h).toBe(WINDOWS_INSTALLER_GUIDE_URL);
      for (const l of links.filter((x) => x.href === h)) {
        expect(l.rel).toContain("noopener");
        expect(l.rel).toContain("noreferrer");
      }
      if (browserName === "chromium") {
        let status = 0;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const res = await request.head(h, { maxRedirects: 0 });
            status = res.status();
            if ([200, 301, 302].includes(status)) break;
          } catch {
            status = 0;
          }
          if (attempt === 0) {
            await page.waitForTimeout(500);
          }
        }
        expect([200, 301, 302], h).toContain(status);
      }
    }
  }
});

test("Italian page: same 11 sections, Italian words and honest platform states", async ({
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
  await fakeClientPlatform(page, "macos");
  await open(page);
  await expect(page.locator("h1")).toHaveText(SITE_COPY.it.desktop.hero.title);
  await expect(page.locator("[data-ref-section]")).toHaveCount(10);
  await expect(page.locator("[data-ref-footer]")).toHaveCount(1);
  await expect(
    page.locator('.site-header__cta[data-desktop-download-cta="true"]'),
  ).toContainText(SITE_COPY.it.desktop.ctaLabel.macos);
});

for (const theme of ["dark", "light"] as const) {
  for (const width of [1440, 390]) {
    test(`axe: zero serious or critical issues, ${theme} theme at ${width}, default and open FAQ`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      if (theme === "light") {
        await page.addInitScript(() =>
          localStorage.setItem("mellodifai-theme", "light"),
        );
      }
      await page.emulateMedia({ reducedMotion: "reduce" });
      await open(page);
      await page.waitForTimeout(300);

      const bad = async () =>
        (await new AxeBuilder({ page }).analyze()).violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map(
            (v) =>
              `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
          );
      expect(await bad()).toEqual([]);

      await page
        .locator("#faq")
        .getByRole("button", { name: en.desktop.faq[1].q })
        .click();
      await page.waitForTimeout(200);
      expect(await bad()).toEqual([]);
    });
  }
}

test("likeness judge (J1): section order and grid within 4 px across 1440, 1024 and 390", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "the reference was measured in Chromium",
  );
  const reference = JSON.parse(
    readFileSync(join(import.meta.dirname, "layout-ref/desktop.json"), "utf8"),
  ) as LayoutRef;
  const candidate: LayoutRef = { sections: reference.sections, widths: {} };
  for (const [w, h] of WIDTHS) {
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
  console.log(
    `desktop likeness: ${result.checked} values, worst ${result.worstSteps} steps`,
  );
  expect(result.failures).toEqual([]);
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
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page);
      ours.push(...(await page.evaluate(collectPageText, undefined)));
      for (const item of SITE_COPY[lang].desktop.faq.slice(1)) {
        await page
          .locator("#faq")
          .getByRole("button", { name: item.q })
          .click();
        ours.push(...(await page.evaluate(collectPageText, undefined)));
      }
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

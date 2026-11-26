import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
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

// Changelog page (C09) on Chromium, Firefox and WebKit at 1440, 1024 and 390.
const WIDTHS = [
  [1440, 900],
  [1024, 768],
  [390, 844],
] as const;

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const REPO_TAGS = execFileSync(
  "git",
  [
    "for-each-ref",
    "--sort=-creatordate",
    "--format=%(refname:short)",
    "refs/tags",
  ],
  { cwd: REPO_ROOT, encoding: "utf8" },
)
  .split(/\r?\n/u)
  .map((t) => t.trim())
  .filter(Boolean);

const en = SITE_COPY.en;
const itCopy = SITE_COPY.it;

async function open(page: Page, path = "/changelog") {
  await page.goto(path);
  await expect(page.locator(".site-header")).toHaveAttribute(
    "data-scrolled",
    "false",
  );
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

async function assertNoSidewaysScroll(page: Page) {
  const out = await page.evaluate(() => {
    const doc = document.documentElement;
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
      docScrollW: doc.scrollWidth,
      docClientW: doc.clientWidth,
      mainOverflow: main.scrollWidth - main.clientWidth,
      parts,
    };
  });
  expect(out.docScrollW).toBe(out.docClientW);
  expect(out.mainOverflow).toBeLessThanOrEqual(0);
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
  test(`at ${width}x${height}: one entry per git tag, ruler stays under header, chip click and scroll sync aria-current, date layout, zero sideways scroll`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await open(page);

    // Heading and one entry + one chip per git tag in the repo at build time.
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText(en.changelog.title);

    const entries = page.locator("[data-release-entry]");
    const chips = page.locator("[data-release-chip]");
    await expect(entries).toHaveCount(REPO_TAGS.length);
    await expect(chips).toHaveCount(REPO_TAGS.length);

    const renderedTags = await entries.evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-release-tag") ?? ""),
    );
    expect(renderedTags).toEqual(REPO_TAGS);

    // Date column geometry: at 390 the date sits over the content; at 1024 and 1440 side by side.
    const metaVsBody = await entries.first().evaluate((article) => {
      const meta = article
        .querySelector(".site-release__meta")
        ?.getBoundingClientRect();
      const body = article
        .querySelector(".site-release__body")
        ?.getBoundingClientRect();
      return meta && body
        ? {
            metaTop: meta.top,
            metaBottom: meta.bottom,
            metaLeft: meta.left,
            metaRight: meta.right,
            bodyTop: body.top,
            bodyLeft: body.left,
          }
        : null;
    });
    expect(metaVsBody).not.toBeNull();
    if (metaVsBody) {
      if (width === 390) {
        expect(metaVsBody.metaBottom).toBeLessThanOrEqual(
          metaVsBody.bodyTop + 1,
        );
      } else {
        expect(metaVsBody.metaRight).toBeLessThan(metaVsBody.bodyLeft);
      }
    }

    // First chip is initially marked with aria-current="location".
    await expect(chips.first()).toHaveAttribute("aria-current", "location");

    // Clicking a later chip scrolls to its entry and marks that chip.
    const targetIdx = Math.min(4, REPO_TAGS.length - 1);
    const targetChip = chips.nth(targetIdx);
    const targetId = await targetChip.getAttribute("data-release-chip");
    expect(targetId).toBeTruthy();

    await targetChip.click();
    await expect(targetChip).toHaveAttribute("aria-current", "location");
    await expect(chips.first()).not.toHaveAttribute("aria-current", "location");

    await expect
      .poll(async () => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(200);

    // While scrolled, the release ruler stays stuck directly under the fixed header.
    const stickyCheck = await page.evaluate(() => {
      const header = document
        .querySelector(".site-header")
        ?.getBoundingClientRect();
      const ruler = document
        .querySelector("[data-release-ruler]")
        ?.getBoundingClientRect();
      return header && ruler
        ? {
            headerBottom: Math.round(header.bottom),
            rulerTop: Math.round(ruler.top),
            rulerHeight: Math.round(ruler.height),
          }
        : null;
    });
    expect(stickyCheck).not.toBeNull();
    if (stickyCheck) {
      expect(
        Math.abs(stickyCheck.rulerTop - stickyCheck.headerBottom),
      ).toBeLessThanOrEqual(4);
      expect(stickyCheck.rulerHeight).toBeGreaterThan(40);
    }

    // Target entry sits below the header and ruler (not covered by sticky chrome).
    const entryTop = await page
      .locator(`#${targetId}`)
      .evaluate((el) => Math.round(el.getBoundingClientRect().top));
    if (stickyCheck) {
      expect(entryTop).toBeGreaterThanOrEqual(
        stickyCheck.headerBottom + stickyCheck.rulerHeight - 24,
      );
      expect(entryTop).toBeLessThan(height);
    }

    // Scrolling manually to a different entry updates aria-current on the ruler chips.
    const manualIdx = Math.min(7, REPO_TAGS.length - 1);
    const manualChip = chips.nth(manualIdx);
    const manualId = await manualChip.getAttribute("data-release-chip");
    // Wait for programmatic click-scroll lock to expire before manual scroll.
    await page.waitForTimeout(750);
    await page.evaluate((id) => {
      const el = document.getElementById(id ?? "");
      if (!el) return;
      const header = document.querySelector(".site-header");
      const ruler = document.querySelector("[data-release-ruler]");
      const offset =
        (header?.getBoundingClientRect().height ?? 73) +
        (ruler?.getBoundingClientRect().height ?? 90);
      const top = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: "instant" });
    }, manualId);

    await expect(manualChip).toHaveAttribute("aria-current", "location");
    await expect(targetChip).not.toHaveAttribute("aria-current", "location");

    // Scrolling back to top marks the first chip again.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect(chips.first()).toHaveAttribute("aria-current", "location");

    await assertNoSidewaysScroll(page);
  });
}

test("keyboard works on ruler chips (ArrowRight, ArrowLeft, Home, End, Enter, Space)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);

  const chips = page.locator("[data-release-chip]");
  await chips.first().focus();
  await expect(chips.first()).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expect(chips.nth(1)).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expect(chips.nth(2)).toBeFocused();

  await page.keyboard.press("ArrowLeft");
  await expect(chips.nth(1)).toBeFocused();

  await page.keyboard.press("End");
  await expect(chips.last()).toBeFocused();

  await page.keyboard.press("Home");
  await expect(chips.first()).toBeFocused();

  // Move to chip 3 and activate via Enter.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(chips.nth(3)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(chips.nth(3)).toHaveAttribute("aria-current", "location");
  await expect
    .poll(async () => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(200);

  // Move to chip 5 and activate via Space.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(chips.nth(5)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(chips.nth(5)).toHaveAttribute("aria-current", "location");
});

test("reduced motion uses no smooth scroll and disables chip transitions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);

  await page.evaluate(() => {
    const win = window as unknown as {
      __scrollBehaviors?: string[];
      __origScrollTo?: typeof window.scrollTo;
    };
    win.__scrollBehaviors = [];
    win.__origScrollTo = window.scrollTo.bind(window);
    window.scrollTo = ((...args: unknown[]) => {
      if (args.length === 1 && typeof args[0] === "object" && args[0]) {
        const opts = args[0] as ScrollToOptions;
        win.__scrollBehaviors?.push(opts.behavior ?? "auto");
      }
      return (win.__origScrollTo as (...a: unknown[]) => void)(...args);
    }) as typeof window.scrollTo;
  });

  await page.locator("[data-release-chip]").nth(3).click();

  const result = await page.evaluate(() => {
    const win = window as unknown as { __scrollBehaviors?: string[] };
    const chip = document.querySelector("[data-release-chip]");
    const td = chip ? getComputedStyle(chip).transitionDuration : "";
    const track = document.querySelector("[data-release-ruler-track]");
    const trackBehavior = track ? getComputedStyle(track).scrollBehavior : "";
    return {
      behaviors: win.__scrollBehaviors ?? [],
      chipTransition: td,
      trackBehavior,
    };
  });

  expect(result.behaviors.length).toBeGreaterThan(0);
  expect(result.behaviors).not.toContain("smooth");
  expect(
    result.chipTransition.split(",").every((d) => Number.parseFloat(d) === 0),
  ).toBe(true);
  expect(result.trackBehavior).toBe("auto");
});

test("Italian page renders Italian title, ruler labels, and same tag count", async ({
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
  await open(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "it");
  await expect(page.locator("h1")).toHaveText(itCopy.changelog.title);
  await expect(page.locator("[data-release-entry]")).toHaveCount(
    REPO_TAGS.length,
  );
  await expect(page.locator("[data-release-ruler]")).toHaveAttribute(
    "aria-label",
    itCopy.changelog.rulerLabel,
  );
});

test("no Astryx client JS or Zod chunks ship to the browser, and page works with JS off", async ({
  browser,
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const jsBodies: Array<{ url: string; body: string }> = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (
      res.status() === 200 &&
      (url.includes("/_next/static/") || url.includes("/site/islands/")) &&
      url.endsWith(".js") &&
      !url.includes("next-devtools")
    ) {
      try {
        jsBodies.push({ url, body: await res.text() });
      } catch {
        // Ignore aborted bodies on teardown.
      }
    }
  });
  await open(page);
  expect(jsBodies.length).toBeGreaterThan(0);
  for (const entry of jsBodies) {
    expect(entry.url).not.toContain("/_next/static/chunks/");
    expect(entry.body).not.toContain("ZodError");
    expect(entry.body).not.toContain("react-dom");
  }

  const noJsContext = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { width: 1440, height: 900 },
  });
  await noJsContext.addCookies([
    {
      name: "mellodifai_lang",
      value: "en",
      url: baseURL ?? "http://127.0.0.1",
    },
  ]);
  const noJsPage = await noJsContext.newPage();
  try {
    await noJsPage.goto("/changelog");
    await expect(noJsPage.locator("h1")).toHaveText(en.changelog.title);
    await expect(noJsPage.locator("[data-release-entry]")).toHaveCount(
      REPO_TAGS.length,
    );
    await expect(noJsPage.locator("[data-release-chip]")).toHaveCount(
      REPO_TAGS.length,
    );
    const firstHref = await noJsPage
      .locator("[data-release-chip]")
      .first()
      .getAttribute("href");
    expect(firstHref).toMatch(/^#release-/u);
  } finally {
    await noJsContext.close();
  }
});

for (const theme of ["dark", "light"] as const) {
  for (const width of [1440, 390]) {
    test(`axe (J4): zero serious or critical issues (${theme} theme, ${width}px)`, async ({
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

      const checkAxe = async () =>
        (await new AxeBuilder({ page }).analyze()).violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map(
            (v) =>
              `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
          );

      expect(await checkAxe()).toEqual([]);

      // Also check after clicking a ruler chip to move scroll and aria-current.
      await page.locator("[data-release-chip]").nth(2).click();
      expect(await checkAxe()).toEqual([]);
    });
  }
}

test("likeness judge (J1): section order, columns, and grids match layout-ref within one spacing step", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "the reference was measured in Chromium",
  );
  const reference = JSON.parse(
    readFileSync(
      join(import.meta.dirname, "layout-ref/changelog.json"),
      "utf8",
    ),
  ) as LayoutRef;
  const candidate: LayoutRef = { sections: reference.sections, widths: {} };
  for (const [w, h] of WIDTHS) {
    await page.setViewportSize({ width: w, height: h });
    await open(page, reference.route ?? "/changelog");
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
    `likeness changelog: ${result.checked} values, worst ${result.worstSteps} steps`,
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

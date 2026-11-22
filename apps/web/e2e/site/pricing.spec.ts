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
import { COMPARE, PLAN_COUNT } from "../../lib/site/plans";

// The pricing page (C03) on Chromium, Firefox and WebKit. Each behaviour of the ticket runs at
// 1440, 1024 and 390.
const WIDTHS = [
  [1440, 900, 4],
  [1024, 768, 2],
  [390, 844, 1],
] as const;
const en = SITE_COPY.en;

async function open(page: Page) {
  await page.goto("/pricing");
  await page.evaluate(() => document.fonts.ready);
  // Hydrated: the header reads the scroll position.
  await expect(page.locator(".site-header")).toHaveAttribute(
    "data-scrolled",
    "false",
  );
}

const cards = (page: Page) => page.locator(".site-price-plans__grid > *");
const radios = (page: Page) =>
  page
    .getByRole("radiogroup", { name: en.plans.switchLabel })
    .getByRole("radio");

// `.site` clips sideways overflow, so the document never looks wider than the window. Measure
// below the clip: every section of the page must lie inside the window, and the main column
// must not hold anything wider than itself.
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

// The compare table's own scroll box (the Astryx scroll wrapper around the table).
async function tableBox(page: Page) {
  return page.locator(".site-compare").evaluate((table) => {
    const box = table.closest(".astryx-table-scroll-wrapper") as HTMLElement;
    const r = box.getBoundingClientRect();
    box.scrollLeft = box.scrollWidth;
    const heads = table.querySelectorAll('thead th[scope="col"]');
    const last = heads[heads.length - 1].getBoundingClientRect().right;
    box.scrollLeft = 0;
    return {
      left: r.left,
      right: r.right,
      scrollWidth: box.scrollWidth,
      clientWidth: box.clientWidth,
      lastRightAfterScroll: last,
      scrolls: /(auto|scroll)/u.test(getComputedStyle(box).overflowX),
    };
  });
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

for (const [width, height, perRow] of WIDTHS) {
  test(`at ${width}: ${perRow} plans per row, every price is the owner's, no sideways scroll`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    await expect(cards(page)).toHaveCount(PLAN_COUNT);
    const tops = await cards(page).evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().top)),
    );
    expect(tops.filter((t) => Math.abs(t - tops[0]) <= 1)).toHaveLength(perRow);
    await expect(page.locator(".site-plan-card__price")).toHaveText(
      Array(PLAN_COUNT).fill(en.plans.price),
    );
    // No number that looks like an amount anywhere in the plans or the table.
    const text = await page
      .locator(".site-price-plans, .site-price-compare")
      .allInnerTexts();
    expect(text.join(" ")).not.toMatch(/[$€£]|\d+[.,]\d{2}/u);
    await noSideways(page);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText(en.pricing.title);
  });

  test(`at ${width}: the period switch is a radio group; the thumb arrives within 400 ms and nothing moves`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    await expect(radios(page)).toHaveCount(2);
    await expect(radios(page).first()).toHaveAttribute("aria-checked", "true");
    const url = page.url();
    const boxes = () =>
      cards(page).evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 2));
        }),
      );
    const gridHeight = () =>
      page
        .locator(".site-price-plans__grid")
        .evaluate((e) => e.getBoundingClientRect().height);
    const before = await boxes();
    const heightBefore = await gridHeight();
    // Time from the click until the thumb's centre is on the chosen option (to 1 px).
    const ms = await page
      .getByRole("radiogroup", { name: en.plans.switchLabel })
      .evaluate(async (group) => {
        const target = group.querySelectorAll<HTMLElement>('[role="radio"]')[1];
        const want = () => {
          const g = group.getBoundingClientRect();
          const t = target.getBoundingClientRect();
          return t.left + t.width / 2 - g.left - group.clientLeft;
        };
        const at = () => {
          const s = getComputedStyle(group, "::before");
          if (s.visibility === "hidden")
            return target.getAttribute("aria-checked") === "true" &&
              getComputedStyle(target).backgroundColor !== "rgba(0, 0, 0, 0)"
              ? want()
              : Number.NaN;
          const x = Number.parseFloat(s.translate.split(" ")[0]) || 0;
          return Number.parseFloat(s.left) + Number.parseFloat(s.width) / 2 + x;
        };
        const t0 = performance.now();
        target.click();
        return new Promise<number>((done) => {
          const step = () => {
            const now = performance.now() - t0;
            if (Math.abs(at() - want()) <= 1) done(now);
            else if (now > 2000) done(Number.POSITIVE_INFINITY);
            else requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
      });
    expect(ms).toBeLessThanOrEqual(400);
    await expect(radios(page).nth(1)).toHaveAttribute("aria-checked", "true");
    await expect(
      page.locator('.site-plan-card__unit[data-shown="true"]').first(),
    ).toHaveText(en.plans.period.yearly);
    // Once the change has settled, every card is where it was and as big as it was.
    await page.waitForTimeout(500);
    expect(await boxes()).toEqual(before);
    expect(await gridHeight()).toBe(heightBefore);
    expect(page.url()).toBe(url);
  });

  test(`at ${width}: arrow keys move the choice; one tab stop`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    const tabStops = () =>
      radios(page).evaluateAll(
        (els) => els.filter((e) => (e as HTMLElement).tabIndex === 0).length,
      );
    expect(await tabStops()).toBe(1);
    await radios(page).first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(radios(page).nth(1)).toHaveAttribute("aria-checked", "true");
    await expect(radios(page).nth(1)).toBeFocused();
    await expect(
      page.locator('.site-plan-card__unit[data-shown="true"]').first(),
    ).toHaveText(en.plans.period.yearly);
    await page.keyboard.press("ArrowLeft");
    await expect(radios(page).first()).toHaveAttribute("aria-checked", "true");
    expect(await tabStops()).toBe(1);
  });

  test(`at ${width}: questions open one at a time, the first at load; each answer is a region`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    const faq = page.locator("#faq");
    const q = (i: number) =>
      faq.getByRole("button", { name: en.pricing.faq[i].q });
    await expect(q(0)).toHaveAttribute("aria-expanded", "true");
    await expect(q(1)).toHaveAttribute("aria-expanded", "false");
    for (const i of [0, 1]) {
      const panel = page.locator(
        `[id="${await q(i).getAttribute("aria-controls")}"]`,
      );
      await expect(panel).toHaveAttribute("role", "region");
      await expect(panel).toHaveAttribute(
        "aria-labelledby",
        (await q(i).getAttribute("id")) ?? "",
      );
    }
    const answer = (i: number) =>
      faq.getByRole("region", { name: en.pricing.faq[i].q });
    await expect(answer(0)).toBeVisible();
    await expect(answer(0)).toContainText(en.pricing.faq[0].a);
    await q(1).click();
    await expect(q(1)).toHaveAttribute("aria-expanded", "true");
    await expect(q(0)).toHaveAttribute("aria-expanded", "false");
    await expect(answer(1)).toBeVisible();
    await expect(answer(0)).toBeHidden();
    // A closed answer has no height and cannot be reached by Tab.
    const closed = page.locator(
      `[id="${await q(0).getAttribute("aria-controls")}"]`,
    );
    await expect
      .poll(() =>
        closed.evaluate((e) => Math.round(e.getBoundingClientRect().height)),
      )
      .toBe(0);
    await q(1).click();
    await expect(q(1)).toHaveAttribute("aria-expanded", "false");
  });

  test(`at ${width}: the compare table is a real table with five groups and four plans`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    const table = page.getByRole("table", { name: en.pricing.compareTitle });
    await expect(table).toHaveCount(1);
    expect(await table.evaluate((t) => t.tagName)).toBe("TABLE");
    const head = table.locator('thead th[scope="col"]');
    await expect(head).toHaveCount(PLAN_COUNT + 1);
    for (const [i, plan] of en.plans.items.entries())
      await expect(head.nth(i + 1)).toContainText(plan.name);
    await expect(table.locator('th[scope="rowgroup"]')).toHaveText(
      COMPARE.map((g) => en.pricing.groups[g.group]),
    );
    await expect(table.locator('th[scope="row"]')).toHaveCount(
      COMPARE.reduce((n, g) => n + g.rows.length, 0),
    );
    // Every tick or dash says included or not in words.
    const first = table.locator("tbody tr").nth(1).locator("td");
    await expect(first).toHaveCount(PLAN_COUNT);
    await expect(first.first()).toContainText(en.pricing.included);
    // A narrow window: the table scrolls inside its own box, the box stays in the window and
    // the last plan column can be scrolled into view. A wide window: nothing to scroll.
    const box = await tableBox(page);
    expect(box.right).toBeLessThanOrEqual(width + 0.5);
    expect(box.left).toBeGreaterThanOrEqual(-0.5);
    if (width === 390) {
      expect(box.scrolls).toBe(true);
      expect(box.scrollWidth).toBeGreaterThan(box.clientWidth);
      expect(box.lastRightAfterScroll).toBeLessThanOrEqual(box.right + 0.5);
    } else expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
    await noSideways(page);
  });
}

for (const width of [1440, 390]) {
  test(`axe: no serious issue at ${width}, at load and with the second question and period open`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
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
      .getByRole("button", { name: en.pricing.faq[1].q })
      .click();
    await radios(page).nth(1).click();
    await page.waitForTimeout(400);
    expect(await bad()).toEqual([]);
  });
}

test("reduced motion: the answer fold, the plus and the unit rise do not move", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  const faq = page.locator("#faq");
  await faq.getByRole("button", { name: en.pricing.faq[1].q }).click();
  await radios(page).nth(1).click();
  // Read at once, no wait: every duration of the moving parts is zero.
  const durations = await page.evaluate(() => {
    const all = (sel: string) => [...document.querySelectorAll(sel)];
    const zero = (v: string) =>
      v.split(",").every((d) => Number.parseFloat(d) === 0);
    const bad: string[] = [];
    for (const el of all(".site-faq__panel, .site-faq__icon")) {
      const s = getComputedStyle(el);
      if (!zero(s.transitionDuration))
        bad.push(`${el.className}: transition ${s.transitionDuration}`);
    }
    for (const el of all(".site-plan-card__unit")) {
      const s = getComputedStyle(el);
      if (s.animationName !== "none" && !zero(s.animationDuration))
        bad.push(`${el.className}: animation ${s.animationDuration}`);
    }
    return {
      bad,
      units: all('.site-plan-card__units[data-animate="true"]').length,
    };
  });
  // The period did change, so the unit rule is live, not skipped.
  expect(durations.units).toBe(4);
  expect(durations.bad).toEqual([]);
});

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
  await page.goto("/pricing");
  await expect(page.locator("h1")).toHaveText(SITE_COPY.it.pricing.title);
  await expect(page.locator("[data-ref-section]")).toHaveCount(4);
  await expect(page.locator(".site-plan-card__price").first()).toHaveText(
    SITE_COPY.it.plans.price,
  );
});

test("no link of the pricing page ends on a missing page", async ({
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
  expect(hrefs).toContain("/pricing");
  for (const h of hrefs.filter((x) => x.startsWith("/"))) {
    const [path, hash] = h.split("#");
    const res = await request.get(path || "/", { maxRedirects: 5 });
    expect(res.status(), h).toBeLessThan(400);
    if (hash && path === "/pricing")
      expect(await page.locator(`#${hash}`).count(), h).toBe(1);
  }
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
    readFileSync(join(import.meta.dirname, "layout-ref/pricing.json"), "utf8"),
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
    `likeness: ${result.checked} values, worst ${result.worstSteps} steps`,
  );
  expect(result.failures).toEqual([]);
});

// The captured text of the reference stays outside the repo (clean room).
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
      await page.goto("/pricing");
      // Every answer and every period: open them all in turn and read the page each time.
      ours.push(...(await page.evaluate(collectPageText, undefined)));
      await page.getByRole("radiogroup").getByRole("radio").nth(1).click();
      for (const item of SITE_COPY[lang].pricing.faq.slice(1)) {
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

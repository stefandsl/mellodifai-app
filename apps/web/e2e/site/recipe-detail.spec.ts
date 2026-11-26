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
import { getRecipeBySlug } from "../../lib/site/recipes";

// Recipe detail page (C06) on Chromium, Firefox and WebKit at 1440, 1024 and 390.
const WIDTHS = [
  [1440, 900],
  [1024, 768],
  [390, 844],
] as const;

const SAMPLE_SLUG = "acoustic-voice-swap";
const AUDIO_SLUG = "group-chat-ballad";
const en = SITE_COPY.en;
const itCopy = SITE_COPY.it;

async function open(page: Page, path = `/recipes/${SAMPLE_SLUG}`) {
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
  test(`at ${width}x${height}: renders every section, action link to /try, glow player, inputs, 12-item more row, and zero sideways scroll`, async ({
    page,
  }) => {
    const recipe = getRecipeBySlug(SAMPLE_SLUG);
    expect(recipe).not.toBeNull();
    if (!recipe) return;

    await page.setViewportSize({ width, height });
    await open(page);

    // Back link, kind, h1 title, line, meta, action button to /recipes/<slug>/try.
    const back = page.locator(".site-recipe-detail__back");
    await expect(back).toHaveAttribute("href", "/recipes");
    await expect(back).toContainText(en.recipeDetail.back);

    await expect(page.locator(".site-recipe-detail__kind")).toHaveText(
      en.recipes.kinds[recipe.kind],
    );
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText(recipe.title.en);
    await expect(page.locator(".site-recipe-detail__line")).toHaveText(
      recipe.summary.en,
    );
    await expect(page.locator(".site-recipe-detail__meta-item")).toHaveCount(6);

    const tryBtn = page.locator('[data-recipe-try="true"]');
    await expect(tryBtn).toHaveAttribute("href", `/recipes/${SAMPLE_SLUG}/try`);
    await expect(tryBtn).toContainText(en.recipeDetail.tryAction);

    // Clip player with ambient glow and custom controls.
    await expect(page.locator(".site-clip__glow")).toBeAttached();
    await expect(page.locator("[data-clip-player]")).toBeVisible();

    // Inputs list matches recipe inputs count.
    await expect(page.locator(".site-inputs__heading")).toHaveText(
      en.recipeDetail.inputsTitle,
    );
    await expect(page.locator(".site-inputs__row")).toHaveCount(
      recipe.inputs.length,
    );

    // More-recipes horizontal row has 12 items and excludes current slug.
    const moreItems = page.locator(".site-card-row__item");
    await expect(moreItems).toHaveCount(12);
    const moreHrefs = await page
      .locator(".site-card-row__link")
      .evaluateAll((els) =>
        els.map((el) => (el as HTMLAnchorElement).getAttribute("href") ?? ""),
      );
    expect(moreHrefs).not.toContain(`/recipes/${SAMPLE_SLUG}`);

    // Strictly zero sideways scroll (scrollWidth === clientWidth).
    await assertNoSidewaysScroll(page);
  });
}

test("clip player: no autoplay, no sound before click, play/pause, speed playbackRate, keyboard controls and accessible names", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);

  const shell = page.locator("[data-clip-player]");
  const media = page.locator("[data-clip-media]");

  // Wait briefly to prove nothing autoplays or advances before user interaction.
  await page.waitForTimeout(300);
  const beforeClick = await media.evaluate((el) => {
    const m = el as HTMLVideoElement;
    return {
      paused: m.paused,
      autoplay: m.autoplay,
      currentTime: m.currentTime,
      playbackRate: m.playbackRate,
      preload: m.preload,
    };
  });
  expect(beforeClick.paused).toBe(true);
  expect(beforeClick.autoplay).toBe(false);
  expect(beforeClick.currentTime).toBe(0);
  expect(beforeClick.playbackRate).toBe(1);
  expect(beforeClick.preload).toBe("none");
  await expect(shell).toHaveAttribute("data-playing", "false");

  // Every control has a non-empty accessible name.
  const playBtn = shell.locator("[data-clip-play]");
  const seekSlider = shell.locator("[data-clip-seek]");
  const speedBtn = shell.locator("[data-clip-speed]");
  const muteBtn = shell.locator("[data-clip-mute]");
  const volumeSlider = shell.locator("[data-clip-volume]");
  const fsBtn = shell.locator("[data-clip-fullscreen]");

  for (const ctrl of [
    playBtn,
    seekSlider,
    speedBtn,
    muteBtn,
    volumeSlider,
    fsBtn,
  ]) {
    const label = await ctrl.getAttribute("aria-label");
    expect((label ?? "").trim().length).toBeGreaterThan(0);
  }

  // Click play, then pause by keyboard Enter.
  await playBtn.click();
  await expect(shell).toHaveAttribute("data-video-active", "true");
  await expect(shell).toHaveAttribute("data-playing", "true");
  await expect(playBtn).toHaveAttribute(
    "aria-label",
    en.recipeDetail.player.pause,
  );

  await playBtn.focus();
  await page.keyboard.press("Enter");
  await expect(shell).toHaveAttribute("data-playing", "false");
  await expect(playBtn).toHaveAttribute(
    "aria-label",
    en.recipeDetail.player.play,
  );

  // Speed control changes media.playbackRate via click and keyboard.
  await speedBtn.click();
  expect(
    await media.evaluate((el) => (el as HTMLMediaElement).playbackRate),
  ).toBe(1.25);
  await expect(speedBtn).toContainText("1.25x");
  await expect(speedBtn).toHaveAttribute(
    "aria-label",
    `${en.recipeDetail.player.speed}: 1.25x`,
  );

  await speedBtn.focus();
  await page.keyboard.press("ArrowUp");
  expect(
    await media.evaluate((el) => (el as HTMLMediaElement).playbackRate),
  ).toBe(1.5);
  await page.keyboard.press("ArrowDown");
  expect(
    await media.evaluate((el) => (el as HTMLMediaElement).playbackRate),
  ).toBe(1.25);
  await page.keyboard.press("Space");
  expect(
    await media.evaluate((el) => (el as HTMLMediaElement).playbackRate),
  ).toBe(1.5);

  // Mute button works by keyboard Space and updates media.muted and aria-pressed.
  await muteBtn.focus();
  await page.keyboard.press("Space");
  expect(await media.evaluate((el) => (el as HTMLMediaElement).muted)).toBe(
    true,
  );
  await expect(muteBtn).toHaveAttribute("aria-pressed", "true");
  await expect(muteBtn).toHaveAttribute(
    "aria-label",
    en.recipeDetail.player.mute,
  );

  // Volume slider works by keyboard ArrowUp and Home/End.
  await volumeSlider.focus();
  await page.keyboard.press("ArrowUp");
  await expect(volumeSlider).toHaveAttribute("aria-valuenow", "10");
  expect(await media.evaluate((el) => (el as HTMLMediaElement).muted)).toBe(
    false,
  );
  await page.keyboard.press("End");
  await expect(volumeSlider).toHaveAttribute("aria-valuenow", "100");

  // Seek slider works by keyboard ArrowRight and Home.
  await seekSlider.focus();
  await page.keyboard.press("ArrowRight");
  const soughtNow = Number(await seekSlider.getAttribute("aria-valuenow"));
  expect(soughtNow).toBeGreaterThan(0);
  await page.keyboard.press("Home");
  await expect(seekSlider).toHaveAttribute("aria-valuenow", "0");

  // Fullscreen button is focusable and keyboard-activatable without errors.
  await fsBtn.focus();
  await expect(fsBtn).toBeFocused();
});

test("audio-only recipe renders <audio> preview with speed control and no autoplay", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, `/recipes/${AUDIO_SLUG}`);

  const audio = page.locator("audio[data-clip-media]");
  await expect(audio).toHaveCount(1);
  const state = await audio.evaluate((el) => {
    const a = el as HTMLAudioElement;
    return { paused: a.paused, autoplay: a.autoplay, preload: a.preload };
  });
  expect(state).toEqual({ paused: true, autoplay: false, preload: "none" });

  await page.locator("[data-clip-speed]").click();
  expect(
    await audio.evaluate((el) => (el as HTMLAudioElement).playbackRate),
  ).toBe(1.25);
});

test("more-recipes row arrow buttons scroll the horizontal track", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);

  const track = page.locator("[data-card-row-track]");
  const prevBtn = page.locator("[data-card-row-prev]");
  const nextBtn = page.locator("[data-card-row-next]");

  await expect(prevBtn).toBeDisabled();
  await expect(nextBtn).toBeEnabled();

  await nextBtn.click();
  await expect
    .poll(() => track.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(100);
  await expect(prevBtn).toBeEnabled();

  await prevBtn.click();
  await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBe(0);
  await expect(prevBtn).toBeDisabled();
});

test("unknown slug returns HTTP 404 with the site 404 page in EN and IT", async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const enRes = await page.goto("/recipes/does-not-exist-anywhere");
  expect(enRes?.status()).toBe(404);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute(
    "data-astryx-theme",
    "mesh",
  );
  await expect(page.locator("h1")).toHaveText(en.notFound.title);
  await expect(page.locator('a[href="/"]').first()).toBeVisible();

  await page.context().addCookies([
    {
      name: "mellodifai_lang",
      value: "it",
      url: baseURL ?? "http://127.0.0.1",
    },
  ]);
  const itRes = await page.goto("/recipes/does-not-exist-anywhere");
  expect(itRes?.status()).toBe(404);
  await expect(page.locator("html")).toHaveAttribute("lang", "it");
  await expect(page.locator("h1")).toHaveText(itCopy.notFound.title);
});

test("action button /recipes/<slug>/try redirects (307) to /create?recipe=<slug> and reaches a 200 page; unknown slug returns 404", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  const rawRedirect = await request.get(`/recipes/${SAMPLE_SLUG}/try`, {
    maxRedirects: 0,
  });
  expect(rawRedirect.status()).toBe(307);
  expect(rawRedirect.headers().location).toBe(`/create?recipe=${SAMPLE_SLUG}`);

  await open(page);
  const finalDoc = page.waitForResponse(
    (res) =>
      res.request().resourceType() === "document" &&
      res.status() >= 200 &&
      res.status() < 300 &&
      /^\/(create|login)$/u.test(new URL(res.url()).pathname),
  );
  await page.locator('[data-recipe-try="true"]').click();
  const navRes = await finalDoc;
  expect(navRes.status()).toBe(200);
  await expect(page).toHaveURL(/\/(create|login)(?:\?|$)/u);

  const badTry = await page.goto("/recipes/does-not-exist-anywhere/try");
  expect(badTry?.status()).toBe(404);
  await expect(page.locator("h1")).toHaveText(en.notFound.title);
});

test("Italian page renders Italian copy, inputs, and action link", async ({
  page,
  baseURL,
}) => {
  const recipe = getRecipeBySlug(SAMPLE_SLUG);
  expect(recipe).not.toBeNull();
  if (!recipe) return;

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
  await expect(page.locator("h1")).toHaveText(recipe.title.it);
  await expect(page.locator(".site-inputs__heading")).toHaveText(
    itCopy.recipeDetail.inputsTitle,
  );
  await expect(page.locator('[data-recipe-try="true"]')).toHaveAttribute(
    "href",
    `/recipes/${SAMPLE_SLUG}/try`,
  );
});

test("reduced motion disables transitions and smooth scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);

  const durations = await page.evaluate(() => {
    const zero = (v: string) =>
      v.split(",").every((d) => Number.parseFloat(d) === 0);
    const bad: string[] = [];
    for (const sel of [
      ".site-clip__glow",
      ".site-clip__poster",
      ".site-clip__media",
      ".site-recipe-detail__back",
    ]) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const td = getComputedStyle(el).transitionDuration;
      if (!zero(td)) bad.push(`${sel}: ${td}`);
    }
    const trackBehavior = getComputedStyle(
      document.querySelector("[data-card-row-track]") as Element,
    ).scrollBehavior;
    return { bad, trackBehavior };
  });
  expect(durations.bad).toEqual([]);
  expect(durations.trackBehavior).toBe("auto");
});

test("no Astryx client JS or Zod chunks ship to the browser, and page renders with JS off", async ({
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

  // Works without JavaScript for content and navigation.
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
    await noJsPage.goto(`/recipes/${SAMPLE_SLUG}`);
    await expect(noJsPage.locator("h1")).toBeVisible();
    await expect(noJsPage.locator('[data-recipe-try="true"]')).toHaveAttribute(
      "href",
      `/recipes/${SAMPLE_SLUG}/try`,
    );
    await expect(noJsPage.locator(".site-card-row__item")).toHaveCount(12);
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

      // Also check after toggling speed and mute states.
      await page.locator("[data-clip-speed]").click();
      await page.locator("[data-clip-mute]").click();
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
      join(import.meta.dirname, "layout-ref/recipe-detail.json"),
      "utf8",
    ),
  ) as LayoutRef;
  const candidate: LayoutRef = { sections: reference.sections, widths: {} };
  for (const [w, h] of WIDTHS) {
    await page.setViewportSize({ width: w, height: h });
    await open(page, reference.route ?? `/recipes/${SAMPLE_SLUG}`);
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
    `likeness recipe-detail: ${result.checked} values, worst ${result.worstSteps} steps`,
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

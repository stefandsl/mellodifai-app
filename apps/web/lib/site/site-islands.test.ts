// @vitest-environment jsdom
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  computeVisibleCanvasCards,
  DEFAULT_ZOOM,
  MAX_CANVAS_DOM_CARDS,
  placeCanvasRecipes,
  type RecipeIndexItem,
} from "./recipe-canvas-layout";

// Prevent island modules from auto-running on import so each test mounts cleanly.
(window as unknown as Record<string, unknown>).__SITE_ISLAND_MANUAL_INIT__ =
  true;

const { initHome } = await import("./islands/home");
const { initPricing } = await import("./islands/pricing");
const { initRecipeDetail } = await import("./islands/recipe-detail");
const { initRecipes } = await import("./islands/recipes");

const WEB_DIR = resolve(import.meta.dirname, "../..");
const TMP_PARENT = join(WEB_DIR, ".tmp-site-islands-tests");

function loadBuiltDocument(html: string): void {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(html, "text/html");
  document.documentElement.className = "";
  for (const attr of [...document.documentElement.attributes]) {
    document.documentElement.removeAttribute(attr.name);
  }
  for (const attr of [...parsed.documentElement.attributes]) {
    document.documentElement.setAttribute(attr.name, attr.value);
  }
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
}

describe("public site vanilla islands on built static HTML", () => {
  let outDir = "";
  let built: { fontsUrl: string };
  let homeHtml = "";
  let pricingHtml = "";
  let recipesCanvasHtml = "";
  let recipesGridHtml = "";
  let recipesCanvas24Html = "";
  let recipeDetailVideoHtml = "";
  let recipeDetailAudioHtml = "";

  beforeAll(() => {
    mkdirSync(TMP_PARENT, { recursive: true });
    outDir = mkdtempSync(join(TMP_PARENT, "islands-"));
    execFileSync(
      process.execPath,
      [join(WEB_DIR, "scripts/build-site-static.mjs")],
      {
        cwd: WEB_DIR,
        env: { ...process.env, SITE_STATIC_OUT_DIR: outDir },
        stdio: "pipe",
      },
    );
    built = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8")) as {
      fontsUrl: string;
    };
    homeHtml = readFileSync(join(outDir, "home-en.html"), "utf8");
    pricingHtml = readFileSync(join(outDir, "pricing-en.html"), "utf8");
    recipesCanvasHtml = readFileSync(
      join(outDir, "recipes-canvas-en.html"),
      "utf8",
    );
    recipesGridHtml = readFileSync(
      join(outDir, "recipes-grid-en.html"),
      "utf8",
    );
    recipesCanvas24Html = readFileSync(
      join(outDir, "recipes-canvas-24-en.html"),
      "utf8",
    );
    recipeDetailVideoHtml = readFileSync(
      join(outDir, "recipe-acoustic-voice-swap-en.html"),
      "utf8",
    );
    recipeDetailAudioHtml = readFileSync(
      join(outDir, "recipe-group-chat-ballad-en.html"),
      "utf8",
    );
  }, 30_000);

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
    rmSync(TMP_PARENT, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("scrollTo", vi.fn());
    window.history.replaceState(null, "", "/");

    // jsdom does not implement HTMLDialogElement.showModal/close natively.
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("shell: updates header scroll state, phone dialog, agents menu, and deferred hashed fonts", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    loadBuiltDocument(homeHtml);
    initHome();

    // Header scroll attribute toggles with scrollY.
    const header = document.querySelector<HTMLElement>(".site-header");
    expect(header?.getAttribute("data-scrolled")).toBe("false");
    Object.defineProperty(window, "scrollY", { value: 40, configurable: true });
    window.dispatchEvent(new Event("scroll"));
    expect(header?.getAttribute("data-scrolled")).toBe("true");

    // Phone menu opens and closes cleanly.
    const opener =
      document.querySelector<HTMLButtonElement>(".site-menu__open");
    const dialog =
      document.querySelector<HTMLDialogElement>("dialog.site-menu");
    expect(opener).not.toBeNull();
    expect(dialog).not.toBeNull();
    opener?.click();
    expect(dialog?.open).toBe(true);
    expect(opener?.getAttribute("aria-expanded")).toBe("true");
    expect(document.documentElement.classList.contains("site-menu-open")).toBe(
      true,
    );
    dialog?.querySelector<HTMLButtonElement>(".site-menu__bar button")?.click();
    expect(dialog?.open).toBe(false);
    expect(opener?.getAttribute("aria-expanded")).toBe("false");

    // Agents menu opens on click, navigates with ArrowDown, closes on Escape.
    const agentsHost = document.querySelector<HTMLElement>(
      "[data-site-agents-menu]",
    );
    // Mobile-first CSS hides .site-nav until @media (min-width: 48em); show desktop nav in jsdom.
    agentsHost
      ?.closest<HTMLElement>(".site-nav")
      ?.style.setProperty("display", "flex");
    const trigger = agentsHost?.querySelector<HTMLButtonElement>("button");
    const menu = document.getElementById("site-agents-popover");
    expect(trigger).not.toBeNull();
    expect(menu).not.toBeNull();
    expect(menu?.hidden).toBe(true);
    trigger?.click();
    expect(menu?.hidden).toBe(false);
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    menu?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(document.activeElement?.tagName).toBe("A");
    menu?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(menu?.hidden).toBe(true);
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");

    // Deferred fonts stylesheet injects the hashed /site/styles/fonts.<hash>.css URL.
    vi.runAllTimers();
    const fontLink = document.head.querySelector<HTMLLinkElement>(
      'link[data-site-fonts="true"]',
    );
    expect(fontLink).not.toBeNull();
    expect(fontLink?.getAttribute("href")).toBe(built.fontsUrl);
    vi.useRealTimers();
  });

  it("home: swaps hero play/pause icons from icons.tsx, switches chips, handles missing sample, kinds stage, period switch, and FAQ", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    loadBuiltDocument(homeHtml);

    const audio = document.querySelector<HTMLAudioElement>(
      "audio.site-studio__audio",
    );
    expect(audio).not.toBeNull();
    if (audio) {
      audio.play = vi.fn().mockResolvedValue(undefined);
      audio.pause = vi.fn();
    }

    initHome();

    // Word chip click marks word edited with del/ins and wave take highlight.
    const chips = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".site-studio__words .site-chip",
      ),
    );
    expect(chips.length).toBeGreaterThan(1);
    chips[1].click();
    expect(chips[1].getAttribute("aria-pressed")).toBe("true");
    expect(chips[0].getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector(".site-studio__word del")).not.toBeNull();
    expect(document.querySelector("rect.site-wave__take")).not.toBeNull();

    // Play/pause click swaps in exact PlayGlyph and PauseGlyph paths from components/site/icons.tsx.
    const playBtn =
      document.querySelector<HTMLButtonElement>(".site-studio__play");
    expect(playBtn).not.toBeNull();
    playBtn?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(playBtn?.getAttribute("data-state")).toBe("playing");
    const pauseSvgHtml = playBtn?.querySelector("svg")?.innerHTML ?? "";
    expect(pauseSvgHtml).toContain("M5.5 3.5v9M10.5 3.5v9");
    expect(pauseSvgHtml).not.toContain("<rect");

    playBtn?.click();
    await Promise.resolve();
    expect(playBtn?.getAttribute("data-state")).toBe("idle");
    const playSvgHtml = playBtn?.querySelector("svg")?.innerHTML ?? "";
    expect(playSvgHtml).toContain("M5 3.5v9l7-4.5z");
    expect(playSvgHtml).not.toContain("M4.5 3 13 8l-8.5 5z");

    // Audio error transitions hero to missing state with derived disabled class and status text.
    audio?.dispatchEvent(new Event("error"));
    expect(playBtn?.disabled).toBe(true);
    expect(playBtn?.getAttribute("aria-disabled")).toBe("true");
    expect(
      document
        .querySelector(".site-dot")
        ?.classList.contains("site-dot--muted"),
    ).toBe(true);
    const statusText =
      document.querySelector('.site-studio__foot [role="status"]')
        ?.textContent ?? "";
    expect(statusText.length).toBeGreaterThan(0);

    // Kinds stage toggles cover class, title, and live caption.
    const kindBtns = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".site-kinds__name"),
    );
    expect(kindBtns.length).toBeGreaterThan(1);
    const beforeTitle =
      document.querySelector(".site-kinds__title")?.textContent;
    kindBtns[1].click();
    expect(kindBtns[1].getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".site-kinds__title")?.textContent).not.toBe(
      beforeTitle,
    );

    // Period switch responds to click and keyboard arrows.
    const radios = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '.site-segmented[role="radiogroup"] [role="radio"][data-value]',
      ),
    );
    expect(radios.length).toBe(2);
    const planUnit = document.querySelector<HTMLElement>(
      "[data-plan-unit-monthly]",
    );
    const yearlyText = planUnit?.getAttribute("data-plan-unit-yearly");
    const monthlyText = planUnit?.getAttribute("data-plan-unit-monthly");
    radios[1].click();
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
    if (planUnit && yearlyText) {
      expect(planUnit.textContent).toBe(yearlyText);
    }
    radios[1]
      .closest('[role="radiogroup"]')
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
      );
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    if (planUnit && monthlyText) {
      expect(planUnit.textContent).toBe(monthlyText);
    }

    // Home FAQ collapsible toggles aria-expanded, panel hidden class, and derived chevron classes.
    const faqBtn = document.querySelector<HTMLButtonElement>(
      ".site-faq__item .astryx-collapsible-trigger[aria-controls]",
    );
    expect(faqBtn).not.toBeNull();
    const panelId = faqBtn?.getAttribute("aria-controls") ?? "";
    const panel = document.getElementById(panelId);
    const chevron = faqBtn?.querySelector<HTMLElement>(".astryx-icon");
    const closedPanelClass = panel?.className ?? "";
    const closedChevronClass = chevron?.className ?? "";
    expect(faqBtn?.getAttribute("aria-expanded")).toBe("false");
    faqBtn?.click();
    expect(faqBtn?.getAttribute("aria-expanded")).toBe("true");
    expect(panel?.hidden).toBe(false);
    expect(panel?.className).not.toBe(closedPanelClass);
    expect(chevron?.className).not.toBe(closedChevronClass);
    faqBtn?.click();
    expect(faqBtn?.getAttribute("aria-expanded")).toBe("false");
    expect(panel?.hidden).toBe(true);
    expect(panel?.className).toBe(closedPanelClass);
    expect(chevron?.className).toBe(closedChevronClass);
    vi.useRealTimers();
  });

  it("pricing: switches billing period and toggles exclusive FAQ accordion with inert panels", () => {
    loadBuiltDocument(pricingHtml);
    initPricing();

    const radios = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '.site-segmented[role="radiogroup"] [role="radio"][data-value]',
      ),
    );
    expect(radios.length).toBe(2);
    radios[1].click();
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
    expect(
      document
        .querySelector('.site-plan-card__unit[data-period="yearly"]')
        ?.getAttribute("data-shown"),
    ).toBe("true");

    const faqItems = Array.from(
      document.querySelectorAll<HTMLElement>(".site-faq__list .site-faq__item"),
    );
    expect(faqItems.length).toBeGreaterThan(1);
    const btn0 =
      faqItems[0].querySelector<HTMLButtonElement>(".site-faq__trigger");
    const btn1 =
      faqItems[1].querySelector<HTMLButtonElement>(".site-faq__trigger");
    const panel0 = faqItems[0].querySelector<HTMLElement>(".site-faq__panel");
    const panel1 = faqItems[1].querySelector<HTMLElement>(".site-faq__panel");

    // First item starts open on SSR; clicking second opens it and closes the first.
    expect(faqItems[0].getAttribute("data-open")).toBe("true");
    expect(panel0?.hasAttribute("inert")).toBe(false);

    btn1?.click();
    expect(faqItems[0].getAttribute("data-open")).toBe("false");
    expect(panel0?.hasAttribute("inert")).toBe(true);
    expect(faqItems[1].getAttribute("data-open")).toBe("true");
    expect(btn1?.getAttribute("aria-expanded")).toBe("true");
    expect(panel1?.hasAttribute("inert")).toBe(false);

    btn0?.click();
    expect(faqItems[0].getAttribute("data-open")).toBe("true");
    expect(btn0?.getAttribute("aria-expanded")).toBe("true");
    expect(panel0?.hasAttribute("inert")).toBe(false);
    expect(faqItems[1].getAttribute("data-open")).toBe("false");
    expect(panel1?.hasAttribute("inert")).toBe(true);
  });

  it("recipes: preserves early search input, keeps zoom button inner structure, maintains canvas DOM order, and switches views", async () => {
    loadBuiltDocument(recipesCanvas24Html);
    Object.defineProperty(window, "innerWidth", {
      value: 1440,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 900,
      configurable: true,
    });

    // Simulate a visitor typing into the search box BEFORE the deferred island mounts.
    const searchInput = document.querySelector<HTMLInputElement>(
      '.site-recipes-search input[type="search"]',
    );
    expect(searchInput).not.toBeNull();
    if (searchInput) searchInput.value = "zzznomatch999";

    initRecipes();

    // Early search input must be preserved and immediately applied (empty state shown).
    expect(searchInput?.value).toBe("zzznomatch999");
    const emptyEl = document.querySelector('[data-recipes-empty="true"]');
    expect(emptyEl).not.toBeNull();

    // Reset button clears the search and restores cards.
    emptyEl?.querySelector<HTMLButtonElement>("button")?.click();
    expect(searchInput?.value).toBe("");
    expect(document.querySelector('[data-recipes-empty="true"]')).toBeNull();

    // Zoom reset button preserves its Astryx inner span > span and role="status" structure.
    const zoomButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[data-recipes-zoom="true"] button',
      ),
    );
    const resetBtn = zoomButtons[1];
    const plusBtn = zoomButtons[2];
    expect(resetBtn?.querySelector("span > span")?.textContent).toBe("100%");
    expect(resetBtn?.querySelector('[role="status"]')).not.toBeNull();

    plusBtn?.click();
    expect(resetBtn?.querySelector("span > span")?.textContent).toBe("125%");
    expect(resetBtn?.querySelector('[role="status"]')).not.toBeNull();

    // `/` focuses search; Ctrl+F is never prevented.
    searchInput?.blur();
    const slashEvent = new KeyboardEvent("keydown", {
      key: "/",
      cancelable: true,
      bubbles: true,
    });
    window.dispatchEvent(slashEvent);
    expect(slashEvent.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(searchInput);

    searchInput?.blur();
    const ctrlF = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    });
    window.dispatchEvent(ctrlF);
    expect(ctrlF.defaultPrevented).toBe(false);

    // Panning the canvas keeps DOM/tab order matching computeVisibleCanvasCards placement order.
    const stage = document.querySelector<HTMLElement>(
      '[data-recipes-canvas-stage="true"]',
    );
    expect(stage).not.toBeNull();
    // Reset zoom to 100%, then pan right several times so new cards enter at the front/middle.
    resetBtn?.click();
    for (let i = 0; i < 6; i++) {
      stage?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    }
    const payload = JSON.parse(
      document.getElementById("site-recipes-data")?.textContent ?? "{}",
    ) as { recipes: RecipeIndexItem[] };
    const placements = placeCanvasRecipes(payload.recipes, {
      viewportWidth: 1440,
      viewportHeight: 900,
      matchIds: null,
    });
    const expectedVisible = computeVisibleCanvasCards({
      placements,
      viewportWidth: 1440,
      viewportHeight: 900,
      panX: -6 * 120,
      panY: 0,
      zoom: DEFAULT_ZOOM,
      matchIds: null,
      maxCards: MAX_CANVAS_DOM_CARDS,
    });
    const actualSlugs = Array.from(
      stage?.querySelectorAll<HTMLElement>('[data-recipe-card="canvas"]') ?? [],
    ).map((el) => el.getAttribute("data-recipe-slug"));
    const expectedSlugs = expectedVisible.map((c) => c.recipe.slug);
    expect(actualSlugs).toEqual(expectedSlugs);

    // View switch fetches grid HTML, replaces root, and updates aria-current + URL.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => recipesGridHtml,
      }),
    );
    const switchLinks = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        '[data-recipes-switch="true"] .site-recipes-switch__item',
      ),
    );
    switchLinks[1].click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector('[data-recipes-view="grid"]')).not.toBeNull();
    expect(switchLinks[1].getAttribute("aria-current")).toBe("page");
    expect(switchLinks[0].hasAttribute("aria-current")).toBe(false);
    expect(window.location.search).toContain("view=grid");

    // Verify regular canvas build also mounts cleanly.
    loadBuiltDocument(recipesCanvasHtml);
    initRecipes();
    expect(
      document
        .querySelector('[data-recipes-canvas-stage="true"]')
        ?.getAttribute("data-ready"),
    ).toBe("true");
  });

  it("recipe-detail: no autoplay before click, controls play/pause, speed playbackRate, seek, mute/volume, fullscreen, keyboard, and card row arrows", async () => {
    loadBuiltDocument(recipeDetailVideoHtml);

    const shell = document.querySelector<HTMLElement>("[data-clip-player]");
    const media = document.querySelector<HTMLVideoElement>("[data-clip-media]");
    expect(shell).not.toBeNull();
    expect(media).not.toBeNull();
    if (!shell || !media) return;

    // Never autoplays, preloads nothing before a click, and omits fake caption tracks when recipes have no timed cues.
    expect(media.autoplay).toBe(false);
    expect(media.preload).toBe("none");
    expect(media.paused).toBe(true);
    expect(media.querySelector("track")).toBeNull();
    expect(recipeDetailVideoHtml).not.toContain("data:text/vtt");

    let isPaused = true;
    let currentTimeVal = 0;
    Object.defineProperty(media, "paused", {
      get: () => isPaused,
      configurable: true,
    });
    Object.defineProperty(media, "duration", {
      get: () => 20,
      configurable: true,
    });
    Object.defineProperty(media, "currentTime", {
      get: () => currentTimeVal,
      set: (v: number) => {
        currentTimeVal = v;
      },
      configurable: true,
    });
    const playSpy = vi.fn().mockImplementation(async () => {
      isPaused = false;
      media.dispatchEvent(new Event("play"));
    });
    const pauseSpy = vi.fn().mockImplementation(() => {
      isPaused = true;
      media.dispatchEvent(new Event("pause"));
    });
    media.play = playSpy;
    media.pause = pauseSpy;

    let fsEl: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", {
      get: () => fsEl,
      configurable: true,
    });
    const reqFs = vi.fn().mockImplementation(async () => {
      fsEl = shell;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    const exitFs = vi.fn().mockImplementation(async () => {
      fsEl = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    shell.requestFullscreen = reqFs;
    document.exitFullscreen = exitFs;

    initRecipeDetail();

    // No play called on mount.
    expect(playSpy).not.toHaveBeenCalled();
    expect(shell.getAttribute("data-playing")).toBe("false");

    // Play / pause swaps icons from icons.tsx and updates aria-label.
    const playBtn = shell.querySelector<HTMLButtonElement>("[data-clip-play]");
    expect(playBtn?.getAttribute("aria-label")).toBe("Play clip");
    playBtn?.click();
    await Promise.resolve();
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(shell.getAttribute("data-playing")).toBe("true");
    expect(shell.getAttribute("data-video-active")).toBe("true");
    expect(playBtn?.getAttribute("aria-label")).toBe("Pause clip");
    expect(playBtn?.querySelector("svg")?.innerHTML).toContain(
      "M5.5 3.5v9M10.5 3.5v9",
    );

    playBtn?.click();
    await Promise.resolve();
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(shell.getAttribute("data-playing")).toBe("false");
    expect(playBtn?.getAttribute("aria-label")).toBe("Play clip");
    expect(playBtn?.querySelector("svg")?.innerHTML).toContain(
      "M5 3.5v9l7-4.5z",
    );

    // Speed button changes playbackRate, preserves Astryx span > span, and handles arrow keys.
    const speedBtn =
      shell.querySelector<HTMLButtonElement>("[data-clip-speed]");
    expect(media.playbackRate).toBe(1);
    expect(speedBtn?.querySelector("span > span")?.textContent).toBe("1x");
    speedBtn?.click();
    expect(media.playbackRate).toBe(1.25);
    expect(shell.getAttribute("data-speed")).toBe("1.25");
    expect(speedBtn?.querySelector("span > span")?.textContent).toBe("1.25x");
    expect(speedBtn?.getAttribute("aria-label")).toBe("Preview speed: 1.25x");
    speedBtn?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(media.playbackRate).toBe(1);

    // Seek slider keyboard arrows, End, Home.
    const seek = shell.querySelector<HTMLElement>("[data-clip-seek]");
    seek?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(currentTimeVal).toBe(5);
    expect(seek?.getAttribute("aria-valuenow")).toBe("5");
    seek?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true }),
    );
    expect(currentTimeVal).toBe(20);
    seek?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );
    expect(currentTimeVal).toBe(0);

    // Mute toggle and volume slider keyboard controls.
    const muteBtn = shell.querySelector<HTMLButtonElement>("[data-clip-mute]");
    const vol = shell.querySelector<HTMLElement>("[data-clip-volume]");
    expect(muteBtn?.getAttribute("aria-pressed")).toBe("false");
    muteBtn?.click();
    expect(media.muted).toBe(true);
    expect(muteBtn?.getAttribute("aria-pressed")).toBe("true");
    expect(muteBtn?.getAttribute("aria-label")).toBe("Unmute audio");
    expect(vol?.getAttribute("aria-valuenow")).toBe("0");

    vol?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(media.muted).toBe(false);
    expect(media.volume).toBeCloseTo(0.1, 2);
    expect(vol?.getAttribute("aria-valuenow")).toBe("10");

    // Fullscreen button toggles fullscreen and icon.
    const fsBtn = shell.querySelector<HTMLButtonElement>(
      "[data-clip-fullscreen]",
    );
    fsBtn?.click();
    await Promise.resolve();
    expect(reqFs).toHaveBeenCalledTimes(1);
    expect(shell.getAttribute("data-fullscreen")).toBe("true");
    expect(fsBtn?.getAttribute("aria-label")).toBe("Exit full screen");
    fsBtn?.click();
    await Promise.resolve();
    expect(exitFs).toHaveBeenCalledTimes(1);
    expect(shell.getAttribute("data-fullscreen")).toBe("false");

    // Keyboard shortcuts m and k inside the player shell.
    shell.dispatchEvent(
      new KeyboardEvent("keydown", { key: "m", bubbles: true }),
    );
    expect(media.muted).toBe(true);
    shell.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", bubbles: true }),
    );
    await Promise.resolve();
    expect(playSpy).toHaveBeenCalledTimes(2);

    // More-recipes horizontal row arrows scroll with reduced-motion behavior: "auto".
    const track = document.querySelector<HTMLElement>("[data-card-row-track]");
    const prevBtn = document.querySelector<HTMLButtonElement>(
      "[data-card-row-prev]",
    );
    const nextBtn = document.querySelector<HTMLButtonElement>(
      "[data-card-row-next]",
    );
    expect(track).not.toBeNull();
    expect(prevBtn?.disabled).toBe(true);
    if (track) {
      Object.defineProperty(track, "scrollWidth", {
        value: 4800,
        configurable: true,
      });
      Object.defineProperty(track, "clientWidth", {
        value: 980,
        configurable: true,
      });
      const scrollBySpy = vi
        .fn()
        .mockImplementation((opts: { left?: number }) => {
          track.scrollLeft += opts.left ?? 0;
        });
      track.scrollBy = scrollBySpy;
      nextBtn?.click();
      expect(scrollBySpy).toHaveBeenCalledWith({
        left: 403,
        behavior: "auto",
      });
      expect(prevBtn?.disabled).toBe(false);
    }

    // Audio-only recipe detail page mounts cleanly too.
    loadBuiltDocument(recipeDetailAudioHtml);
    initRecipeDetail();
    const audioEl =
      document.querySelector<HTMLAudioElement>("[data-clip-media]");
    expect(audioEl?.tagName).toBe("AUDIO");
    expect(audioEl?.autoplay).toBe(false);
    expect(audioEl?.preload).toBe("none");
  });
});

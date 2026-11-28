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

const {
  COMPOSER_DRAFT_KEY,
  COMPOSER_PROMPT_MAX_LENGTH,
  FEATURE_REEL_MS,
  HERO_ROTATE_MS,
  initHome,
  MARQUEE_FOCUS_INSET_PX,
  MARQUEE_SPEED_PX_PER_SEC,
} = await import("./islands/home");
const { initDesktop, initDesktopPlatform } = await import("./islands/desktop");
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
  let desktopHtml = "";
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
    desktopHtml = readFileSync(join(outDir, "desktop-en.html"), "utf8");
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

  it("home: chips fill and focus composer, submit routes to login without POST, and kinds/period/FAQ work", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const navigated: string[] = [];
    loadBuiltDocument(homeHtml);

    const stopHome = initHome({ navigate: (url) => navigated.push(url) });
    try {
      // Fixed screen-reader heading text stays present and separate from visual rotator.
      const srTitle = document.querySelector("#hero-title .site-sr-only");
      const rotator = document.querySelector<HTMLElement>(
        '[data-hero-rotator="true"]',
      );
      expect(srTitle?.textContent?.trim()).toBe("Change a word. Hear it sung.");
      expect(rotator?.getAttribute("aria-hidden")).toBe("true");
      // Reduced motion default in beforeEach: no loop runs.
      expect(rotator?.getAttribute("data-rotator-running")).toBe("false");
      vi.advanceTimersByTime(HERO_ROTATE_MS * 2);
      expect(rotator?.getAttribute("data-rotator-index")).toBe("0");

      // Chip click fills composer, marks chip pressed, and focuses the textarea.
      const chips = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          ".site-composer__chips .site-chip[data-chip-prompt]",
        ),
      );
      const textarea = document.querySelector<HTMLTextAreaElement>(
        "textarea#hero-composer-input",
      );
      const form = document.querySelector<HTMLFormElement>(
        'form[data-hero-composer="true"]',
      );
      expect(chips.length).toBe(6);
      expect(textarea).not.toBeNull();
      expect(textarea?.maxLength).toBe(COMPOSER_PROMPT_MAX_LENGTH);
      expect(textarea?.getAttribute("name")).toBeNull();
      expect(form).not.toBeNull();

      const expectedPrompt = chips[1].getAttribute("data-chip-prompt") ?? "";
      expect(expectedPrompt.length).toBeGreaterThan(10);
      chips[1].click();
      expect(textarea?.value).toBe(expectedPrompt);
      expect(document.activeElement).toBe(textarea);
      expect(chips[1].getAttribute("aria-pressed")).toBe("true");
      expect(chips[0].getAttribute("aria-pressed")).toBe("false");

      // Multi-line text over 500 chars is clamped and saved to localStorage, never placed in the URL.
      const multiLine = `${expectedPrompt}\nSecond verse line ${"z".repeat(COMPOSER_PROMPT_MAX_LENGTH)}`;
      if (textarea) textarea.value = multiLine;
      window.localStorage.clear();
      window.sessionStorage.clear();
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      expect(navigated).toHaveLength(1);
      const dest = new URL(navigated[0], "http://127.0.0.1");
      expect(dest.pathname).toBe("/login");
      expect(dest.searchParams.get("prompt")).toBeNull();
      expect(dest.searchParams.get("next")).toBe("/create?draft=1");
      expect(navigated[0]).not.toContain("Second verse");
      const savedRaw = window.localStorage.getItem(COMPOSER_DRAFT_KEY);
      expect(savedRaw).not.toBeNull();
      const savedDraft = JSON.parse(savedRaw as string) as {
        text: string;
        savedAt: number;
      };
      expect(savedDraft.text).toBe(
        multiLine.slice(0, COMPOSER_PROMPT_MAX_LENGTH),
      );
      expect(typeof savedDraft.savedAt).toBe("number");
      expect(savedDraft.text.includes("\n")).toBe(true);
      expect(window.sessionStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();

      // Kinds stage toggles cover class, title, and live caption.
      const kindBtns = Array.from(
        document.querySelectorAll<HTMLButtonElement>(".site-kinds__name"),
      );
      expect(kindBtns.length).toBeGreaterThan(1);
      const beforeTitle =
        document.querySelector(".site-kinds__title")?.textContent;
      kindBtns[1].click();
      expect(kindBtns[1].getAttribute("aria-pressed")).toBe("true");
      expect(
        document.querySelector(".site-kinds__title")?.textContent,
      ).not.toBe(beforeTitle);

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
    } finally {
      stopHome();
      vi.useRealTimers();
    }
  });

  it("home islands (motion enabled): rotates title every 6.0 s, moves marquee at 32 px/s with hover/focus pause, and steps feature reels every 5.0 s with hover pause", () => {
    vi.useFakeTimers();
    // Enable motion (reduced-motion: false) and drive requestAnimationFrame manually.
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const rafQueue = new Map<number, FrameRequestCallback>();
    let nextRafId = 1;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafQueue.set(id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafQueue.delete(id);
    });
    const stepRaf = (ts: number) => {
      const batch = [...rafQueue.entries()];
      rafQueue.clear();
      for (const [, cb] of batch) cb(ts);
    };

    loadBuiltDocument(homeHtml);
    const stopHome = initHome();
    try {
      // 1. Rotating hero line advances at 6000 ms while sr-only text stays fixed.
      const rotator = document.querySelector<HTMLElement>(
        '[data-hero-rotator="true"]',
      );
      const srTitle = document.querySelector("#hero-title .site-sr-only");
      expect(rotator?.getAttribute("data-rotator-running")).toBe("true");
      expect(rotator?.getAttribute("data-rotator-index")).toBe("0");

      vi.advanceTimersByTime(HERO_ROTATE_MS - 100);
      expect(rotator?.getAttribute("data-rotator-index")).toBe("0");
      vi.advanceTimersByTime(100);
      expect(rotator?.getAttribute("data-rotator-index")).toBe("1");
      expect(srTitle?.textContent?.trim()).toBe("Change a word. Hear it sung.");

      // 2. Showcase marquee moves at 32 px/s and pauses on hover and on focus inside.
      const row0 = document.querySelector<HTMLElement>(
        '[data-marquee-row="0"]',
      );
      const track0 = row0?.querySelector<HTMLElement>(
        '[data-marquee-track="true"]',
      );
      const row1 = document.querySelector<HTMLElement>(
        '[data-marquee-row="1"]',
      );
      const track1 = row1?.querySelector<HTMLElement>(
        '[data-marquee-track="true"]',
      );
      expect(row0).not.toBeNull();
      expect(row1).not.toBeNull();

      stepRaf(0);
      const parseX = (t: string) =>
        Number(t.match(/translate3d\(([-\d.]+)px/u)?.[1] ?? "NaN");
      const x0Start = parseX(track0?.style.transform ?? "");
      const x1Start = parseX(track1?.style.transform ?? "");

      stepRaf(1000);
      const x0After1s = parseX(track0?.style.transform ?? "");
      const x1After1s = parseX(track1?.style.transform ?? "");
      expect(x0Start - x0After1s).toBeCloseTo(MARQUEE_SPEED_PX_PER_SEC, 1);
      expect(x1After1s - x1Start).toBeCloseTo(MARQUEE_SPEED_PX_PER_SEC, 1);

      // Hover stops row 0 immediately.
      row0?.dispatchEvent(new Event("mouseenter"));
      expect(row0?.getAttribute("data-marquee-paused")).toBe("true");
      stepRaf(2000);
      expect(parseX(track0?.style.transform ?? "")).toBeCloseTo(x0After1s, 2);

      // Leave resumes row 0.
      row0?.dispatchEvent(new Event("mouseleave"));
      expect(row0?.getAttribute("data-marquee-paused")).toBe("false");
      stepRaf(2500);
      stepRaf(3500);
      expect(x0After1s - parseX(track0?.style.transform ?? "")).toBeCloseTo(
        MARQUEE_SPEED_PX_PER_SEC,
        1,
      );

      // Focus inside stops row 1 immediately, brings off-screen card into viewport without scrollLeft, and blur resumes it.
      const copy0Row1 = row1?.querySelector<HTMLElement>(
        '[data-marquee-copy="0"]',
      );
      const cardsRow1 = Array.from(
        row1?.querySelectorAll<HTMLElement>(
          '[data-marquee-copy="0"] .site-show__card',
        ) ?? [],
      );
      const linkInRow1 = cardsRow1[0]?.querySelector<HTMLAnchorElement>("a");
      expect(linkInRow1).not.toBeNull();
      expect(copy0Row1).not.toBeNull();

      // Mock real 1440px-like geometry on row 1 where card 0 starts off screen at x = -1200.
      const rect = (left: number, width: number): DOMRect =>
        ({
          left,
          right: left + width,
          width,
          top: 0,
          bottom: 200,
          height: 200,
          x: left,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;
      if (row1 && copy0Row1 && cardsRow1[0] && cardsRow1[5]) {
        row1.getBoundingClientRect = () => rect(0, 1000);
        copy0Row1.getBoundingClientRect = () => rect(-1200, 1200);
        cardsRow1[0].getBoundingClientRect = () => rect(-1200, 180);
        cardsRow1[5].getBoundingClientRect = () => rect(-200, 180);
        row1.scrollLeft = 420;
      }

      const link5Row1 = cardsRow1[5]?.querySelector<HTMLAnchorElement>("a");
      expect(link5Row1).not.toBeNull();

      // Mouse focus (:focus-visible = false) pauses row 1 without jumping its transform.
      const x1BeforeMouseFocus = parseX(track1?.style.transform ?? "");
      if (linkInRow1) {
        linkInRow1.matches = () => false;
      }
      linkInRow1?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      expect(row1?.getAttribute("data-marquee-paused")).toBe("true");
      expect(parseX(track1?.style.transform ?? "")).toBeCloseTo(
        x1BeforeMouseFocus,
        2,
      );
      row1?.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
      );

      // Keyboard focus (:focus-visible = true) on card 0 shifts track to x = +8 px inset so outline shows, and resets scrollLeft = 0.
      if (row1) row1.scrollLeft = 420;
      if (linkInRow1) {
        linkInRow1.matches = (sel: string) => sel === ":focus-visible";
      }
      linkInRow1?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      expect(row1?.getAttribute("data-marquee-paused")).toBe("true");
      expect(row1?.scrollLeft).toBe(0);
      const x1OnFocus0 = parseX(track1?.style.transform ?? "");
      expect(x1OnFocus0).toBeCloseTo(MARQUEE_FOCUS_INSET_PX, 1);
      stepRaf(4500);
      expect(parseX(track1?.style.transform ?? "")).toBeCloseTo(x1OnFocus0, 2);

      // Keyboard focus on card 5 (left 1000..1180) shifts track to x = 1000 - 8 - 1180 = -188 so right outline has 8 px clearance.
      if (link5Row1) {
        link5Row1.matches = (sel: string) => sel === ":focus-visible";
      }
      link5Row1?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      expect(parseX(track1?.style.transform ?? "")).toBeCloseTo(
        -180 - MARQUEE_FOCUS_INSET_PX,
        1,
      );
      expect(row1?.scrollLeft).toBe(0);

      row1?.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
      );
      expect(row1?.getAttribute("data-marquee-paused")).toBe("false");

      // 3. Feature reels step every 5000 ms, pause on hover, and support manual bullet/dot clicks.
      const reel0 = document.querySelector<HTMLElement>(
        '[data-feature-reel="0"]',
      );
      const reelTrack0 = reel0?.querySelector<HTMLElement>(
        '[data-reel-track="true"]',
      );
      expect(reel0).not.toBeNull();
      // Already advanced 6000 ms above -> reel 0 stepped once at 5000 ms (now at step 1).
      expect(reel0?.getAttribute("data-reel-step")).toBe("1");
      expect(reelTrack0?.style.transform).toContain("-33.33");

      // Next step at +4000 ms (total 10000 ms).
      vi.advanceTimersByTime(4000);
      expect(reel0?.getAttribute("data-reel-step")).toBe("2");

      // Hover pauses reel 0 even across multiple intervals.
      reel0?.dispatchEvent(new Event("mouseenter"));
      expect(reel0?.getAttribute("data-reel-paused")).toBe("true");
      vi.advanceTimersByTime(FEATURE_REEL_MS * 2);
      expect(reel0?.getAttribute("data-reel-step")).toBe("2");

      // Leave resumes stepping after 5000 ms.
      reel0?.dispatchEvent(new Event("mouseleave"));
      expect(reel0?.getAttribute("data-reel-paused")).toBe("false");
      vi.advanceTimersByTime(FEATURE_REEL_MS);
      expect(reel0?.getAttribute("data-reel-step")).toBe("0");

      // Manual dot click selects step 2 immediately.
      const dot2 = reel0?.querySelector<HTMLButtonElement>(
        '[data-reel-dot="2"]',
      );
      dot2?.click();
      expect(reel0?.getAttribute("data-reel-step")).toBe("2");
      expect(dot2?.getAttribute("aria-pressed")).toBe("true");
    } finally {
      stopHome();
      vi.useRealTimers();
    }
  });

  it("home marquee: caches row width without per-frame layout reads and omits grab cursor", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const rafQueue = new Map<number, FrameRequestCallback>();
    let nextRafId = 1;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafQueue.set(id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafQueue.delete(id);
    });
    const stepRaf = (ts: number) => {
      const batch = [...rafQueue.entries()];
      rafQueue.clear();
      for (const [, cb] of batch) cb(ts);
    };

    loadBuiltDocument(homeHtml);
    const stopHome = initHome();
    try {
      const copy0Row0 = document.querySelector<HTMLElement>(
        '[data-marquee-row="0"] [data-marquee-copy="0"]',
      );
      expect(copy0Row0).not.toBeNull();
      const rectSpy = vi.spyOn(
        copy0Row0 as HTMLElement,
        "getBoundingClientRect",
      );
      stepRaf(0);
      stepRaf(16);
      stepRaf(32);
      stepRaf(48);
      expect(rectSpy).not.toHaveBeenCalled();

      const styleText = document.head.querySelector("style")?.textContent ?? "";
      expect(styleText).not.toContain("cursor:grab");
      expect(styleText).not.toContain("cursor: grab");
    } finally {
      stopHome();
    }
  });

  it("home islands: hidden tab pauses rotator, showcase marquee, and feature reels, and resumes when visible", () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const rafQueue = new Map<number, FrameRequestCallback>();
    let nextRafId = 1;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafQueue.set(id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafQueue.delete(id);
    });
    const stepRaf = (ts: number) => {
      const batch = [...rafQueue.entries()];
      rafQueue.clear();
      for (const [, cb] of batch) cb(ts);
    };
    const setHidden = (hidden: boolean) => {
      Object.defineProperty(document, "hidden", {
        value: hidden,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    };

    loadBuiltDocument(homeHtml);
    setHidden(false);
    const stopHome = initHome();
    try {
      const rotator = document.querySelector<HTMLElement>(
        '[data-hero-rotator="true"]',
      );
      const row0 = document.querySelector<HTMLElement>(
        '[data-marquee-row="0"]',
      );
      const track0 = row0?.querySelector<HTMLElement>(
        '[data-marquee-track="true"]',
      );
      const reel0 = document.querySelector<HTMLElement>(
        '[data-feature-reel="0"]',
      );
      stepRaf(0);
      stepRaf(500);
      const xBeforeHide = track0?.style.transform ?? "";
      const rotBeforeHide = rotator?.getAttribute("data-rotator-index");
      const reelBeforeHide = reel0?.getAttribute("data-reel-step");

      // Hide tab: all three pause and stay frozen across long intervals and frames.
      setHidden(true);
      expect(rotator?.getAttribute("data-rotator-running")).toBe("false");
      expect(row0?.getAttribute("data-marquee-paused")).toBe("true");
      expect(reel0?.getAttribute("data-reel-paused")).toBe("true");

      vi.advanceTimersByTime(HERO_ROTATE_MS * 2 + FEATURE_REEL_MS * 2);
      stepRaf(2500);
      stepRaf(4500);
      expect(rotator?.getAttribute("data-rotator-index")).toBe(rotBeforeHide);
      expect(reel0?.getAttribute("data-reel-step")).toBe(reelBeforeHide);
      expect(track0?.style.transform).toBe(xBeforeHide);

      // Show tab again: all three resume cleanly.
      setHidden(false);
      expect(rotator?.getAttribute("data-rotator-running")).toBe("true");
      expect(row0?.getAttribute("data-marquee-paused")).toBe("false");
      expect(reel0?.getAttribute("data-reel-paused")).toBe("false");

      vi.advanceTimersByTime(HERO_ROTATE_MS);
      stepRaf(5000);
      stepRaf(6000);
      expect(rotator?.getAttribute("data-rotator-index")).not.toBe(
        rotBeforeHide,
      );
      expect(reel0?.getAttribute("data-reel-step")).not.toBe(reelBeforeHide);
      expect(track0?.style.transform).not.toBe(xBeforeHide);
    } finally {
      setHidden(false);
      stopHome();
      vi.useRealTimers();
    }
  });

  it("feature reels: step bullets expose only aria-pressed and only inactive slides are aria-hidden", () => {
    loadBuiltDocument(homeHtml);
    const stopHome = initHome();
    try {
      const reel0 = document.querySelector<HTMLElement>(
        '[data-feature-reel="0"]',
      );
      const bullets = Array.from(
        reel0?.querySelectorAll<HTMLButtonElement>("[data-reel-bullet]") ?? [],
      );
      const slides = Array.from(
        reel0?.querySelectorAll<HTMLElement>(".site-feature__slide") ?? [],
      );
      expect(bullets.length).toBe(3);
      expect(slides.length).toBe(3);

      // Initial state: step 0 pressed, no aria-current on any bullet, only inactive slides aria-hidden.
      expect(bullets[0].getAttribute("aria-pressed")).toBe("true");
      expect(bullets[1].getAttribute("aria-pressed")).toBe("false");
      for (const b of bullets) {
        expect(b.hasAttribute("aria-current")).toBe(false);
      }
      expect(slides[0].hasAttribute("aria-hidden")).toBe(false);
      expect(slides[1].getAttribute("aria-hidden")).toBe("true");
      expect(slides[2].getAttribute("aria-hidden")).toBe("true");

      // Selecting bullet 1 updates aria-pressed (without aria-current) and flips slide aria-hidden.
      bullets[1].click();
      expect(bullets[0].getAttribute("aria-pressed")).toBe("false");
      expect(bullets[1].getAttribute("aria-pressed")).toBe("true");
      for (const b of bullets) {
        expect(b.hasAttribute("aria-current")).toBe(false);
      }
      expect(slides[0].getAttribute("aria-hidden")).toBe("true");
      expect(slides[1].hasAttribute("aria-hidden")).toBe(false);
      expect(slides[2].getAttribute("aria-hidden")).toBe("true");
    } finally {
      stopHome();
    }
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

    // Never autoplays, keeps src deferred until play so WebKit does not preload on parse,
    // and omits fake caption tracks when recipes have no timed cues.
    expect(media.autoplay).toBe(false);
    expect(media.preload).toBe("none");
    expect(media.paused).toBe(true);
    expect(media.getAttribute("src")).toBeNull();
    expect(media.getAttribute("data-clip-src")).toBe(
      "/site/recipes/acoustic-voice-swap/example.mp4",
    );
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
    expect(media.getAttribute("src")).toBe(
      "/site/recipes/acoustic-voice-swap/example.mp4",
    );
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

    // Mute toggle keeps a fixed accessible name while toggling aria-pressed and media.muted.
    const muteBtn = shell.querySelector<HTMLButtonElement>("[data-clip-mute]");
    const vol = shell.querySelector<HTMLElement>("[data-clip-volume]");
    expect(muteBtn?.getAttribute("aria-pressed")).toBe("false");
    expect(muteBtn?.getAttribute("aria-label")).toBe("Mute audio");
    muteBtn?.click();
    expect(media.muted).toBe(true);
    expect(muteBtn?.getAttribute("aria-pressed")).toBe("true");
    expect(muteBtn?.getAttribute("aria-label")).toBe("Mute audio");
    expect(vol?.getAttribute("aria-valuenow")).toBe("0");

    vol?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(media.muted).toBe(false);
    expect(muteBtn?.getAttribute("aria-pressed")).toBe("false");
    expect(muteBtn?.getAttribute("aria-label")).toBe("Mute audio");
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

    // Keyboard shortcuts m, k, and f inside the player shell.
    shell.dispatchEvent(
      new KeyboardEvent("keydown", { key: "m", bubbles: true }),
    );
    expect(media.muted).toBe(true);
    shell.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", bubbles: true }),
    );
    await Promise.resolve();
    expect(playSpy).toHaveBeenCalledTimes(2);
    shell.dispatchEvent(
      new KeyboardEvent("keydown", { key: "f", bubbles: true }),
    );
    await Promise.resolve();
    expect(reqFs).toHaveBeenCalledTimes(2);

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

  it("desktop: detects Windows, macOS, and Linux, updates header and page CTAs, highlights current row, and toggles exclusive FAQ", () => {
    loadBuiltDocument(desktopHtml);

    // Header action is the desktop download CTA.
    const headerCta = document.querySelector<HTMLAnchorElement>(
      '.site-header__cta[data-desktop-download-cta="true"]',
    );
    expect(headerCta).not.toBeNull();

    // macOS: planned, points to #platforms (no dead link), highlights macOS row only.
    const stopMac = initDesktop({
      navigator: { userAgentData: { platform: "macOS" } },
    });
    try {
      const ctas = Array.from(
        document.querySelectorAll<HTMLAnchorElement>(
          'a[data-desktop-download-cta="true"]',
        ),
      );
      expect(ctas.length).toBeGreaterThanOrEqual(4);
      for (const cta of ctas) {
        expect(cta.getAttribute("href")).toBe("#platforms");
        expect(cta.getAttribute("data-detected-platform")).toBe("macos");
        expect(cta.getAttribute("data-platform-status")).toBe("planned");
        expect(cta.textContent?.toLowerCase()).toContain("macos");
        expect(cta.textContent?.toLowerCase()).toContain("planned");
      }
      expect(
        document
          .querySelector('[data-platform-row="macos"]')
          ?.getAttribute("data-current-platform"),
      ).toBe("true");
      expect(
        document
          .querySelector('[data-platform-row="windows"]')
          ?.getAttribute("data-current-platform"),
      ).toBe("false");
      expect(
        document.querySelector<HTMLElement>(
          '[data-platform-current-badge="macos"]',
        )?.hidden,
      ).toBe(false);
      expect(
        document.querySelector<HTMLElement>(
          '[data-platform-current-badge="windows"]',
        )?.hidden,
      ).toBe(true);

      // Linux: planned, points to #platforms, highlights Linux row only.
      expect(
        initDesktopPlatform({ platform: "Linux x86_64", userAgent: "" }),
      ).toBe("linux");
      expect(headerCta?.getAttribute("href")).toBe("#platforms");
      expect(headerCta?.getAttribute("data-detected-platform")).toBe("linux");
      expect(headerCta?.textContent?.toLowerCase()).toContain("linux");
      expect(
        document
          .querySelector('[data-platform-row="linux"]')
          ?.getAttribute("data-current-platform"),
      ).toBe("true");

      // Windows: real repo installer guide link, highlights Windows row.
      expect(initDesktopPlatform({ platform: "Win32" })).toBe("windows");
      expect(headerCta?.getAttribute("href")).toBe(
        "https://github.com/stefandsl/mellodifai-app/blob/main/docs/windows-app.md",
      );
      expect(headerCta?.getAttribute("rel")).toBe("noopener noreferrer");
      expect(headerCta?.getAttribute("data-detected-platform")).toBe("windows");
      expect(headerCta?.getAttribute("data-platform-status")).toBe("source");
      expect(
        document
          .querySelector('[data-platform-row="windows"]')
          ?.getAttribute("data-current-platform"),
      ).toBe("true");

      // Exclusive FAQ accordion: 10 questions, opening item 2 closes item 1 and sets inert.
      const faqItems = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".site-faq__list .site-faq__item",
        ),
      );
      expect(faqItems.length).toBe(10);
      const btn0 =
        faqItems[0].querySelector<HTMLButtonElement>(".site-faq__trigger");
      const btn1 =
        faqItems[1].querySelector<HTMLButtonElement>(".site-faq__trigger");
      const panel0 = faqItems[0].querySelector<HTMLElement>(".site-faq__panel");
      const panel1 = faqItems[1].querySelector<HTMLElement>(".site-faq__panel");
      expect(faqItems[0].getAttribute("data-open")).toBe("true");
      expect(panel0?.hasAttribute("inert")).toBe(false);
      btn1?.click();
      expect(faqItems[0].getAttribute("data-open")).toBe("false");
      expect(panel0?.hasAttribute("inert")).toBe(true);
      expect(faqItems[1].getAttribute("data-open")).toBe("true");
      expect(panel1?.hasAttribute("inert")).toBe(false);
      btn0?.click();
      expect(faqItems[0].getAttribute("data-open")).toBe("true");
    } finally {
      stopMac();
    }
  });

  it("desktop marquee: moves at 32 px/s without per-frame layout reads and pauses on hidden tab", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const rafQueue = new Map<number, FrameRequestCallback>();
    let nextRafId = 1;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafQueue.set(id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafQueue.delete(id);
    });
    const stepRaf = (ts: number) => {
      const batch = [...rafQueue.entries()];
      rafQueue.clear();
      for (const [, cb] of batch) cb(ts);
    };
    const setHidden = (hidden: boolean) => {
      Object.defineProperty(document, "hidden", {
        value: hidden,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    };

    loadBuiltDocument(desktopHtml);
    setHidden(false);
    const stopDesktop = initDesktop();
    try {
      const row0 = document.querySelector<HTMLElement>(
        '[data-marquee-row="0"]',
      );
      const track0 = row0?.querySelector<HTMLElement>(
        '[data-marquee-track="true"]',
      );
      const copy0 = row0?.querySelector<HTMLElement>('[data-marquee-copy="0"]');
      expect(row0).not.toBeNull();
      expect(copy0).not.toBeNull();

      const rectSpy = vi.spyOn(copy0 as HTMLElement, "getBoundingClientRect");
      stepRaf(0);
      stepRaf(1000);
      expect(rectSpy).not.toHaveBeenCalled();

      const xAfter1s = Number(
        (track0?.style.transform ?? "").match(/translate3d\(([-\d.]+)px/u)?.[1],
      );
      expect(Math.abs(xAfter1s)).toBeCloseTo(MARQUEE_SPEED_PX_PER_SEC, 1);

      setHidden(true);
      expect(row0?.getAttribute("data-marquee-paused")).toBe("true");
      const frozen = track0?.style.transform ?? "";
      stepRaf(2000);
      expect(track0?.style.transform).toBe(frozen);

      setHidden(false);
      expect(row0?.getAttribute("data-marquee-paused")).toBe("false");
    } finally {
      setHidden(false);
      stopDesktop();
    }
  });
});

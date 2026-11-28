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
import { SITE_COPY } from "./copy";
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

const { initChangelog, initReleaseRuler } = await import("./islands/changelog");
const {
  COMPOSER_DRAFT_KEY,
  COMPOSER_PROMPT_MAX_LENGTH,
  FEATURE_REEL_MS,
  HERO_ROTATE_MS,
  initHome,
  initKindsStage,
  KIND_STAGE_DESKTOP_QUERY,
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
  let changelogHtml = "";
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
    changelogHtml = readFileSync(join(outDir, "changelog-en.html"), "utf8");
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

      // Kinds stage toggles active slide, button pressed state, title, and live caption.
      const kindBtns = Array.from(
        document.querySelectorAll<HTMLButtonElement>(".site-kinds__name"),
      );
      const kindSlides = Array.from(
        document.querySelectorAll<HTMLElement>("[data-kind-slide]"),
      );
      expect(kindBtns.length).toBe(7);
      expect(kindSlides.length).toBe(7);
      const beforeTitle =
        document.querySelector(".site-kinds__title")?.textContent;
      kindBtns[1].click();
      expect(kindBtns[1].getAttribute("aria-pressed")).toBe("true");
      expect(kindBtns[0].getAttribute("aria-pressed")).toBe("false");
      expect(kindSlides[1].getAttribute("data-active")).toBe("true");
      expect(kindSlides[0].getAttribute("data-active")).toBe("false");
      expect(
        document.querySelector(".site-kinds__title")?.textContent,
      ).not.toBe(beforeTitle);

      // Period switch responds to click and keyboard arrows on stacked C03 PlanCard units.
      const radios = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          '.site-segmented[role="radiogroup"] [role="radio"][data-value]',
        ),
      );
      expect(radios.length).toBe(2);
      const yearlyUnits = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.site-plan-card__unit[data-period="yearly"]',
        ),
      );
      const monthlyUnits = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.site-plan-card__unit[data-period="monthly"]',
        ),
      );
      expect(yearlyUnits.length).toBe(4);
      expect(monthlyUnits.length).toBe(4);
      radios[1].click();
      expect(radios[1].getAttribute("aria-checked")).toBe("true");
      for (const u of yearlyUnits) {
        expect(u.getAttribute("data-shown")).toBe("true");
      }
      for (const u of monthlyUnits) {
        expect(u.getAttribute("data-shown")).toBe("false");
      }
      radios[1]
        .closest('[role="radiogroup"]')
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
        );
      expect(radios[0].getAttribute("aria-checked")).toBe("true");
      for (const u of monthlyUnits) {
        expect(u.getAttribute("data-shown")).toBe("true");
      }

      // Home FAQ uses the shared exclusive C03 accordion (item 0 open at load, inert when closed, keyboard arrows).
      const faqItems = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".site-faq__list .site-faq__item",
        ),
      );
      expect(faqItems.length).toBe(5);
      const faqBtn0 =
        faqItems[0].querySelector<HTMLButtonElement>(".site-faq__trigger");
      const faqBtn1 =
        faqItems[1].querySelector<HTMLButtonElement>(".site-faq__trigger");
      const faqPanel0 =
        faqItems[0].querySelector<HTMLElement>(".site-faq__panel");
      const faqPanel1 =
        faqItems[1].querySelector<HTMLElement>(".site-faq__panel");
      expect(faqBtn0?.getAttribute("aria-expanded")).toBe("true");
      expect(faqPanel0?.hasAttribute("inert")).toBe(false);
      expect(faqBtn1?.getAttribute("aria-expanded")).toBe("false");
      expect(faqPanel1?.hasAttribute("inert")).toBe(true);

      faqBtn1?.click();
      expect(faqBtn1?.getAttribute("aria-expanded")).toBe("true");
      expect(faqItems[1].getAttribute("data-open")).toBe("true");
      expect(faqPanel1?.hasAttribute("inert")).toBe(false);
      expect(faqBtn0?.getAttribute("aria-expanded")).toBe("false");
      expect(faqItems[0].getAttribute("data-open")).toBe("false");
      expect(faqPanel0?.hasAttribute("inert")).toBe(true);

      // ArrowDown moves focus from trigger 1 to trigger 2 without changing open state.
      faqBtn1?.focus();
      faqBtn1?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
      const faqBtn2 =
        faqItems[2].querySelector<HTMLButtonElement>(".site-faq__trigger");
      expect(document.activeElement).toBe(faqBtn2);

      // Clicking the open item closes it cleanly.
      faqBtn1?.click();
      expect(faqBtn1?.getAttribute("aria-expanded")).toBe("false");
      expect(faqItems[1].getAttribute("data-open")).toBe("false");
      expect(faqPanel1?.hasAttribute("inert")).toBe(true);
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

      // After a focus shift that leaves offset < 0 (card 0 at +8 on row 0), the next tick
      // normalizes offset cleanly into [0, setWidth) via the double modulo.
      const row0Copy0 = row0?.querySelector<HTMLElement>(
        '[data-marquee-copy="0"]',
      );
      const row0Card0 =
        row0Copy0?.querySelector<HTMLElement>(".site-show__card");
      const row0Link0 = row0Card0?.querySelector<HTMLAnchorElement>("a");
      if (row0 && row0Copy0 && row0Card0 && row0Link0) {
        row0.getBoundingClientRect = () => rect(0, 1000);
        row0Copy0.getBoundingClientRect = () => rect(0, 1200);
        row0Card0.getBoundingClientRect = () => rect(0, 180);
        row0Link0.matches = (sel: string) => sel === ":focus-visible";
        row0Link0.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        expect(parseX(track0?.style.transform ?? "")).toBeCloseTo(
          MARQUEE_FOCUS_INSET_PX,
          1,
        );
        row0.dispatchEvent(
          new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
        );
        stepRaf(5000);
        stepRaf(5016);
        const wrappedX = parseX(track0?.style.transform ?? "");
        expect(wrappedX).toBeLessThanOrEqual(0);
        expect(wrappedX).toBeGreaterThan(-1200);
      }

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

  it("kind stage: desktop scroll drives all 7 kinds without per-frame layout reads, pauses when hidden, and ignores scroll on mobile", () => {
    let desktopMatches = true;
    const mqListeners: ((e: MediaQueryListEvent) => void)[] = [];
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        get matches() {
          return query === KIND_STAGE_DESKTOP_QUERY
            ? desktopMatches
            : query.includes("prefers-reduced-motion");
        },
        media: query,
        addEventListener: (
          _type: string,
          cb: (e: MediaQueryListEvent) => void,
        ) => {
          if (query === KIND_STAGE_DESKTOP_QUERY) mqListeners.push(cb);
        },
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
    const flushRaf = () => {
      const batch = [...rafQueue.entries()];
      rafQueue.clear();
      for (const [, cb] of batch) cb(0);
    };
    const setScrollY = (y: number) => {
      Object.defineProperty(window, "scrollY", {
        value: y,
        configurable: true,
      });
    };
    const setHidden = (hidden: boolean) => {
      Object.defineProperty(document, "hidden", {
        value: hidden,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    };

    loadBuiltDocument(homeHtml);
    setScrollY(0);
    setHidden(false);

    const track = document.querySelector<HTMLElement>(
      '[data-kinds-track="true"]',
    );
    const sticky = document.querySelector<HTMLElement>(
      '[data-kinds-sticky="true"]',
    );
    const body = document.querySelector<HTMLElement>("[data-kinds-stage]");
    expect(track).not.toBeNull();
    expect(sticky).not.toBeNull();
    expect(body).not.toBeNull();

    // Simulate desktop geometry: track top = 6000, sticky height = 700, runway = 2700 -> track height = 3400.
    const makeRect = (top: number, height: number): DOMRect =>
      ({
        top,
        bottom: top + height,
        height,
        left: 80,
        right: 1360,
        width: 1280,
        x: 80,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
    if (track && sticky) {
      track.getBoundingClientRect = () => makeRect(6000 - window.scrollY, 3400);
      sticky.getBoundingClientRect = () => makeRect(73, 700);
      sticky.style.top = "73px";
    }

    const stopKinds = initKindsStage();
    try {
      const trackSpy = vi.spyOn(track as HTMLElement, "getBoundingClientRect");
      const stickySpy = vi.spyOn(
        sticky as HTMLElement,
        "getBoundingClientRect",
      );
      const computedStyleSpy = vi.spyOn(window, "getComputedStyle");
      const titleEl = document.querySelector<HTMLElement>(".site-kinds__title");
      const lineEl = document.querySelector<HTMLElement>(
        '[data-kind-line="true"]',
      );
      const statusEl = document.querySelector<HTMLElement>(
        '[data-kind-status="true"]',
      );
      expect(titleEl).not.toBeNull();
      expect(lineEl).not.toBeNull();
      expect(statusEl).not.toBeNull();
      expect(statusEl?.getAttribute("role")).toBe("status");
      expect(statusEl?.getAttribute("aria-live")).toBe("polite");
      expect(statusEl?.getAttribute("aria-atomic")).toBe("true");
      expect(statusEl?.classList.contains("site-sr-only")).toBe(true);
      expect(statusEl?.textContent).toBe("");
      expect(lineEl?.hasAttribute("aria-live")).toBe(false);

      // Scroll through the 2700 px sticky travel (start at 6000 - 73 = 5927) across all 7 kinds.
      const seenIndices: string[] = [];
      for (let step = 0; step < 7; step++) {
        const y = 5927 + Math.round(((step + 0.5) / 7) * 2700);
        setScrollY(y);
        window.dispatchEvent(new Event("scroll"));
        flushRaf();
        seenIndices.push(body?.getAttribute("data-kind-active") ?? "");
        expect(lineEl?.hasAttribute("aria-live")).toBe(false);
        expect(statusEl?.textContent).toBe("");
      }
      expect(seenIndices).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
      // Zero per-frame layout reads or style lookups during scroll.
      expect(trackSpy).not.toHaveBeenCalled();
      expect(stickySpy).not.toHaveBeenCalled();
      expect(computedStyleSpy).not.toHaveBeenCalled();

      // Active slide and button match kind 6.
      expect(
        document
          .querySelector('[data-kind-slide="6"]')
          ?.getAttribute("data-active"),
      ).toBe("true");
      expect(
        document
          .querySelector('[data-kind-slide="0"]')
          ?.getAttribute("data-active"),
      ).toBe("false");

      // Hidden tab cancels/pauses scroll updates; showing tab re-syncs.
      setHidden(true);
      setScrollY(5927 + 50);
      window.dispatchEvent(new Event("scroll"));
      flushRaf();
      expect(body?.getAttribute("data-kind-active")).toBe("6");

      setHidden(false);
      expect(body?.getAttribute("data-kind-active")).toBe("0");

      // Mobile (< 48em): scroll does not override manual click selection.
      desktopMatches = false;
      for (const listener of mqListeners) {
        listener({ matches: false } as MediaQueryListEvent);
      }
      const btn4 = document.querySelector<HTMLButtonElement>(
        '.site-kinds__name[data-kind-index="4"]',
      );
      btn4?.click();
      expect(body?.getAttribute("data-kind-active")).toBe("4");
      expect(lineEl?.hasAttribute("aria-live")).toBe(false);
      expect(statusEl?.textContent).toBe(
        `${titleEl?.textContent}: ${lineEl?.textContent}`,
      );
      setScrollY(5927 + 2600);
      window.dispatchEvent(new Event("scroll"));
      flushRaf();
      expect(body?.getAttribute("data-kind-active")).toBe("4");
    } finally {
      setHidden(false);
      setScrollY(0);
      stopKinds();
    }
  });

  it("kind stage: desktop sticky click scrolls to step and keeps choice after 40 px scroll, announces via SSR status region only on click/key, observes only track and sticky, and reads header token", () => {
    let reducedMotion = false;
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        get matches() {
          if (query === KIND_STAGE_DESKTOP_QUERY) return true;
          if (query.includes("prefers-reduced-motion")) return reducedMotion;
          return false;
        },
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
    const flushRaf = () => {
      const batch = [...rafQueue.entries()];
      rafQueue.clear();
      for (const [, cb] of batch) cb(0);
    };
    const setScrollY = (y: number) => {
      Object.defineProperty(window, "scrollY", {
        value: y,
        configurable: true,
      });
    };
    const scrollCalls: ScrollToOptions[] = [];
    vi.stubGlobal(
      "scrollTo",
      vi.fn((opts: ScrollToOptions | number, y?: number) => {
        if (typeof opts === "number") {
          setScrollY(y ?? 0);
          scrollCalls.push({ top: y ?? 0 });
        } else {
          setScrollY(opts.top ?? 0);
          scrollCalls.push(opts);
        }
      }),
    );

    const observedTargets: Element[] = [];
    class FakeResizeObserver {
      observe(target: Element) {
        observedTargets.push(target);
      }
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);

    const makeRect = (top: number, height: number): DOMRect =>
      ({
        top,
        bottom: top + height,
        height,
        left: 80,
        right: 1360,
        width: 1280,
        x: 80,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;

    loadBuiltDocument(homeHtml);
    setScrollY(0);

    const track = document.querySelector<HTMLElement>(
      '[data-kinds-track="true"]',
    );
    const sticky = document.querySelector<HTMLElement>(
      '[data-kinds-sticky="true"]',
    );
    const body = document.querySelector<HTMLElement>("[data-kinds-stage]");
    const titleEl = document.querySelector<HTMLElement>(".site-kinds__title");
    const lineEl = document.querySelector<HTMLElement>(
      '[data-kind-line="true"]',
    );
    const statusEl = document.querySelector<HTMLElement>(
      '[data-kind-status="true"]',
    );
    expect(track).not.toBeNull();
    expect(sticky).not.toBeNull();
    expect(body).not.toBeNull();
    expect(titleEl).not.toBeNull();
    expect(lineEl).not.toBeNull();
    expect(statusEl).not.toBeNull();

    if (track && sticky) {
      track.getBoundingClientRect = () => makeRect(6000 - window.scrollY, 3400);
      sticky.getBoundingClientRect = () => makeRect(73, 700);
      sticky.style.top = "73px";
    }

    const stopKinds = initKindsStage();
    try {
      // ResizeObserver watches only track and sticky, never document.body.
      expect(observedTargets).toEqual([track, sticky]);
      expect(observedTargets).not.toContain(document.body);

      // Start on kind 0: visible line never has aria-live and status region stays empty on scroll.
      const startY = 6000 - 73;
      setScrollY(startY + 190);
      window.dispatchEvent(new Event("scroll"));
      flushRaf();
      expect(body?.getAttribute("data-kind-active")).toBe("0");
      expect(lineEl?.hasAttribute("aria-live")).toBe(false);
      expect(statusEl?.textContent).toBe("");

      // Click kind 5 in desktop sticky mode: scrolls to kind 5 step, writes title + line to status region,
      // never adds aria-live to the visible line, and a +40 px scroll keeps kind 5 active.
      const btn5 = document.querySelector<HTMLButtonElement>(
        '.site-kinds__name[data-kind-index="5"]',
      );
      btn5?.click();
      const expectedKind5Y = Math.round(startY + (5.5 / 7) * 2700);
      expect(scrollCalls.at(-1)).toEqual({
        top: expectedKind5Y,
        behavior: "smooth",
      });
      expect(body?.getAttribute("data-kind-active")).toBe("5");
      expect(lineEl?.hasAttribute("aria-live")).toBe(false);
      const kind5Announcement = `${titleEl?.textContent}: ${lineEl?.textContent}`;
      expect(statusEl?.textContent).toBe(kind5Announcement);

      setScrollY(window.scrollY + 40);
      window.dispatchEvent(new Event("scroll"));
      flushRaf();
      expect(body?.getAttribute("data-kind-active")).toBe("5");

      // Scrolling to a different step (kind 6) never writes to the status region or adds aria-live.
      setScrollY(Math.round(startY + (6.5 / 7) * 2700));
      window.dispatchEvent(new Event("scroll"));
      flushRaf();
      expect(body?.getAttribute("data-kind-active")).toBe("6");
      expect(lineEl?.hasAttribute("aria-live")).toBe(false);
      expect(statusEl?.textContent).toBe(kind5Announcement);

      // Under reduced motion, choosing a kind scrolls with behavior: "auto", keeps the choice, and announces via status region.
      reducedMotion = true;
      const btn2 = document.querySelector<HTMLButtonElement>(
        '.site-kinds__name[data-kind-index="2"]',
      );
      btn2?.click();
      const expectedKind2Y = Math.round(startY + (2.5 / 7) * 2700);
      expect(scrollCalls.at(-1)).toEqual({
        top: expectedKind2Y,
        behavior: "auto",
      });
      expect(body?.getAttribute("data-kind-active")).toBe("2");
      expect(lineEl?.hasAttribute("aria-live")).toBe(false);
      expect(statusEl?.textContent).toBe(
        `${titleEl?.textContent}: ${lineEl?.textContent}`,
      );

      setScrollY(window.scrollY + 40);
      window.dispatchEvent(new Event("scroll"));
      flushRaf();
      expect(body?.getAttribute("data-kind-active")).toBe("2");
    } finally {
      stopKinds();
    }

    // Header height token fallback: when sticky.top is unset, reads --site-header-height (no hardcoded 73),
    // and falls back to 0 when neither token nor header height is present.
    loadBuiltDocument(homeHtml);
    setScrollY(0);
    scrollCalls.length = 0;
    document.documentElement.style.setProperty("--site-header-height", "120px");
    const track2 = document.querySelector<HTMLElement>(
      '[data-kinds-track="true"]',
    );
    const sticky2 = document.querySelector<HTMLElement>(
      '[data-kinds-sticky="true"]',
    );
    if (track2 && sticky2) {
      track2.getBoundingClientRect = () =>
        makeRect(6000 - window.scrollY, 3400);
      sticky2.getBoundingClientRect = () => makeRect(120, 700);
      sticky2.style.top = "";
    }
    const stopTokenKinds = initKindsStage();
    try {
      document
        .querySelector<HTMLButtonElement>(
          '.site-kinds__name[data-kind-index="5"]',
        )
        ?.click();
      expect(scrollCalls.at(-1)?.top).toBe(
        Math.round(6000 - 120 + (5.5 / 7) * 2700),
      );
    } finally {
      stopTokenKinds();
      document.documentElement.style.removeProperty("--site-header-height");
    }

    loadBuiltDocument(homeHtml);
    setScrollY(0);
    scrollCalls.length = 0;
    const track3 = document.querySelector<HTMLElement>(
      '[data-kinds-track="true"]',
    );
    const sticky3 = document.querySelector<HTMLElement>(
      '[data-kinds-sticky="true"]',
    );
    if (track3 && sticky3) {
      track3.getBoundingClientRect = () =>
        makeRect(6000 - window.scrollY, 3400);
      sticky3.getBoundingClientRect = () => makeRect(0, 700);
      sticky3.style.top = "";
    }
    const stopZeroKinds = initKindsStage();
    try {
      document
        .querySelector<HTMLButtonElement>(
          '.site-kinds__name[data-kind-index="5"]',
        )
        ?.click();
      expect(scrollCalls.at(-1)?.top).toBe(Math.round(6000 + (5.5 / 7) * 2700));
    } finally {
      stopZeroKinds();
      setScrollY(0);
    }
  });

  it("kind stage: smooth scroll lock skips intermediate scrolls and syncFromScroll, ignores stale scrollend, unlocks on real scrollend, 2 s timer, and wheel", () => {
    vi.useFakeTimers();
    const hadScrollEnd = "onscrollend" in window;
    const origScrollEndDesc = Object.getOwnPropertyDescriptor(
      window,
      "onscrollend",
    );
    Object.defineProperty(window, "onscrollend", {
      value: null,
      configurable: true,
      writable: true,
    });
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        get matches() {
          return query === KIND_STAGE_DESKTOP_QUERY;
        },
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
    const flushRaf = () => {
      const batch = [...rafQueue.entries()];
      rafQueue.clear();
      for (const [, cb] of batch) cb(0);
    };
    const setScrollY = (y: number) => {
      Object.defineProperty(window, "scrollY", {
        value: y,
        configurable: true,
      });
    };
    const setHidden = (hidden: boolean) => {
      Object.defineProperty(document, "hidden", {
        value: hidden,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    // Smooth scrollTo does NOT move window.scrollY immediately, keeping the scroll lock active.
    const scrollCalls: ScrollToOptions[] = [];
    vi.stubGlobal(
      "scrollTo",
      vi.fn((opts: ScrollToOptions | number, y?: number) => {
        if (typeof opts === "number") {
          setScrollY(y ?? 0);
          scrollCalls.push({ top: y ?? 0 });
        } else {
          scrollCalls.push(opts);
          if (opts.behavior !== "smooth") {
            setScrollY(opts.top ?? 0);
          }
        }
      }),
    );

    const makeRect = (top: number, height: number): DOMRect =>
      ({
        top,
        bottom: top + height,
        height,
        left: 80,
        right: 1360,
        width: 1280,
        x: 80,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;

    loadBuiltDocument(homeHtml);
    setScrollY(0);
    setHidden(false);

    const track = document.querySelector<HTMLElement>(
      '[data-kinds-track="true"]',
    );
    const sticky = document.querySelector<HTMLElement>(
      '[data-kinds-sticky="true"]',
    );
    const body = document.querySelector<HTMLElement>("[data-kinds-stage]");
    expect(track).not.toBeNull();
    expect(sticky).not.toBeNull();
    expect(body).not.toBeNull();

    if (track && sticky) {
      track.getBoundingClientRect = () => makeRect(6000 - window.scrollY, 3400);
      sticky.getBoundingClientRect = () => makeRect(73, 700);
      sticky.style.top = "73px";
    }

    const startY = 6000 - 73;
    const stepY = (idx: number) =>
      Math.round(startY + ((idx + 0.5) / 7) * 2700);
    const stopKinds = initKindsStage();
    try {
      // Start on kind 0.
      setScrollY(stepY(0));
      window.dispatchEvent(new Event("scroll"));
      flushRaf();
      expect(body?.getAttribute("data-kind-active")).toBe("0");

      // Click kind 5: smooth scrollTo does not move scrollY, so the lock is taken.
      const btn5 = document.querySelector<HTMLButtonElement>(
        '.site-kinds__name[data-kind-index="5"]',
      );
      btn5?.click();
      expect(scrollCalls.at(-1)).toEqual({
        top: stepY(5),
        behavior: "smooth",
      });
      expect(body?.getAttribute("data-kind-active")).toBe("5");

      // Three intermediate scroll events while locked keep kind 5 active.
      for (const midStep of [1, 2, 3]) {
        setScrollY(stepY(midStep));
        window.dispatchEvent(new Event("scroll"));
        flushRaf();
        expect(body?.getAttribute("data-kind-active")).toBe("5");
      }

      // Direct syncFromScroll path (via visibilitychange) also skips while locked.
      setHidden(true);
      setHidden(false);
      expect(body?.getAttribute("data-kind-active")).toBe("5");

      // Stale scrollend within 200 ms while far from target does not unlock.
      vi.advanceTimersByTime(100);
      window.dispatchEvent(new Event("scrollend"));
      setScrollY(stepY(1));
      window.dispatchEvent(new Event("scroll"));
      flushRaf();
      expect(body?.getAttribute("data-kind-active")).toBe("5");

      // Real scrollend after arrival (>= 200 ms) unlocks; subsequent scroll syncs.
      vi.advanceTimersByTime(150);
      setScrollY(stepY(5));
      window.dispatchEvent(new Event("scrollend"));
      expect(body?.getAttribute("data-kind-active")).toBe("5");
      setScrollY(stepY(1));
      window.dispatchEvent(new Event("scroll"));
      flushRaf();
      expect(body?.getAttribute("data-kind-active")).toBe("1");

      // 2000 ms max timer ends the lock when scrollend never fires.
      btn5?.click();
      expect(body?.getAttribute("data-kind-active")).toBe("5");
      vi.advanceTimersByTime(1999);
      setScrollY(stepY(1));
      window.dispatchEvent(new Event("scroll"));
      flushRaf();
      expect(body?.getAttribute("data-kind-active")).toBe("5");

      vi.advanceTimersByTime(1);
      flushRaf();
      expect(body?.getAttribute("data-kind-active")).toBe("1");

      // Wheel event ends the lock immediately so the next scroll syncs.
      btn5?.click();
      expect(body?.getAttribute("data-kind-active")).toBe("5");
      setScrollY(stepY(2));
      window.dispatchEvent(new Event("scroll"));
      flushRaf();
      expect(body?.getAttribute("data-kind-active")).toBe("5");

      window.dispatchEvent(new Event("wheel"));
      setScrollY(stepY(2));
      window.dispatchEvent(new Event("scroll"));
      flushRaf();
      expect(body?.getAttribute("data-kind-active")).toBe("2");
    } finally {
      stopKinds();
      setHidden(false);
      setScrollY(0);
      if (hadScrollEnd && origScrollEndDesc) {
        Object.defineProperty(window, "onscrollend", origScrollEndDesc);
      } else {
        delete (window as unknown as Record<string, unknown>).onscrollend;
      }
      vi.useRealTimers();
    }
  });

  it("kind stage: smooth scroll lock unlocks on scroll keydown and pointerdown", () => {
    vi.useFakeTimers();
    const hadScrollEnd = "onscrollend" in window;
    const origScrollEndDesc = Object.getOwnPropertyDescriptor(
      window,
      "onscrollend",
    );
    Object.defineProperty(window, "onscrollend", {
      value: null,
      configurable: true,
      writable: true,
    });
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        get matches() {
          return query === KIND_STAGE_DESKTOP_QUERY;
        },
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
    const flushRaf = () => {
      const batch = [...rafQueue.entries()];
      rafQueue.clear();
      for (const [, cb] of batch) cb(0);
    };
    const setScrollY = (y: number) => {
      Object.defineProperty(window, "scrollY", {
        value: y,
        configurable: true,
      });
    };
    vi.stubGlobal(
      "scrollTo",
      vi.fn((opts: ScrollToOptions | number, y?: number) => {
        if (typeof opts === "number") {
          setScrollY(y ?? 0);
        } else if (opts.behavior !== "smooth") {
          setScrollY(opts.top ?? 0);
        }
      }),
    );

    const makeRect = (top: number, height: number): DOMRect =>
      ({
        top,
        bottom: top + height,
        height,
        left: 80,
        right: 1360,
        width: 1280,
        x: 80,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;

    loadBuiltDocument(homeHtml);
    setScrollY(0);

    const track = document.querySelector<HTMLElement>(
      '[data-kinds-track="true"]',
    );
    const sticky = document.querySelector<HTMLElement>(
      '[data-kinds-sticky="true"]',
    );
    const body = document.querySelector<HTMLElement>("[data-kinds-stage]");
    if (track && sticky) {
      track.getBoundingClientRect = () => makeRect(6000 - window.scrollY, 3400);
      sticky.getBoundingClientRect = () => makeRect(73, 700);
      sticky.style.top = "73px";
    }

    const startY = 6000 - 73;
    const stepY = (idx: number) =>
      Math.round(startY + ((idx + 0.5) / 7) * 2700);
    const stopKinds = initKindsStage();
    try {
      const btn5 = document.querySelector<HTMLButtonElement>(
        '.site-kinds__name[data-kind-index="5"]',
      );

      // Start on kind 0, click kind 5 to take lock.
      setScrollY(stepY(0));
      window.dispatchEvent(new Event("scroll"));
      flushRaf();
      btn5?.click();
      expect(body?.getAttribute("data-kind-active")).toBe("5");

      // Non-scroll key does not unlock (and does not consume the keydown listener).
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
      setScrollY(stepY(1));
      window.dispatchEvent(new Event("scroll"));
      flushRaf();
      expect(body?.getAttribute("data-kind-active")).toBe("5");

      // Scroll key (PageDown) ends the lock so the next scroll syncs.
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown" }));
      setScrollY(stepY(1));
      window.dispatchEvent(new Event("scroll"));
      flushRaf();
      expect(body?.getAttribute("data-kind-active")).toBe("1");

      // ArrowDown and Home also end the lock.
      for (const key of ["ArrowDown", "Home"]) {
        btn5?.click();
        expect(body?.getAttribute("data-kind-active")).toBe("5");
        window.dispatchEvent(new KeyboardEvent("keydown", { key }));
        setScrollY(stepY(2));
        window.dispatchEvent(new Event("scroll"));
        flushRaf();
        expect(body?.getAttribute("data-kind-active")).toBe("2");
      }

      // pointerdown (e.g. dragging the scrollbar) ends the lock so the next scroll syncs.
      btn5?.click();
      expect(body?.getAttribute("data-kind-active")).toBe("5");
      setScrollY(stepY(3));
      window.dispatchEvent(new Event("scroll"));
      flushRaf();
      expect(body?.getAttribute("data-kind-active")).toBe("5");

      window.dispatchEvent(new Event("pointerdown"));
      setScrollY(stepY(3));
      window.dispatchEvent(new Event("scroll"));
      flushRaf();
      expect(body?.getAttribute("data-kind-active")).toBe("3");
    } finally {
      stopKinds();
      setScrollY(0);
      if (hadScrollEnd && origScrollEndDesc) {
        Object.defineProperty(window, "onscrollend", origScrollEndDesc);
      } else {
        delete (window as unknown as Record<string, unknown>).onscrollend;
      }
      vi.useRealTimers();
    }
  });

  it("kind stage: resize during smooth scroll lock recomputes target for active kind", () => {
    vi.useFakeTimers();
    const hadScrollEnd = "onscrollend" in window;
    const origScrollEndDesc = Object.getOwnPropertyDescriptor(
      window,
      "onscrollend",
    );
    Object.defineProperty(window, "onscrollend", {
      value: null,
      configurable: true,
      writable: true,
    });
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        get matches() {
          return query === KIND_STAGE_DESKTOP_QUERY;
        },
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
    const flushRaf = () => {
      const batch = [...rafQueue.entries()];
      rafQueue.clear();
      for (const [, cb] of batch) cb(0);
    };
    const setScrollY = (y: number) => {
      Object.defineProperty(window, "scrollY", {
        value: y,
        configurable: true,
      });
    };
    const scrollCalls: ScrollToOptions[] = [];
    vi.stubGlobal(
      "scrollTo",
      vi.fn((opts: ScrollToOptions | number, y?: number) => {
        if (typeof opts === "number") {
          setScrollY(y ?? 0);
          scrollCalls.push({ top: y ?? 0 });
        } else {
          scrollCalls.push(opts);
          if (opts.behavior !== "smooth") {
            setScrollY(opts.top ?? 0);
          }
        }
      }),
    );

    const makeRect = (top: number, height: number): DOMRect =>
      ({
        top,
        bottom: top + height,
        height,
        left: 80,
        right: 1360,
        width: 1280,
        x: 80,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;

    loadBuiltDocument(homeHtml);
    setScrollY(0);

    let trackTopDoc = 6000;
    let trackHeight = 3400;
    const track = document.querySelector<HTMLElement>(
      '[data-kinds-track="true"]',
    );
    const sticky = document.querySelector<HTMLElement>(
      '[data-kinds-sticky="true"]',
    );
    const body = document.querySelector<HTMLElement>("[data-kinds-stage]");
    if (track && sticky) {
      track.getBoundingClientRect = () =>
        makeRect(trackTopDoc - window.scrollY, trackHeight);
      sticky.getBoundingClientRect = () => makeRect(73, 700);
      sticky.style.top = "73px";
    }

    const stopKinds = initKindsStage();
    try {
      const initialTarget = Math.round(6000 - 73 + (5.5 / 7) * 2700);
      setScrollY(6000 - 73 + 100);
      window.dispatchEvent(new Event("scroll"));
      flushRaf();
      expect(body?.getAttribute("data-kind-active")).toBe("0");

      const btn5 = document.querySelector<HTMLButtonElement>(
        '.site-kinds__name[data-kind-index="5"]',
      );
      btn5?.click();
      expect(scrollCalls).toEqual([{ top: initialTarget, behavior: "smooth" }]);
      expect(body?.getAttribute("data-kind-active")).toBe("5");

      // Window resizes during the smooth scroll lock, shifting track position and runway travel.
      trackTopDoc = 6400;
      trackHeight = 3700;
      const resizedTarget = Math.round(6400 - 73 + (5.5 / 7) * 3000);
      window.dispatchEvent(new Event("resize"));

      expect(scrollCalls.at(-1)).toEqual({
        top: resizedTarget,
        behavior: "smooth",
      });
      expect(body?.getAttribute("data-kind-active")).toBe("5");

      // Lock remains active for the new target until scrollend arrives at resizedTarget.
      setScrollY(6400 - 73 + 100);
      window.dispatchEvent(new Event("scroll"));
      flushRaf();
      expect(body?.getAttribute("data-kind-active")).toBe("5");

      vi.advanceTimersByTime(250);
      setScrollY(resizedTarget);
      window.dispatchEvent(new Event("scrollend"));
      setScrollY(resizedTarget + 40);
      window.dispatchEvent(new Event("scroll"));
      flushRaf();
      expect(body?.getAttribute("data-kind-active")).toBe("5");
    } finally {
      stopKinds();
      setScrollY(0);
      if (hadScrollEnd && origScrollEndDesc) {
        Object.defineProperty(window, "onscrollend", origScrollEndDesc);
      } else {
        delete (window as unknown as Record<string, unknown>).onscrollend;
      }
      vi.useRealTimers();
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

  it("desktop: hides badges in SSR, detects desktop platforms without dropping icons, updates hero note, hides badges on phones, and toggles exclusive FAQ", () => {
    loadBuiltDocument(desktopHtml);

    // Server markup shows NO "Your system" badge to avoid false badges before JS or on phones.
    for (const id of ["windows", "macos", "linux"] as const) {
      expect(
        document
          .querySelector(`[data-platform-row="${id}"]`)
          ?.getAttribute("data-current-platform"),
        `SSR row ${id}`,
      ).toBe("false");
      expect(
        document.querySelector<HTMLElement>(
          `[data-platform-current-badge="${id}"]`,
        )?.hidden,
        `SSR badge ${id}`,
      ).toBe(true);
    }

    // Header action is the desktop download CTA with a data-site-button-label span and download icon.
    const headerCta = document.querySelector<HTMLAnchorElement>(
      '.site-header__cta[data-desktop-download-cta="true"]',
    );
    expect(headerCta).not.toBeNull();
    const headerLabel = headerCta?.querySelector<HTMLElement>(
      '[data-site-button-label="true"]',
    );
    expect(headerLabel).not.toBeNull();
    // Removing the generated StyleX atomic class must not break label selection or wipe the icon.
    headerLabel?.classList.remove("xb3r6kr");

    const heroNote = document.querySelector<HTMLElement>(
      '[data-desktop-platform-note="true"]',
    );
    expect(heroNote).not.toBeNull();

    // macOS: planned, points to #platforms (no dead link), updates hero note, preserves icon, highlights macOS row only.
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
        expect(
          cta.querySelector<HTMLElement>('[data-site-button-label="true"]')
            ?.textContent,
        ).toBe(SITE_COPY.en.desktop.ctaLabel.macos);
        expect(cta.querySelector("svg")).not.toBeNull();
      }
      expect(heroNote?.textContent).toBe(SITE_COPY.en.desktop.heroNote.macos);
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

      // Linux: planned, points to #platforms, updates hero note, highlights Linux row only.
      expect(
        initDesktopPlatform({ platform: "Linux x86_64", userAgent: "" }),
      ).toBe("linux");
      expect(headerCta?.getAttribute("href")).toBe("#platforms");
      expect(headerCta?.getAttribute("data-detected-platform")).toBe("linux");
      expect(headerLabel?.textContent).toBe(
        SITE_COPY.en.desktop.ctaLabel.linux,
      );
      expect(headerCta?.querySelector("svg")).not.toBeNull();
      expect(heroNote?.textContent).toBe(SITE_COPY.en.desktop.heroNote.linux);
      expect(
        document
          .querySelector('[data-platform-row="linux"]')
          ?.getAttribute("data-current-platform"),
      ).toBe("true");
      expect(
        document.querySelector<HTMLElement>(
          '[data-platform-current-badge="linux"]',
        )?.hidden,
      ).toBe(false);

      // Windows: real repo installer guide link, updates hero note, highlights Windows row.
      expect(initDesktopPlatform({ platform: "Win32" })).toBe("windows");
      expect(headerCta?.getAttribute("href")).toBe(
        "https://github.com/stefandsl/mellodifai-app/blob/main/docs/windows-app.md",
      );
      expect(headerCta?.getAttribute("rel")).toBe("noopener noreferrer");
      expect(headerCta?.getAttribute("data-detected-platform")).toBe("windows");
      expect(headerCta?.getAttribute("data-platform-status")).toBe("source");
      expect(headerLabel?.textContent).toBe(
        SITE_COPY.en.desktop.ctaLabel.windows,
      );
      expect(heroNote?.textContent).toBe(SITE_COPY.en.desktop.heroNote.windows);
      expect(
        document
          .querySelector('[data-platform-row="windows"]')
          ?.getAttribute("data-current-platform"),
      ).toBe("true");
      expect(
        document.querySelector<HTMLElement>(
          '[data-platform-current-badge="windows"]',
        )?.hidden,
      ).toBe(false);

      // Phone visitor (Android / iPhone): CTA keeps safe Windows fallback, NO "Your system" badge shown.
      for (const phoneNav of [
        {
          userAgentData: { platform: "Android" },
          platform: "Linux armv8l",
          userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)",
        },
        {
          platform: "iPhone",
          userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        },
      ]) {
        expect(initDesktopPlatform(phoneNav)).toBe("windows");
        expect(headerCta?.getAttribute("href")).toBe(
          "https://github.com/stefandsl/mellodifai-app/blob/main/docs/windows-app.md",
        );
        expect(heroNote?.textContent).toBe(
          SITE_COPY.en.desktop.heroNote.windows,
        );
        for (const id of ["windows", "macos", "linux"] as const) {
          expect(
            document
              .querySelector(`[data-platform-row="${id}"]`)
              ?.getAttribute("data-current-platform"),
            `phone row ${id}`,
          ).toBe("false");
          expect(
            document.querySelector<HTMLElement>(
              `[data-platform-current-badge="${id}"]`,
            )?.hidden,
            `phone badge ${id}`,
          ).toBe(true);
        }
      }

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

  it("changelog: chip click scrolls and marks aria-current, scroll updates chip, keyboard navigates chips, and reduced motion uses auto scroll", () => {
    loadBuiltDocument(changelogHtml);

    const chips = Array.from(
      document.querySelectorAll<HTMLAnchorElement>("[data-release-chip]"),
    );
    const entries = Array.from(
      document.querySelectorAll<HTMLElement>("[data-release-entry]"),
    );
    expect(chips.length).toBeGreaterThanOrEqual(11);
    expect(entries).toHaveLength(chips.length);

    // Position entries vertically in jsdom so scroll tracking and click target math run realistically.
    let currentScrollY = 0;
    Object.defineProperty(window, "scrollY", {
      get: () => currentScrollY,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 900,
      configurable: true,
    });
    const scrollToMock = vi
      .fn()
      .mockImplementation((opts: { top?: number; behavior?: string }) => {
        if (typeof opts?.top === "number") currentScrollY = opts.top;
      });
    vi.stubGlobal("scrollTo", scrollToMock);

    entries.forEach((entry, idx) => {
      const docTop = 400 + idx * 600;
      entry.getBoundingClientRect = () =>
        ({
          top: docTop - currentScrollY,
          bottom: docTop + 500 - currentScrollY,
          left: 272,
          right: 1168,
          width: 896,
          height: 500,
          x: 272,
          y: docTop - currentScrollY,
          toJSON: () => ({}),
        }) as DOMRect;
    });

    initChangelog();

    // First chip starts marked.
    expect(chips[0].getAttribute("aria-current")).toBe("location");
    expect(chips[2].hasAttribute("aria-current")).toBe(false);

    // With prefers-reduced-motion: reduce (stubbed true in beforeEach), chip click uses behavior: "auto".
    chips[2].click();
    expect(chips[2].getAttribute("aria-current")).toBe("location");
    expect(chips[0].hasAttribute("aria-current")).toBe(false);
    expect(scrollToMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "auto" }),
    );
    expect(window.location.hash).toBe(
      `#${chips[2].getAttribute("data-release-chip")}`,
    );

    // When reduced motion is off, chip click uses behavior: "smooth".
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    scrollToMock.mockClear();
    chips[4].click();
    expect(chips[4].getAttribute("aria-current")).toBe("location");
    expect(chips[2].hasAttribute("aria-current")).toBe(false);
    expect(scrollToMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth" }),
    );

    // Scroll position updates the marked chip once scrollend unlocks the programmatic jump.
    window.dispatchEvent(new Event("scrollend"));
    currentScrollY = 400 + 1 * 600 - 40;
    window.dispatchEvent(new Event("scroll"));
    expect(chips[1].getAttribute("aria-current")).toBe("location");
    expect(chips[4].hasAttribute("aria-current")).toBe(false);

    // Keyboard: ArrowRight, ArrowLeft, End, Home move focus; Space activates chip.
    chips[0].focus();
    chips[0].dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(chips[1]);

    chips[1].dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "End",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(chips[chips.length - 1]);

    chips[chips.length - 1].dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Home",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(chips[0]);

    chips[3].focus();
    chips[3].dispatchEvent(
      new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(chips[3].getAttribute("aria-current")).toBe("location");
  });

  it("changelog scroll sync: writes aria-current only when active chip changes and reads layout at most once per frame", () => {
    loadBuiltDocument(changelogHtml);

    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    const flushFrame = () => {
      const batch = rafQueue.splice(0, rafQueue.length);
      for (const cb of batch) cb(performance.now());
    };

    const header = document.querySelector<HTMLElement>(".site-header");
    const ruler = document.querySelector<HTMLElement>("[data-release-ruler]");
    const track = document.querySelector<HTMLElement>(
      "[data-release-ruler-track]",
    );
    const chips = Array.from(
      document.querySelectorAll<HTMLAnchorElement>("[data-release-chip]"),
    );
    const entries = Array.from(
      document.querySelectorAll<HTMLElement>("[data-release-entry]"),
    );

    let currentScrollY = 0;
    Object.defineProperty(window, "scrollY", {
      get: () => currentScrollY,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 900,
      configurable: true,
    });

    const headerRectSpy = vi.fn(
      () =>
        ({
          top: 0,
          bottom: 73,
          left: 0,
          right: 1440,
          width: 1440,
          height: 73,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    const rulerRectSpy = vi.fn(
      () =>
        ({
          top: 73,
          bottom: 163,
          left: 0,
          right: 1440,
          width: 1440,
          height: 90,
          x: 0,
          y: 73,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    if (header) header.getBoundingClientRect = headerRectSpy;
    if (ruler) ruler.getBoundingClientRect = rulerRectSpy;

    const events: string[] = [];
    const entryRectSpies = entries.map((entry, idx) => {
      const docTop = 400 + idx * 600;
      const spy = vi.fn(() => {
        events.push(`read:entry:${idx}`);
        return {
          top: docTop - currentScrollY,
          bottom: docTop + 500 - currentScrollY,
          left: 272,
          right: 1168,
          width: 896,
          height: 500,
          x: 272,
          y: docTop - currentScrollY,
          toJSON: () => ({}),
        } as DOMRect;
      });
      entry.getBoundingClientRect = spy;
      return spy;
    });

    if (track) {
      Object.defineProperty(track, "scrollWidth", {
        value: 2400,
        configurable: true,
      });
      Object.defineProperty(track, "clientWidth", {
        value: 900,
        configurable: true,
      });
      track.scrollTo = vi.fn();
      track.getBoundingClientRect = vi.fn(() => {
        events.push("read:track");
        return {
          top: 100,
          bottom: 150,
          left: 100,
          right: 1000,
          width: 900,
          height: 50,
          x: 100,
          y: 100,
          toJSON: () => ({}),
        } as DOMRect;
      });
    }

    const cleanup = initReleaseRuler();
    try {
      headerRectSpy.mockClear();
      rulerRectSpy.mockClear();
      for (const s of entryRectSpies) s.mockClear();
      events.length = 0;

      const origSetAttr = Element.prototype.setAttribute;
      const origRemoveAttr = Element.prototype.removeAttribute;
      const setAttrSpy = vi
        .spyOn(Element.prototype, "setAttribute")
        .mockImplementation(function (
          this: Element,
          name: string,
          value: string,
        ) {
          if (name === "aria-current") events.push("write:set-aria-current");
          return origSetAttr.call(this, name, value);
        });
      const removeAttrSpy = vi
        .spyOn(Element.prototype, "removeAttribute")
        .mockImplementation(function (this: Element, name: string) {
          if (name === "aria-current") events.push("write:remove-aria-current");
          return origRemoveAttr.call(this, name);
        });

      // 5 burst scroll events within the same entry (entry 0): coalesced to 1 rAF read,
      // 0 aria-current DOM writes, and 0 header/ruler layout reads.
      for (let i = 0; i < 5; i += 1) {
        currentScrollY = 10 + i * 5;
        window.dispatchEvent(new Event("scroll"));
      }
      expect(rafQueue).toHaveLength(1);
      flushFrame();

      expect(entryRectSpies[0]).toHaveBeenCalledTimes(1);
      expect(headerRectSpy).toHaveBeenCalledTimes(0);
      expect(rulerRectSpy).toHaveBeenCalledTimes(0);
      expect(
        setAttrSpy.mock.calls.filter(([name]) => name === "aria-current"),
      ).toHaveLength(0);
      expect(
        removeAttrSpy.mock.calls.filter(([name]) => name === "aria-current"),
      ).toHaveLength(0);

      // Scroll into entry 2: only 1 removeAttribute (old) + 1 setAttribute (new),
      // and track layout read happens before any aria-current DOM write (no read-after-write).
      events.length = 0;
      currentScrollY = 400 + 2 * 600 - 40;
      window.dispatchEvent(new Event("scroll"));
      flushFrame();

      expect(chips[2].getAttribute("aria-current")).toBe("location");
      expect(
        removeAttrSpy.mock.calls.filter(([name]) => name === "aria-current"),
      ).toHaveLength(1);
      expect(
        setAttrSpy.mock.calls.filter(([name]) => name === "aria-current"),
      ).toHaveLength(1);
      const firstWriteIdx = events.findIndex((e) => e.startsWith("write:"));
      const lastReadIdx = events.reduce(
        (acc, e, idx) => (e.startsWith("read:") ? idx : acc),
        -1,
      );
      expect(firstWriteIdx).toBeGreaterThan(-1);
      expect(lastReadIdx).toBeLessThan(firstWriteIdx);
    } finally {
      cleanup();
    }
  });

  it("changelog scroll lock: holds across long smooth scrolls until scrollend (and via idle fallback when scrollend is absent)", () => {
    vi.useFakeTimers();
    loadBuiltDocument(changelogHtml);

    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );

    const chips = Array.from(
      document.querySelectorAll<HTMLAnchorElement>("[data-release-chip]"),
    );
    const entries = Array.from(
      document.querySelectorAll<HTMLElement>("[data-release-entry]"),
    );

    let currentScrollY = 0;
    Object.defineProperty(window, "scrollY", {
      get: () => currentScrollY,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 900,
      configurable: true,
    });
    vi.stubGlobal("scrollTo", vi.fn());

    entries.forEach((entry, idx) => {
      const docTop = 400 + idx * 600;
      entry.getBoundingClientRect = () =>
        ({
          top: docTop - currentScrollY,
          bottom: docTop + 500 - currentScrollY,
          left: 272,
          right: 1168,
          width: 896,
          height: 500,
          x: 272,
          y: docTop - currentScrollY,
          toJSON: () => ({}),
        }) as DOMRect;
    });

    // Part 1: Browser with native scrollend support (Chromium / Firefox).
    Object.defineProperty(window, "onscrollend", {
      value: null,
      configurable: true,
      writable: true,
    });
    const cleanup = initReleaseRuler();
    try {
      chips[5].click();
      expect(chips[5].getAttribute("aria-current")).toBe("location");

      // Advance well past the old 650 ms fixed lock (900 ms) while emitting intermediate scrolls:
      // chip 5 must remain marked without flickering to intermediate entries.
      for (let step = 1; step <= 9; step += 1) {
        vi.advanceTimersByTime(100);
        currentScrollY = 400 + Math.min(3, Math.floor(step / 2)) * 600;
        window.dispatchEvent(new Event("scroll"));
        vi.advanceTimersByTime(20);
        expect(chips[5].getAttribute("aria-current")).toBe("location");
      }

      // Firing scrollend when scroll ended elsewhere (interrupted smooth scroll)
      // immediately releases the lock and syncs to the resting position.
      currentScrollY = 400 + 1 * 600 - 40;
      window.dispatchEvent(new Event("scrollend"));
      vi.advanceTimersByTime(20);
      expect(chips[1].getAttribute("aria-current")).toBe("location");
      expect(chips[5].hasAttribute("aria-current")).toBe(false);

      // Part 1b: 3 s cap unlock when smooth scroll was interrupted with NO scrollend
      // and NO follow-up scroll event still syncs to the visible entry.
      chips[5].click();
      expect(chips[5].getAttribute("aria-current")).toBe("location");
      currentScrollY = 400 + 2 * 600 - 40;
      vi.advanceTimersByTime(3050);
      expect(chips[2].getAttribute("aria-current")).toBe("location");
      expect(chips[5].hasAttribute("aria-current")).toBe(false);

      // Part 2: Browser without native scrollend support (WebKit fallback).
      delete (window as unknown as { onscrollend?: unknown }).onscrollend;
      chips[6].click();
      expect(chips[6].getAttribute("aria-current")).toBe("location");

      // Continuous intermediate scroll events past 650 ms keep extending the idle fallback:
      // zero flicker during a 900 ms smooth scroll.
      for (let step = 1; step <= 9; step += 1) {
        vi.advanceTimersByTime(100);
        currentScrollY = 400 + 2 * 600;
        window.dispatchEvent(new Event("scroll"));
        vi.advanceTimersByTime(20);
        expect(chips[6].getAttribute("aria-current")).toBe("location");
      }

      // Once an interrupted smooth scroll stops away from chip 6 (at entry 2) with NO
      // scrollend and NO extra scroll event, the idle fallback unlocks and immediately
      // marks chip 2.
      vi.advanceTimersByTime(250);
      expect(chips[2].getAttribute("aria-current")).toBe("location");
      expect(chips[6].hasAttribute("aria-current")).toBe(false);
    } finally {
      cleanup();
      delete (window as unknown as { onscrollend?: unknown }).onscrollend;
    }
  });
});

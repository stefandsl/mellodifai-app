// Interactive islands for the public home page:
// shell (header scroll, agents menu, phone menu, deferred fonts),
// hero rotating title (6.0 s), hero composer + chips, showcase marquee (32 px/s),
// feature reels (5.0 s), recipe kinds stage, period switch, and FAQ collapsibles.
import {
  buildComposerSignUpUrl,
  COMPOSER_DRAFT_KEY,
  COMPOSER_PROMPT_MAX_LENGTH,
  saveComposerDraft,
} from "../composer-draft";
import { initPeriodSwitch } from "./period-switch";
import { initShell } from "./shell";

export {
  buildComposerSignUpUrl,
  COMPOSER_DRAFT_KEY,
  COMPOSER_PROMPT_MAX_LENGTH,
};
export const HERO_ROTATE_MS = 6000;
export const MARQUEE_SPEED_PX_PER_SEC = 32;
export const FEATURE_REEL_MS = 5000;

type KindItem = {
  name: string;
  line: string;
  kind: string;
  rings: [number, number, number][];
};

type HomeStateClasses = {
  disabledButton: string[];
  panelClosed: string[];
  panelOpen: string[];
  chevronOpen: string[];
  chevronClosed: string[];
  chipPressed: string[];
  chipUnpressed: string[];
};

export type HomeInitOptions = {
  navigate?: (url: string) => void;
};

const SVG_NS = "http://www.w3.org/2000/svg";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

function watchReducedMotion(onChange: (reduced: boolean) => void): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return () => {};
  }
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  const handler = (event: MediaQueryListEvent) => onChange(event.matches);
  mq.addEventListener?.("change", handler);
  return () => mq.removeEventListener?.("change", handler);
}

function readHomeStateClasses(): HomeStateClasses {
  const el = document.getElementById("site-home-classes");
  if (el?.textContent) {
    try {
      const parsed = JSON.parse(el.textContent) as Partial<HomeStateClasses>;
      return {
        disabledButton: Array.isArray(parsed.disabledButton)
          ? parsed.disabledButton
          : [],
        panelClosed: Array.isArray(parsed.panelClosed)
          ? parsed.panelClosed
          : [],
        panelOpen: Array.isArray(parsed.panelOpen) ? parsed.panelOpen : [],
        chevronOpen: Array.isArray(parsed.chevronOpen)
          ? parsed.chevronOpen
          : [],
        chevronClosed: Array.isArray(parsed.chevronClosed)
          ? parsed.chevronClosed
          : [],
        chipPressed: Array.isArray(parsed.chipPressed)
          ? parsed.chipPressed
          : [],
        chipUnpressed: Array.isArray(parsed.chipUnpressed)
          ? parsed.chipUnpressed
          : [],
      };
    } catch {
      // Fall through to empty defaults.
    }
  }
  return {
    disabledButton: [],
    panelClosed: [],
    panelOpen: [],
    chevronOpen: [],
    chevronClosed: [],
    chipPressed: [],
    chipUnpressed: [],
  };
}

function diffToggleClasses(buttons: HTMLButtonElement[]) {
  const pressed =
    buttons.find((b) => b.getAttribute("aria-pressed") === "true") ??
    buttons[0];
  const unpressed = buttons.find((b) => b !== pressed) ?? buttons[1];
  if (!pressed || !unpressed) return { pressedOnly: [], unpressedOnly: [] };
  const pSet = new Set(pressed.classList);
  const uSet = new Set(unpressed.classList);
  return {
    pressedOnly: [...pSet].filter((c) => !uSet.has(c)),
    unpressedOnly: [...uSet].filter((c) => !pSet.has(c)),
  };
}

function setTogglePressed(
  buttons: HTMLButtonElement[],
  activeIdx: number,
  pressedOnly: string[],
  unpressedOnly: string[],
) {
  for (let i = 0; i < buttons.length; i++) {
    const isPressed = i === activeIdx;
    const btn = buttons[i];
    btn.setAttribute("aria-pressed", String(isPressed));
    for (const c of pressedOnly) btn.classList.toggle(c, isPressed);
    for (const c of unpressedOnly) btn.classList.toggle(c, !isPressed);
  }
}

export function initHeroRotator(): () => void {
  const rotator = document.querySelector<HTMLElement>(
    '[data-hero-rotator="true"]',
  );
  if (!rotator) return () => {};
  const lines = Array.from(
    rotator.querySelectorAll<HTMLElement>("[data-rotator-line]"),
  );
  if (lines.length < 2) return () => {};

  let activeIdx = Math.max(
    0,
    lines.findIndex((el) => el.getAttribute("data-active") === "true"),
  );
  let reduced = prefersReducedMotion();
  let timer: number | null = null;

  const apply = (idx: number) => {
    activeIdx = ((idx % lines.length) + lines.length) % lines.length;
    rotator.setAttribute("data-rotator-index", String(activeIdx));
    for (let i = 0; i < lines.length; i++) {
      lines[i].setAttribute("data-active", String(i === activeIdx));
    }
  };

  const clearTimer = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = () => {
    clearTimer();
    if (reduced || document.hidden) {
      rotator.setAttribute("data-rotator-running", "false");
      return;
    }
    rotator.setAttribute("data-rotator-running", "true");
    timer = window.setTimeout(() => {
      apply(activeIdx + 1);
      schedule();
    }, HERO_ROTATE_MS);
  };

  const onVisibility = () => {
    if (document.hidden) {
      clearTimer();
      rotator.setAttribute("data-rotator-running", "false");
    } else {
      schedule();
    }
  };

  document.addEventListener("visibilitychange", onVisibility);
  const stopMotionWatch = watchReducedMotion((nextReduced) => {
    reduced = nextReduced;
    schedule();
  });

  schedule();

  return () => {
    clearTimer();
    document.removeEventListener("visibilitychange", onVisibility);
    stopMotionWatch();
  };
}

export function initHeroComposer(
  stateClasses: Pick<HomeStateClasses, "chipPressed" | "chipUnpressed">,
  options?: HomeInitOptions,
): void {
  const form = document.querySelector<HTMLFormElement>(
    'form[data-hero-composer="true"]',
  );
  if (!form) return;
  const textarea = form.querySelector<HTMLTextAreaElement>(
    "textarea.site-composer__input",
  );
  if (!textarea) return;

  const wrap = form.closest(".site-composer-wrap") ?? document;
  const chips = Array.from(
    wrap.querySelectorAll<HTMLButtonElement>(".site-chip[data-chip-prompt]"),
  );

  const navigate =
    options?.navigate ??
    ((url: string) => {
      window.location.assign(url);
    });

  for (let i = 0; i < chips.length; i++) {
    const chip = chips[i];
    chip.addEventListener("click", () => {
      const prompt = chip.getAttribute("data-chip-prompt") ?? "";
      textarea.value = prompt;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      setTogglePressed(
        chips,
        i,
        stateClasses.chipPressed,
        stateClasses.chipUnpressed,
      );
      textarea.focus();
      try {
        textarea.setSelectionRange(prompt.length, prompt.length);
      } catch {
        // Some input environments restrict selection range updates.
      }
    });
  }

  textarea.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      }
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const saved = saveComposerDraft(textarea.value);
    const target = buildComposerSignUpUrl(
      form.getAttribute("action") || "/login",
      saved,
    );
    navigate(target);
  });
}

export function initShowcaseMarquee(): () => void {
  const viewports = Array.from(
    document.querySelectorAll<HTMLElement>("[data-marquee-row]"),
  );
  if (!viewports.length) return () => {};

  const cleanups: (() => void)[] = [];

  for (const viewport of viewports) {
    const track = viewport.querySelector<HTMLElement>(
      '[data-marquee-track="true"]',
    );
    const copy0 = viewport.querySelector<HTMLElement>(
      '[data-marquee-copy="0"]',
    );
    if (!track || !copy0) continue;

    const direction =
      Number(viewport.getAttribute("data-marquee-direction")) >= 0 ? 1 : -1;
    let offset = 0;
    let hovered = false;
    let focused = false;
    let reduced = prefersReducedMotion();
    let lastTs: number | null = null;
    let rafId: number | null = null;

    const getSetWidth = () => {
      const measured =
        copy0.getBoundingClientRect().width ||
        copy0.offsetWidth ||
        track.scrollWidth / 2;
      if (measured > 0) return measured;
      const fallback = Number(viewport.getAttribute("data-marquee-width"));
      return Number.isFinite(fallback) && fallback > 0 ? fallback : 1200;
    };

    const isPaused = () => reduced || hovered || focused || document.hidden;

    const syncPaused = () => {
      viewport.setAttribute("data-marquee-paused", String(isPaused()));
    };

    const applyTransform = (setWidth: number) => {
      const x = direction < 0 ? -offset : offset - setWidth;
      track.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;
    };

    const tick = (ts: number) => {
      rafId = null;
      if (isPaused()) {
        lastTs = null;
        syncPaused();
        return;
      }
      const setWidth = getSetWidth();
      if (lastTs !== null) {
        const dtSec = Math.max(0, (ts - lastTs) / 1000);
        offset = (offset + MARQUEE_SPEED_PX_PER_SEC * dtSec) % setWidth;
      }
      applyTransform(setWidth);
      lastTs = ts;
      rafId = window.requestAnimationFrame(tick);
    };

    const stop = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      lastTs = null;
      syncPaused();
    };

    const start = () => {
      syncPaused();
      if (isPaused() || rafId !== null) return;
      lastTs = null;
      rafId = window.requestAnimationFrame(tick);
    };

    const onEnter = () => {
      hovered = true;
      stop();
    };
    const onLeave = () => {
      hovered = false;
      start();
    };
    const onFocusIn = () => {
      focused = true;
      stop();
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!viewport.contains(event.relatedTarget as Node | null)) {
        focused = false;
        start();
      }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    viewport.addEventListener("pointerenter", onEnter);
    viewport.addEventListener("mouseenter", onEnter);
    viewport.addEventListener("pointerleave", onLeave);
    viewport.addEventListener("mouseleave", onLeave);
    viewport.addEventListener("focusin", onFocusIn);
    viewport.addEventListener("focusout", onFocusOut);
    document.addEventListener("visibilitychange", onVisibility);

    const stopMotionWatch = watchReducedMotion((nextReduced) => {
      reduced = nextReduced;
      if (reduced) stop();
      else start();
    });

    start();

    cleanups.push(() => {
      stop();
      viewport.removeEventListener("pointerenter", onEnter);
      viewport.removeEventListener("mouseenter", onEnter);
      viewport.removeEventListener("pointerleave", onLeave);
      viewport.removeEventListener("mouseleave", onLeave);
      viewport.removeEventListener("focusin", onFocusIn);
      viewport.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("visibilitychange", onVisibility);
      stopMotionWatch();
    });
  }

  return () => {
    for (const fn of cleanups) fn();
  };
}

export function initFeatureReels(
  stateClasses: Pick<HomeStateClasses, "chipPressed" | "chipUnpressed">,
): () => void {
  const articles = Array.from(
    document.querySelectorAll<HTMLElement>("[data-feature-reel]"),
  );
  if (!articles.length) return () => {};

  const cleanups: (() => void)[] = [];

  for (const article of articles) {
    const bullets = Array.from(
      article.querySelectorAll<HTMLButtonElement>("[data-reel-bullet]"),
    );
    const points = Array.from(
      article.querySelectorAll<HTMLElement>(".site-feature__point"),
    );
    const dots = Array.from(
      article.querySelectorAll<HTMLButtonElement>("[data-reel-dot]"),
    );
    const track = article.querySelector<HTMLElement>(
      '[data-reel-track="true"]',
    );
    const count = bullets.length;
    if (count < 2) continue;

    let step = 0;
    let hovered = false;
    let focused = false;
    let reduced = prefersReducedMotion();
    let timer: number | null = null;

    const dotDiff =
      stateClasses.chipPressed.length || stateClasses.chipUnpressed.length
        ? {
            pressedOnly: stateClasses.chipPressed,
            unpressedOnly: stateClasses.chipUnpressed,
          }
        : diffToggleClasses(dots);

    const applyStep = (nextIdx: number) => {
      step = ((nextIdx % count) + count) % count;
      article.setAttribute("data-reel-step", String(step));
      for (let i = 0; i < count; i++) {
        const active = i === step;
        points[i]?.setAttribute("data-active", String(active));
        bullets[i]?.setAttribute("data-active", String(active));
        if (active) {
          bullets[i]?.setAttribute("aria-current", "step");
        } else {
          bullets[i]?.removeAttribute("aria-current");
        }
      }
      setTogglePressed(
        bullets,
        step,
        dotDiff.pressedOnly,
        dotDiff.unpressedOnly,
      );
      if (dots.length) {
        setTogglePressed(
          dots,
          step,
          dotDiff.pressedOnly,
          dotDiff.unpressedOnly,
        );
      }
      if (track) {
        track.style.transform = `translate3d(-${(step * 100) / count}%, 0, 0)`;
      }
    };

    const isPaused = () => reduced || hovered || focused || document.hidden;

    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = () => {
      clearTimer();
      article.setAttribute("data-reel-paused", String(isPaused()));
      if (isPaused()) return;
      timer = window.setTimeout(() => {
        applyStep(step + 1);
        schedule();
      }, FEATURE_REEL_MS);
    };

    for (let i = 0; i < count; i++) {
      bullets[i]?.addEventListener("click", () => {
        applyStep(i);
        schedule();
      });
      dots[i]?.addEventListener("click", () => {
        applyStep(i);
        schedule();
      });
    }

    const onEnter = () => {
      hovered = true;
      clearTimer();
      article.setAttribute("data-reel-paused", "true");
    };
    const onLeave = () => {
      hovered = false;
      schedule();
    };
    const onFocusIn = () => {
      focused = true;
      clearTimer();
      article.setAttribute("data-reel-paused", "true");
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!article.contains(event.relatedTarget as Node | null)) {
        focused = false;
        schedule();
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        clearTimer();
        article.setAttribute("data-reel-paused", "true");
      } else {
        schedule();
      }
    };

    article.addEventListener("pointerenter", onEnter);
    article.addEventListener("mouseenter", onEnter);
    article.addEventListener("pointerleave", onLeave);
    article.addEventListener("mouseleave", onLeave);
    article.addEventListener("focusin", onFocusIn);
    article.addEventListener("focusout", onFocusOut);
    document.addEventListener("visibilitychange", onVisibility);

    const stopMotionWatch = watchReducedMotion((nextReduced) => {
      reduced = nextReduced;
      schedule();
    });

    schedule();

    cleanups.push(() => {
      clearTimer();
      article.removeEventListener("pointerenter", onEnter);
      article.removeEventListener("mouseenter", onEnter);
      article.removeEventListener("pointerleave", onLeave);
      article.removeEventListener("mouseleave", onLeave);
      article.removeEventListener("focusin", onFocusIn);
      article.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("visibilitychange", onVisibility);
      stopMotionWatch();
    });
  }

  return () => {
    for (const fn of cleanups) fn();
  };
}

function initKindsStage(): void {
  const body = document.querySelector<HTMLElement>(
    ".site-kinds__body[data-kinds-stage]",
  );
  if (!body) return;
  const raw = body.getAttribute("data-kinds-stage");
  if (!raw) return;

  let items: KindItem[];
  try {
    items = JSON.parse(raw) as KindItem[];
  } catch {
    return;
  }

  const buttons = Array.from(
    body.querySelectorAll<HTMLButtonElement>(".site-kinds__name"),
  );
  const cover = body.querySelector<HTMLElement>(".site-kinds__cover");
  const coverSvg = cover?.querySelector<SVGSVGElement>("svg.site-cover__art");
  const titleEl = body.querySelector<HTMLElement>(".site-kinds__title");
  const lineEl = body.querySelector<HTMLElement>(
    '.site-kinds__caption [aria-live="polite"]',
  );
  if (!buttons.length || !cover || !coverSvg || !titleEl || !lineEl) return;

  const { pressedOnly, unpressedOnly } = diffToggleClasses(buttons);

  for (let i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener("click", () => {
      const item = items[i];
      if (!item) return;
      setTogglePressed(buttons, i, pressedOnly, unpressedOnly);

      for (const cls of [...cover.classList]) {
        if (cls.startsWith("site-cover--")) cover.classList.remove(cls);
      }
      cover.classList.add(`site-cover--${item.kind}`);

      coverSvg.replaceChildren();
      for (const [cx, cy, n] of item.rings) {
        const g = document.createElementNS(SVG_NS, "g");
        for (let k = 0; k < n; k++) {
          const c = document.createElementNS(SVG_NS, "circle");
          c.setAttribute("cx", String(cx));
          c.setAttribute("cy", String(cy));
          c.setAttribute("r", String((k + 1) * 16));
          g.appendChild(c);
        }
        const dot = document.createElementNS(SVG_NS, "circle");
        dot.setAttribute("class", "site-cover__dot");
        dot.setAttribute("cx", String(cx));
        dot.setAttribute("cy", String(cy));
        dot.setAttribute("r", "3");
        g.appendChild(dot);
        coverSvg.appendChild(g);
      }

      titleEl.textContent = item.name;
      lineEl.textContent = item.line;
    });
  }
}

function initHomeFaq(stateClasses: HomeStateClasses): void {
  const triggers = document.querySelectorAll<HTMLButtonElement>(
    ".site-faq__item .astryx-collapsible-trigger[aria-controls]",
  );
  for (const btn of triggers) {
    const panelId = btn.getAttribute("aria-controls");
    if (!panelId) continue;
    const panel = document.getElementById(panelId);
    if (!panel) continue;
    const chevron = btn.querySelector<HTMLElement>(".astryx-icon");

    btn.addEventListener("click", () => {
      const nextOpen = btn.getAttribute("aria-expanded") !== "true";
      btn.setAttribute("aria-expanded", String(nextOpen));
      for (const cls of stateClasses.panelClosed) {
        panel.classList.toggle(cls, !nextOpen);
      }
      for (const cls of stateClasses.panelOpen) {
        panel.classList.toggle(cls, nextOpen);
      }
      panel.hidden = !nextOpen;
      if (chevron) {
        for (const cls of stateClasses.chevronOpen) {
          chevron.classList.toggle(cls, nextOpen);
        }
        for (const cls of stateClasses.chevronClosed) {
          chevron.classList.toggle(cls, !nextOpen);
        }
      }
    });
  }
}

export function initHome(options?: HomeInitOptions): () => void {
  const stateClasses = readHomeStateClasses();
  initShell();
  const stopRotator = initHeroRotator();
  initHeroComposer(stateClasses, options);
  const stopMarquee = initShowcaseMarquee();
  const stopReels = initFeatureReels(stateClasses);
  initKindsStage();
  initPeriodSwitch();
  initHomeFaq(stateClasses);
  return () => {
    stopRotator();
    stopMarquee();
    stopReels();
  };
}

if (
  typeof window !== "undefined" &&
  !("__SITE_ISLAND_MANUAL_INIT__" in window)
) {
  initHome();
}

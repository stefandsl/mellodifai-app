// Interactive islands for the public home page:
// shell (header scroll, agents menu, phone menu, deferred fonts),
// hero rotating title (6.0 s), hero composer + chips, showcase marquee (32 px/s),
// feature reels (5.0 s), sticky recipe kinds stage (2700 px desktop scroll),
// period switch, and exclusive FAQ accordion.
import {
  buildComposerSignUpUrl,
  COMPOSER_DRAFT_KEY,
  COMPOSER_PROMPT_MAX_LENGTH,
  saveComposerDraft,
} from "../composer-draft";
import { initFaq } from "./faq";
import { initPeriodSwitch } from "./period-switch";
import { initShell } from "./shell";

export {
  buildComposerSignUpUrl,
  COMPOSER_DRAFT_KEY,
  COMPOSER_PROMPT_MAX_LENGTH,
};
export const HERO_ROTATE_MS = 6000;
export const MARQUEE_SPEED_PX_PER_SEC = 32;
export const MARQUEE_FOCUS_INSET_PX = 8;
export const FEATURE_REEL_MS = 5000;
export const KIND_STAGE_DESKTOP_QUERY = "(min-width: 48em)";

type KindItem = {
  name: string;
  line: string;
  kind: string;
};

type HomeStateClasses = {
  chipPressed: string[];
  chipUnpressed: string[];
};

export type HomeInitOptions = {
  navigate?: (url: string) => void;
};

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const KIND_SCROLL_LOCK_IDLE_MS = 180;
const KIND_SCROLL_LOCK_NO_EVENT_FALLBACK_MS = 450;
const KIND_SCROLL_LOCK_MAX_MS = 2000;

function parseCssLengthPx(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return Number.NaN;
  const value = Number.parseFloat(trimmed);
  if (!Number.isFinite(value)) return Number.NaN;
  if (trimmed.endsWith("rem")) {
    const rootSize = Number.parseFloat(
      getComputedStyle(document.documentElement).fontSize,
    );
    return value * (Number.isFinite(rootSize) && rootSize > 0 ? rootSize : 16);
  }
  return value;
}

function readStickyTopPx(stickyEl: HTMLElement): number {
  const stickyStyle = getComputedStyle(stickyEl);
  const parsedTop = Number.parseFloat(stickyStyle.top);
  if (Number.isFinite(parsedTop)) return parsedTop;
  const tokenValue =
    stickyStyle.getPropertyValue("--site-header-height") ||
    getComputedStyle(document.documentElement).getPropertyValue(
      "--site-header-height",
    );
  const parsedToken = parseCssLengthPx(tokenValue);
  if (Number.isFinite(parsedToken)) return parsedToken;
  const header = document.querySelector<HTMLElement>(".site-header");
  if (header) {
    const measured = header.getBoundingClientRect().height;
    if (Number.isFinite(measured) && measured > 0) return measured;
  }
  return 0;
}

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
    let disposed = false;
    let lastTs: number | null = null;
    let rafId: number | null = null;

    const measureSetWidth = () => {
      const measured =
        copy0.getBoundingClientRect().width ||
        copy0.offsetWidth ||
        track.scrollWidth / 2;
      if (measured > 0) return measured;
      const fallback = Number(viewport.getAttribute("data-marquee-width"));
      return Number.isFinite(fallback) && fallback > 0 ? fallback : 1200;
    };

    let setWidth = measureSetWidth();

    const isPaused = () => reduced || hovered || focused || document.hidden;

    const syncPaused = () => {
      viewport.setAttribute("data-marquee-paused", String(isPaused()));
    };

    const applyTransform = () => {
      const x = direction < 0 ? -offset : offset - setWidth;
      track.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;
    };

    const isKeyboardFocus = (target: HTMLElement | null): boolean => {
      if (!target) return false;
      try {
        return target.matches(":focus-visible");
      } catch {
        return false;
      }
    };

    const bringFocusedCardIntoView = (target: HTMLElement | null) => {
      viewport.scrollLeft = 0;
      const card = target?.closest<HTMLElement>(".site-show__card") ?? target;
      if (!card || !copy0.contains(card)) return;
      setWidth = measureSetWidth();
      const vpRect = viewport.getBoundingClientRect();
      const vpWidth = vpRect.width > 0 ? vpRect.width : viewport.clientWidth;
      if (vpWidth <= 0) return;

      const copyRect = copy0.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const cardLeft =
        cardRect.width > 0 ? cardRect.left - copyRect.left : card.offsetLeft;
      const cardWidth = cardRect.width > 0 ? cardRect.width : card.offsetWidth;
      const currentX = track.style.transform
        ? direction < 0
          ? -offset
          : offset - setWidth
        : 0;
      const visualLeft = currentX + cardLeft;
      const visualRight = visualLeft + cardWidth;

      const inset = MARQUEE_FOCUS_INSET_PX;
      let targetX = currentX;
      if (cardWidth + inset * 2 > vpWidth) {
        const leftInset = Math.min(inset, Math.max(0, vpWidth - cardWidth));
        targetX = leftInset - cardLeft;
      } else if (visualLeft < inset) {
        targetX = inset - cardLeft;
      } else if (visualRight > vpWidth - inset) {
        targetX = vpWidth - inset - (cardLeft + cardWidth);
      }
      targetX = Math.min(inset, Math.max(-setWidth - inset, targetX));
      offset = direction < 0 ? -targetX : targetX + setWidth;
      applyTransform();
      viewport.scrollLeft = 0;
    };

    const tick = (ts: number) => {
      rafId = null;
      if (isPaused()) {
        lastTs = null;
        syncPaused();
        return;
      }
      if (lastTs !== null) {
        const dtSec = Math.max(0, (ts - lastTs) / 1000);
        offset =
          (((offset + MARQUEE_SPEED_PX_PER_SEC * dtSec) % setWidth) +
            setWidth) %
          setWidth;
      }
      applyTransform();
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
    const onFocusIn = (event: FocusEvent) => {
      focused = true;
      stop();
      const target = event.target as HTMLElement | null;
      if (isKeyboardFocus(target)) {
        bringFocusedCardIntoView(target);
      }
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!viewport.contains(event.relatedTarget as Node | null)) {
        focused = false;
        viewport.scrollLeft = 0;
        start();
      }
    };
    const onScroll = () => {
      if (viewport.scrollLeft !== 0) {
        viewport.scrollLeft = 0;
      }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    const resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            if (!disposed) setWidth = measureSetWidth();
          })
        : null;
    resizeObserver?.observe(copy0);

    document.fonts?.ready
      ?.then(() => {
        if (!disposed) setWidth = measureSetWidth();
      })
      .catch(() => {});

    viewport.addEventListener("pointerenter", onEnter);
    viewport.addEventListener("mouseenter", onEnter);
    viewport.addEventListener("pointerleave", onLeave);
    viewport.addEventListener("mouseleave", onLeave);
    viewport.addEventListener("focusin", onFocusIn);
    viewport.addEventListener("focusout", onFocusOut);
    viewport.addEventListener("scroll", onScroll);
    document.addEventListener("visibilitychange", onVisibility);

    const stopMotionWatch = watchReducedMotion((nextReduced) => {
      reduced = nextReduced;
      if (reduced) stop();
      else start();
    });

    start();

    cleanups.push(() => {
      disposed = true;
      stop();
      resizeObserver?.disconnect();
      viewport.removeEventListener("pointerenter", onEnter);
      viewport.removeEventListener("mouseenter", onEnter);
      viewport.removeEventListener("pointerleave", onLeave);
      viewport.removeEventListener("mouseleave", onLeave);
      viewport.removeEventListener("focusin", onFocusIn);
      viewport.removeEventListener("focusout", onFocusOut);
      viewport.removeEventListener("scroll", onScroll);
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
    const slides = Array.from(
      article.querySelectorAll<HTMLElement>(".site-feature__slide"),
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
      }
      for (let i = 0; i < slides.length; i++) {
        if (i === step) {
          slides[i].removeAttribute("aria-hidden");
        } else {
          slides[i].setAttribute("aria-hidden", "true");
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

export function initKindsStage(): () => void {
  const body = document.querySelector<HTMLElement>(
    ".site-kinds__body[data-kinds-stage]",
  );
  if (!body) return () => {};
  const raw = body.getAttribute("data-kinds-stage");
  if (!raw) return () => {};

  let items: KindItem[];
  try {
    items = JSON.parse(raw) as KindItem[];
  } catch {
    return () => {};
  }
  if (!items.length) return () => {};

  const track = document.querySelector<HTMLElement>(
    '[data-kinds-track="true"]',
  );
  const sticky = document.querySelector<HTMLElement>(
    '[data-kinds-sticky="true"]',
  );
  const buttons = Array.from(
    body.querySelectorAll<HTMLButtonElement>(".site-kinds__name"),
  );
  const slides = Array.from(
    body.querySelectorAll<HTMLElement>("[data-kind-slide]"),
  );
  const titleEl = body.querySelector<HTMLElement>(".site-kinds__title");
  const lineEl =
    body.querySelector<HTMLElement>("[data-kind-line]") ??
    body.querySelector<HTMLElement>(".site-kinds__caption p");
  if (!buttons.length || !titleEl || !lineEl) return () => {};

  const { pressedOnly, unpressedOnly } = diffToggleClasses(buttons);

  let activeIdx = 0;
  let disposed = false;
  let rafId: number | null = null;
  let trackDocTop = 0;
  let stickyTop = 0;
  let travel = 0;

  let scrollLocked = false;
  let lockedTargetTop: number | null = null;
  let lockStartedAt = 0;
  let maxLockTimer: number | null = null;
  let idleLockTimer: number | null = null;

  const desktopMq =
    typeof window.matchMedia === "function"
      ? window.matchMedia(KIND_STAGE_DESKTOP_QUERY)
      : null;
  let desktopMatches = desktopMq ? desktopMq.matches : true;

  const isDesktopSticky = () => Boolean(track && sticky && desktopMatches);
  const supportsScrollEnd = () => "onscrollend" in window;

  const setActive = (nextIdx: number, announce = false) => {
    const clamped = Math.max(0, Math.min(items.length - 1, nextIdx));
    const item = items[clamped];
    if (!item) return;
    if (
      clamped === activeIdx &&
      body.getAttribute("data-kind-active") === String(clamped)
    ) {
      return;
    }
    if (announce) {
      lineEl.setAttribute("aria-live", "polite");
    } else {
      lineEl.removeAttribute("aria-live");
    }
    activeIdx = clamped;
    body.setAttribute("data-kind-active", String(activeIdx));
    setTogglePressed(buttons, activeIdx, pressedOnly, unpressedOnly);
    for (let i = 0; i < slides.length; i++) {
      slides[i].setAttribute("data-active", String(i === activeIdx));
    }
    titleEl.textContent = item.name;
    lineEl.textContent = item.line;
  };

  const measureGeometry = () => {
    if (!track || !sticky || !isDesktopSticky()) {
      travel = 0;
      return;
    }
    const trackRect = track.getBoundingClientRect();
    const stickyRect = sticky.getBoundingClientRect();
    stickyTop = readStickyTopPx(sticky);
    trackDocTop = trackRect.top + window.scrollY;
    travel = Math.max(0, trackRect.height - stickyRect.height);
  };

  const syncFromScroll = () => {
    rafId = null;
    if (
      disposed ||
      document.hidden ||
      scrollLocked ||
      !isDesktopSticky() ||
      travel <= 0
    ) {
      return;
    }
    const scrolled = window.scrollY + stickyTop - trackDocTop;
    const progress = Math.max(0, Math.min(1, scrolled / travel));
    const nextIdx = Math.min(
      items.length - 1,
      Math.floor(progress * items.length),
    );
    setActive(nextIdx, false);
  };

  const cancelPendingFrame = () => {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const unlockScroll = () => {
    if (!scrollLocked) return;
    scrollLocked = false;
    lockedTargetTop = null;
    if (maxLockTimer !== null) {
      window.clearTimeout(maxLockTimer);
      maxLockTimer = null;
    }
    if (idleLockTimer !== null) {
      window.clearTimeout(idleLockTimer);
      idleLockTimer = null;
    }
    window.removeEventListener("scrollend", onScrollEnd);
    document.removeEventListener("scrollend", onScrollEnd);
    window.removeEventListener("wheel", onUserInterrupt);
    window.removeEventListener("touchstart", onUserInterrupt);
  };

  const onScrollEnd = () => {
    if (!scrollLocked) return;
    const expectedTop = lockedTargetTop;
    // Ignore a stale scrollend emitted by a scroll that finished just before our smooth scroll started.
    if (
      expectedTop !== null &&
      Math.abs(window.scrollY - expectedTop) > 20 &&
      Date.now() - lockStartedAt < 200
    ) {
      return;
    }
    unlockScroll();
    if (
      !disposed &&
      expectedTop !== null &&
      Math.abs(window.scrollY - expectedTop) > 20
    ) {
      onScroll();
    }
  };

  const onUserInterrupt = () => {
    unlockScroll();
  };

  const lockScrollUntilEnd = (targetTop: number) => {
    unlockScroll();
    scrollLocked = true;
    lockedTargetTop = targetTop;
    lockStartedAt = Date.now();
    window.addEventListener("scrollend", onScrollEnd);
    document.addEventListener("scrollend", onScrollEnd);
    window.addEventListener("wheel", onUserInterrupt, {
      passive: true,
      once: true,
    });
    window.addEventListener("touchstart", onUserInterrupt, {
      passive: true,
      once: true,
    });
    maxLockTimer = window.setTimeout(onScrollEnd, KIND_SCROLL_LOCK_MAX_MS);
    if (!supportsScrollEnd()) {
      idleLockTimer = window.setTimeout(
        onScrollEnd,
        KIND_SCROLL_LOCK_NO_EVENT_FALLBACK_MS,
      );
    }
  };

  const onScroll = () => {
    if (document.hidden || !isDesktopSticky() || travel <= 0) return;
    if (scrollLocked) {
      if (!supportsScrollEnd()) {
        if (
          lockedTargetTop !== null &&
          Math.abs(window.scrollY - lockedTargetTop) <= 4
        ) {
          unlockScroll();
          return;
        }
        if (idleLockTimer !== null) window.clearTimeout(idleLockTimer);
        idleLockTimer = window.setTimeout(
          onScrollEnd,
          KIND_SCROLL_LOCK_IDLE_MS,
        );
      }
      return;
    }
    if (rafId !== null) return;
    rafId = window.requestAnimationFrame(syncFromScroll);
  };

  const onResize = () => {
    if (disposed) return;
    measureGeometry();
    if (!document.hidden && isDesktopSticky() && travel > 0) {
      syncFromScroll();
    }
  };

  const onVisibility = () => {
    if (document.hidden) {
      cancelPendingFrame();
    } else if (isDesktopSticky() && travel > 0) {
      syncFromScroll();
    }
  };

  const buttonCleanups: (() => void)[] = [];
  for (let i = 0; i < buttons.length; i++) {
    const onClick = () => {
      if (isDesktopSticky()) {
        measureGeometry();
        if (travel > 0) {
          const rawTarget = Math.max(
            0,
            Math.round(
              trackDocTop - stickyTop + ((i + 0.5) / items.length) * travel,
            ),
          );
          const maxScrollY = Math.max(
            0,
            document.documentElement.scrollHeight - window.innerHeight,
          );
          const targetY =
            maxScrollY > 0 ? Math.min(maxScrollY, rawTarget) : rawTarget;
          const reduced = prefersReducedMotion();
          const behavior: ScrollBehavior = reduced ? "auto" : "smooth";
          unlockScroll();
          cancelPendingFrame();
          window.scrollTo({ top: targetY, behavior });
          if (!reduced && Math.abs(window.scrollY - targetY) > 2) {
            lockScrollUntilEnd(targetY);
          }
        }
      }
      setActive(i, true);
    };
    buttons[i].addEventListener("click", onClick);
    buttonCleanups.push(() => buttons[i].removeEventListener("click", onClick));
  }

  const resizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          if (!disposed) measureGeometry();
        })
      : null;
  if (track) resizeObserver?.observe(track);
  if (sticky) resizeObserver?.observe(sticky);

  document.fonts?.ready
    ?.then(() => {
      if (!disposed) measureGeometry();
    })
    .catch(() => {});

  const onBreakpoint = (event: MediaQueryListEvent) => {
    desktopMatches = event.matches;
    onResize();
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  desktopMq?.addEventListener?.("change", onBreakpoint);

  measureGeometry();
  if (
    !document.hidden &&
    isDesktopSticky() &&
    travel > 0 &&
    window.scrollY > 0
  ) {
    syncFromScroll();
  }

  return () => {
    disposed = true;
    unlockScroll();
    cancelPendingFrame();
    resizeObserver?.disconnect();
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onVisibility);
    desktopMq?.removeEventListener?.("change", onBreakpoint);
    for (const fn of buttonCleanups) fn();
  };
}

export function initHome(options?: HomeInitOptions): () => void {
  const stateClasses = readHomeStateClasses();
  initShell();
  const stopRotator = initHeroRotator();
  initHeroComposer(stateClasses, options);
  const stopMarquee = initShowcaseMarquee();
  const stopReels = initFeatureReels(stateClasses);
  const stopKinds = initKindsStage();
  initPeriodSwitch();
  const stopFaq = initFaq();
  return () => {
    stopRotator();
    stopMarquee();
    stopReels();
    stopKinds();
    stopFaq();
  };
}

if (
  typeof window !== "undefined" &&
  !("__SITE_ISLAND_MANUAL_INIT__" in window)
) {
  initHome();
}

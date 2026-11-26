// Interactive vanilla island for /changelog (C09):
// - Chip click scrolls to the matching release entry and marks aria-current="location"
// - Scroll position updates the marked chip (O(1) DOM writes, read-then-write once per frame)
// - Programmatic smooth-scroll lock uses scrollend with an idle/timeout fallback (no fixed 650 ms window)
// - Keyboard navigation across chips (ArrowLeft, ArrowRight, Home, End, Space, Enter)
// - Respects prefers-reduced-motion (never uses smooth scroll when reduced motion is active)
import { initShell } from "./shell";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const SCROLL_LOCK_IDLE_MS = 180;
const SCROLL_LOCK_NO_EVENT_FALLBACK_MS = 450;
const SCROLL_LOCK_MAX_MS = 3000;

type ReleasePair = {
  id: string;
  chip: HTMLAnchorElement;
  entry: HTMLElement;
};

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

function supportsScrollEnd(): boolean {
  return "onscrollend" in window;
}

function computeRailTargetLeft(
  track: HTMLElement | null,
  chip: HTMLElement,
): number | null {
  if (!track) return null;
  if (track.scrollWidth <= track.clientWidth) return null;
  const trackRect = track.getBoundingClientRect();
  const chipRect = chip.getBoundingClientRect();
  const targetLeft =
    track.scrollLeft +
    (chipRect.left - trackRect.left) -
    (trackRect.width - chipRect.width) / 2;
  return Math.max(
    0,
    Math.min(track.scrollWidth - track.clientWidth, Math.round(targetLeft)),
  );
}

function applyRailScroll(
  track: HTMLElement | null,
  targetLeft: number | null,
  behavior: ScrollBehavior,
): void {
  if (!track || targetLeft === null) return;
  if (typeof track.scrollTo === "function") {
    track.scrollTo({ left: targetLeft, behavior });
  } else {
    track.scrollLeft = targetLeft;
  }
}

export function initReleaseRuler(): () => void {
  const ruler = document.querySelector<HTMLElement>("[data-release-ruler]");
  if (!ruler) return () => {};

  const header = document.querySelector<HTMLElement>(".site-header");
  const track = ruler.querySelector<HTMLElement>("[data-release-ruler-track]");
  const chips = Array.from(
    ruler.querySelectorAll<HTMLAnchorElement>("[data-release-chip]"),
  );
  if (chips.length === 0) return () => {};

  const pairs: ReleasePair[] = chips
    .map((chip) => {
      const id = chip.getAttribute("data-release-chip") ?? "";
      const entry = id ? document.getElementById(id) : null;
      return entry ? { id, chip, entry } : null;
    })
    .filter((item): item is ReleasePair => item !== null);
  if (pairs.length === 0) return () => {};

  let activePair: ReleasePair | null = null;
  let cachedStickyOffset: number | null = null;
  let rafId = 0;

  let scrollLocked = false;
  let lockedTargetTop: number | null = null;
  let maxLockTimer: number | null = null;
  let idleLockTimer: number | null = null;

  const getStickyOffset = (): number => {
    if (cachedStickyOffset !== null) return cachedStickyOffset;
    const headerH = header ? header.getBoundingClientRect().height : 73;
    const rulerH = ruler.getBoundingClientRect().height;
    cachedStickyOffset = Math.round(headerH + rulerH + 16);
    return cachedStickyOffset;
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
    const expectedTop = lockedTargetTop;
    unlockScroll();
    // If scrolling ended away from the clicked target (for example an interrupted scroll),
    // sync the active chip immediately to the resting position.
    if (expectedTop !== null && Math.abs(window.scrollY - expectedTop) > 40) {
      scheduleScrollSync();
    }
  };

  const onUserInterrupt = () => {
    unlockScroll();
  };

  const lockScrollUntilEnd = (targetTop: number) => {
    unlockScroll();
    scrollLocked = true;
    lockedTargetTop = targetTop;
    window.addEventListener("scrollend", onScrollEnd, { once: true });
    document.addEventListener("scrollend", onScrollEnd, { once: true });
    window.addEventListener("wheel", onUserInterrupt, {
      passive: true,
      once: true,
    });
    window.addEventListener("touchstart", onUserInterrupt, {
      passive: true,
      once: true,
    });
    maxLockTimer = window.setTimeout(onScrollEnd, SCROLL_LOCK_MAX_MS);
    if (!supportsScrollEnd()) {
      idleLockTimer = window.setTimeout(
        onScrollEnd,
        SCROLL_LOCK_NO_EVENT_FALLBACK_MS,
      );
    }
  };

  // Write phase only: callers compute railTargetLeft before invoking this to avoid
  // read -> write -> read layout thrashing in the same frame.
  const applyActive = (
    pair: ReleasePair,
    railTargetLeft: number | null,
    behavior: ScrollBehavior,
  ) => {
    if (activePair === pair) return;
    if (activePair) {
      activePair.chip.removeAttribute("aria-current");
    }
    if (pair.chip.getAttribute("aria-current") !== "location") {
      pair.chip.setAttribute("aria-current", "location");
    }
    activePair = pair;
    applyRailScroll(track, railTargetLeft, behavior);
  };

  const normalizeInitialActive = (pair: ReleasePair, syncRail: boolean) => {
    const railTargetLeft = syncRail
      ? computeRailTargetLeft(track, pair.chip)
      : null;
    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    for (const candidate of pairs) {
      if (candidate === pair) {
        if (candidate.chip.getAttribute("aria-current") !== "location") {
          candidate.chip.setAttribute("aria-current", "location");
        }
      } else if (candidate.chip.hasAttribute("aria-current")) {
        candidate.chip.removeAttribute("aria-current");
      }
    }
    activePair = pair;
    applyRailScroll(track, railTargetLeft, behavior);
  };

  const jumpTo = (id: string) => {
    const match = pairs.find((p) => p.id === id);
    if (!match) return;

    const reduced = prefersReducedMotion();
    const behavior: ScrollBehavior = reduced ? "auto" : "smooth";

    // Read layout first, then write DOM and start scroll.
    const offset = getStickyOffset();
    const rect = match.entry.getBoundingClientRect();
    const currentY = window.scrollY;
    const maxScrollY = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
    );
    const rawTarget = Math.max(0, Math.round(rect.top + currentY - offset));
    const targetTop =
      maxScrollY > 0 ? Math.min(maxScrollY, rawTarget) : rawTarget;
    const railTargetLeft = computeRailTargetLeft(track, match.chip);

    applyActive(match, railTargetLeft, behavior);

    if (!reduced && Math.abs(targetTop - currentY) > 1) {
      lockScrollUntilEnd(targetTop);
    } else {
      unlockScroll();
    }
    window.scrollTo({ top: targetTop, behavior });

    try {
      const nextUrl = `${window.location.pathname}${window.location.search}#${match.id}`;
      window.history.replaceState(null, "", nextUrl);
    } catch {
      // History update can be restricted in sandboxed contexts.
    }
  };

  const readActivePairFromScroll = (): ReleasePair => {
    const threshold = getStickyOffset() + 24;
    const doc = document.documentElement;
    const atBottom =
      doc.scrollHeight > window.innerHeight &&
      window.scrollY + window.innerHeight >= doc.scrollHeight - 4;

    if (atBottom) {
      return pairs[pairs.length - 1];
    }

    let current = pairs[0];
    for (const pair of pairs) {
      const top = pair.entry.getBoundingClientRect().top;
      if (top <= threshold) {
        current = pair;
      } else {
        break;
      }
    }
    return current;
  };

  const updateFromScroll = () => {
    rafId = 0;
    if (scrollLocked) return;

    const current = readActivePairFromScroll();
    if (current === activePair) return;

    // Read rail geometry before mutating aria-current so layout is read at most once per frame.
    const railTargetLeft = computeRailTargetLeft(track, current.chip);
    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    applyActive(current, railTargetLeft, behavior);
  };

  const scheduleScrollSync = () => {
    if (scrollLocked) {
      if (!supportsScrollEnd()) {
        if (idleLockTimer !== null) {
          window.clearTimeout(idleLockTimer);
        }
        idleLockTimer = window.setTimeout(onScrollEnd, SCROLL_LOCK_IDLE_MS);
      }
      return;
    }
    if (rafId !== 0) return;
    rafId = window.requestAnimationFrame(updateFromScroll);
  };

  const handleResize = () => {
    cachedStickyOffset = null;
    scheduleScrollSync();
  };

  for (let i = 0; i < pairs.length; i += 1) {
    const pair = pairs[i];
    pair.chip.addEventListener("click", (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      jumpTo(pair.id);
    });

    pair.chip.addEventListener("keydown", (event) => {
      const focusPair = (target: ReleasePair) => {
        const railTargetLeft = computeRailTargetLeft(track, target.chip);
        target.chip.focus();
        applyRailScroll(
          track,
          railTargetLeft,
          prefersReducedMotion() ? "auto" : "smooth",
        );
      };

      if (event.key === "ArrowRight") {
        event.preventDefault();
        focusPair(pairs[(i + 1) % pairs.length]);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        focusPair(pairs[(i - 1 + pairs.length) % pairs.length]);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusPair(pairs[0]);
      } else if (event.key === "End") {
        event.preventDefault();
        focusPair(pairs[pairs.length - 1]);
      } else if (event.key === " ") {
        event.preventDefault();
        jumpTo(pair.id);
      }
    });
  }

  // Sync initial active chip from URL hash or current scroll position.
  const initialHash = window.location.hash.replace(/^#/u, "");
  const hashPair = initialHash
    ? pairs.find((p) => p.id === initialHash)
    : undefined;
  if (hashPair) {
    normalizeInitialActive(hashPair, true);
  } else {
    normalizeInitialActive(readActivePairFromScroll(), false);
  }

  window.addEventListener("scroll", scheduleScrollSync, { passive: true });
  window.addEventListener("resize", handleResize, { passive: true });

  return () => {
    unlockScroll();
    if (rafId !== 0) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    window.removeEventListener("scroll", scheduleScrollSync);
    window.removeEventListener("resize", handleResize);
  };
}

export function initChangelog(): void {
  initShell();
  initReleaseRuler();
}

if (
  typeof window !== "undefined" &&
  !("__SITE_ISLAND_MANUAL_INIT__" in window)
) {
  initChangelog();
}

// Interactive vanilla island for /changelog (C09):
// - Chip click scrolls to the matching release entry and marks aria-current="location"
// - Scroll position updates the marked chip and keeps it visible in the horizontal rail
// - Keyboard navigation across chips (ArrowLeft, ArrowRight, Home, End, Space, Enter)
// - Respects prefers-reduced-motion (never uses smooth scroll when reduced motion is active)
import { initShell } from "./shell";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

function getStickyOffset(): number {
  const header = document.querySelector<HTMLElement>(".site-header");
  const ruler = document.querySelector<HTMLElement>("[data-release-ruler]");
  const headerH = header ? header.getBoundingClientRect().height : 73;
  const rulerH = ruler ? ruler.getBoundingClientRect().height : 0;
  return Math.round(headerH + rulerH + 16);
}

function scrollChipIntoRail(
  track: HTMLElement | null,
  chip: HTMLElement,
  behavior: ScrollBehavior,
): void {
  if (!track) return;
  if (track.scrollWidth <= track.clientWidth) return;
  const trackRect = track.getBoundingClientRect();
  const chipRect = chip.getBoundingClientRect();
  const targetLeft =
    track.scrollLeft +
    (chipRect.left - trackRect.left) -
    (trackRect.width - chipRect.width) / 2;
  const clamped = Math.max(
    0,
    Math.min(track.scrollWidth - track.clientWidth, Math.round(targetLeft)),
  );
  if (typeof track.scrollTo === "function") {
    track.scrollTo({ left: clamped, behavior });
  } else {
    track.scrollLeft = clamped;
  }
}

export function initReleaseRuler(): void {
  const ruler = document.querySelector<HTMLElement>("[data-release-ruler]");
  if (!ruler) return;

  const track = ruler.querySelector<HTMLElement>("[data-release-ruler-track]");
  const chips = Array.from(
    ruler.querySelectorAll<HTMLAnchorElement>("[data-release-chip]"),
  );
  if (chips.length === 0) return;

  const pairs = chips
    .map((chip) => {
      const id = chip.getAttribute("data-release-chip") ?? "";
      const entry = id ? document.getElementById(id) : null;
      return entry ? { id, chip, entry } : null;
    })
    .filter(
      (
        item,
      ): item is { id: string; chip: HTMLAnchorElement; entry: HTMLElement } =>
        item !== null,
    );
  if (pairs.length === 0) return;

  let activeId = pairs[0].id;
  let lockUntil = 0;
  let rafId = 0;

  const setActive = (id: string, syncRail: boolean) => {
    if (activeId === id) {
      // Still ensure aria-current matches in case initial DOM differed.
      for (const pair of pairs) {
        if (pair.id === id) {
          pair.chip.setAttribute("aria-current", "location");
        } else {
          pair.chip.removeAttribute("aria-current");
        }
      }
      return;
    }
    activeId = id;
    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    for (const pair of pairs) {
      if (pair.id === id) {
        pair.chip.setAttribute("aria-current", "location");
        if (syncRail) {
          scrollChipIntoRail(track, pair.chip, behavior);
        }
      } else {
        pair.chip.removeAttribute("aria-current");
      }
    }
  };

  const jumpTo = (id: string) => {
    const match = pairs.find((p) => p.id === id);
    if (!match) return;

    const reduced = prefersReducedMotion();
    const behavior: ScrollBehavior = reduced ? "auto" : "smooth";

    setActive(match.id, true);

    const offset = getStickyOffset();
    const rect = match.entry.getBoundingClientRect();
    const targetTop = Math.max(
      0,
      Math.round(rect.top + window.scrollY - offset),
    );

    lockUntil = reduced ? 0 : performance.now() + 650;
    window.scrollTo({ top: targetTop, behavior });

    try {
      const nextUrl = `${window.location.pathname}${window.location.search}#${match.id}`;
      window.history.replaceState(null, "", nextUrl);
    } catch {
      // History update can be restricted in sandboxed contexts.
    }
  };

  const updateFromScroll = () => {
    rafId = 0;
    if (performance.now() < lockUntil) return;

    const threshold = getStickyOffset() + 24;
    const doc = document.documentElement;
    const atBottom =
      doc.scrollHeight > window.innerHeight &&
      window.scrollY + window.innerHeight >= doc.scrollHeight - 4;

    if (atBottom) {
      setActive(pairs[pairs.length - 1].id, true);
      return;
    }

    let current = pairs[0].id;
    for (const pair of pairs) {
      const top = pair.entry.getBoundingClientRect().top;
      if (top <= threshold) {
        current = pair.id;
      } else {
        break;
      }
    }
    setActive(current, true);
  };

  const scheduleScrollSync = () => {
    if (rafId !== 0) return;
    rafId = window.requestAnimationFrame(updateFromScroll);
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
      if (event.key === "ArrowRight") {
        event.preventDefault();
        const next = pairs[(i + 1) % pairs.length];
        next.chip.focus();
        scrollChipIntoRail(
          track,
          next.chip,
          prefersReducedMotion() ? "auto" : "smooth",
        );
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        const prev = pairs[(i - 1 + pairs.length) % pairs.length];
        prev.chip.focus();
        scrollChipIntoRail(
          track,
          prev.chip,
          prefersReducedMotion() ? "auto" : "smooth",
        );
      } else if (event.key === "Home") {
        event.preventDefault();
        const first = pairs[0];
        first.chip.focus();
        scrollChipIntoRail(
          track,
          first.chip,
          prefersReducedMotion() ? "auto" : "smooth",
        );
      } else if (event.key === "End") {
        event.preventDefault();
        const last = pairs[pairs.length - 1];
        last.chip.focus();
        scrollChipIntoRail(
          track,
          last.chip,
          prefersReducedMotion() ? "auto" : "smooth",
        );
      } else if (event.key === " ") {
        event.preventDefault();
        jumpTo(pair.id);
      }
    });
  }

  // Sync initial active chip from URL hash or current scroll position.
  const initialHash = window.location.hash.replace(/^#/u, "");
  if (initialHash && pairs.some((p) => p.id === initialHash)) {
    setActive(initialHash, true);
  } else {
    updateFromScroll();
  }

  window.addEventListener("scroll", scheduleScrollSync, { passive: true });
  window.addEventListener("resize", scheduleScrollSync, { passive: true });
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

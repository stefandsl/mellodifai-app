// Shared showcase marquee island (32 px/s, opposite directions, zero per-frame layout reads,
// pauses on hover, focus, hidden tab, and prefers-reduced-motion, keyboard-only focus centering).

export const MARQUEE_SPEED_PX_PER_SEC = 32;
export const MARQUEE_FOCUS_INSET_PX = 8;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

export function watchReducedMotion(
  onChange: (reduced: boolean) => void,
): () => void {
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
    let pointerDown = false;
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
    const onPointerDown = () => {
      pointerDown = true;
    };
    const onPointerReset = () => {
      pointerDown = false;
    };
    const onFocusIn = (event: FocusEvent) => {
      focused = true;
      stop();
      const target = event.target as HTMLElement | null;
      if (!pointerDown && isKeyboardFocus(target)) {
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
    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("mousedown", onPointerDown);
    window.addEventListener("pointerup", onPointerReset);
    window.addEventListener("mouseup", onPointerReset);
    window.addEventListener("pointercancel", onPointerReset);
    window.addEventListener("blur", onPointerReset);
    window.addEventListener("keydown", onPointerReset);
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
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("pointerup", onPointerReset);
      window.removeEventListener("mouseup", onPointerReset);
      window.removeEventListener("pointercancel", onPointerReset);
      window.removeEventListener("blur", onPointerReset);
      window.removeEventListener("keydown", onPointerReset);
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

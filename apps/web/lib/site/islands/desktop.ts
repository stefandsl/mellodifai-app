// Interactive island for the desktop app page (/desktop):
// shared shell, client-side platform detection (Windows / macOS / Linux),
// showcase marquee (32 px/s, keyboard-safe, pauses on hover/focus/hidden/reduced-motion),
// and exclusive FAQ accordion.
import {
  DEFAULT_DESKTOP_PLATFORM,
  type DesktopCtaLabels,
  type DesktopPlatformId,
  detectMatchedDesktopPlatform,
  type NavigatorPlatformHints,
  resolveDesktopCta,
} from "../downloads";
import { initFaq } from "./faq";
import {
  initShowcaseMarquee,
  MARQUEE_FOCUS_INSET_PX,
  MARQUEE_SPEED_PX_PER_SEC,
} from "./marquee";
import { initShell } from "./shell";

export { MARQUEE_FOCUS_INSET_PX, MARQUEE_SPEED_PX_PER_SEC };

export type DesktopInitOptions = {
  navigator?: NavigatorPlatformHints | null;
};

function readDesktopData(): DesktopCtaLabels | null {
  const el = document.getElementById("site-desktop-data");
  if (!el?.textContent) return null;
  try {
    const parsed = JSON.parse(el.textContent) as Partial<DesktopCtaLabels>;
    if (parsed.ctaLabel && parsed.heroNote) {
      return {
        ctaLabel: parsed.ctaLabel,
        heroNote: parsed.heroNote,
      };
    }
  } catch {
    // Ignore malformed payload.
  }
  return null;
}

function setButtonLinkLabel(anchor: HTMLAnchorElement, label: string): void {
  const labelSpan = anchor.querySelector<HTMLElement>(
    '[data-site-button-label="true"]',
  );
  if (labelSpan) {
    labelSpan.textContent = label;
  } else {
    anchor.textContent = label;
  }
  if (anchor.hasAttribute("aria-label")) {
    anchor.setAttribute("aria-label", label);
  }
}

export function initDesktopPlatform(
  navOverride?: NavigatorPlatformHints | null,
): DesktopPlatformId {
  const matched = detectMatchedDesktopPlatform(navOverride);
  const platform = matched ?? DEFAULT_DESKTOP_PLATFORM;
  const data = readDesktopData();
  if (!data) return platform;

  const cta = resolveDesktopCta(platform, data);

  const buttons = document.querySelectorAll<HTMLAnchorElement>(
    'a[data-desktop-download-cta="true"]',
  );
  for (const btn of buttons) {
    btn.setAttribute("href", cta.href);
    if (cta.external) {
      btn.setAttribute("rel", "noopener noreferrer");
    } else {
      btn.removeAttribute("rel");
    }
    btn.setAttribute("data-detected-platform", cta.platform);
    btn.setAttribute("data-platform-status", cta.status);
    setButtonLinkLabel(btn, cta.label);
  }

  const note = document.querySelector<HTMLElement>(
    '[data-desktop-platform-note="true"]',
  );
  if (note) {
    note.textContent = cta.note;
  }

  const rows = document.querySelectorAll<HTMLElement>("[data-platform-row]");
  for (const row of rows) {
    const rowId = row.getAttribute("data-platform-row");
    const isCurrent = matched !== null && rowId === matched;
    row.setAttribute("data-current-platform", String(isCurrent));
    const badge = row.querySelector<HTMLElement>(
      "[data-platform-current-badge]",
    );
    if (badge) {
      badge.hidden = !isCurrent;
    }
  }

  return platform;
}

export function initDesktop(options?: DesktopInitOptions): () => void {
  initShell();
  initDesktopPlatform(options?.navigator);
  const stopMarquee = initShowcaseMarquee();
  const stopFaq = initFaq();
  return () => {
    stopMarquee();
    stopFaq();
  };
}

if (
  typeof window !== "undefined" &&
  !("__SITE_ISLAND_MANUAL_INIT__" in window)
) {
  initDesktop();
}

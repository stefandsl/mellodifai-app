// Single source of truth for MellodifAI desktop app platforms and their real release state.
// Verified against the repository (apps/windows, docs/windows-app.md) and GitHub Releases
// (stefandsl/mellodifai-app currently publishes 0 hosted release binaries).
// A platform without a real package MUST stay `status: "planned"` with `downloadUrl: null`.

export const DESKTOP_PLATFORMS = ["windows", "macos", "linux"] as const;
export type DesktopPlatformId = (typeof DESKTOP_PLATFORMS)[number];

export type DesktopPlatformStatus = "release" | "source" | "planned";

export type DesktopPlatformSpec = {
  id: DesktopPlatformId;
  /** Real status of the desktop package in this repository. */
  status: DesktopPlatformStatus;
  /** Minimum OS / architecture requirement shown in the platform table. */
  requirement: string;
  /** Package artifact format or build target. */
  packageKind: string;
  /** Build command in the repo when built from source, else null. */
  buildCommand: string | null;
  /**
   * Real release asset URL or official install guide URL (must answer 200/302).
   * Always null when status is "planned".
   */
  downloadUrl: string | null;
  /** Whether downloadUrl is an external URL (opens with rel="noopener noreferrer"). */
  external: boolean;
  /** Browser studio fallback route when no package exists yet. */
  browserHref: string;
};

/**
 * Real public documentation URL for the Windows NSIS installer in this repository.
 * Verified HTTP 200 on github.com/stefandsl/mellodifai-app.
 * Update to the published GitHub Release asset URL once a release is cut.
 */
export const WINDOWS_INSTALLER_GUIDE_URL =
  "https://github.com/stefandsl/mellodifai-app/blob/main/docs/windows-app.md";

export const DEFAULT_DESKTOP_PLATFORM: DesktopPlatformId = "windows";

export const DESKTOP_DOWNLOADS: Record<DesktopPlatformId, DesktopPlatformSpec> =
  {
    windows: {
      id: "windows",
      status: "source",
      requirement: "Windows 10 / 11 (x64)",
      packageKind: "NSIS installer (MellodifAI-Setup-<version>.exe)",
      buildCommand: "pnpm --filter @mellodifai/windows build:installer",
      downloadUrl: WINDOWS_INSTALLER_GUIDE_URL,
      external: true,
      browserHref: "/create",
    },
    macos: {
      id: "macos",
      status: "planned",
      requirement: "macOS (Apple Silicon & Intel)",
      packageKind: "Planned",
      buildCommand: null,
      downloadUrl: null,
      external: false,
      browserHref: "/create",
    },
    linux: {
      id: "linux",
      status: "planned",
      requirement: "Linux (x64 & ARM64)",
      packageKind: "Planned",
      buildCommand: null,
      downloadUrl: null,
      external: false,
      browserHref: "/create",
    },
  };

export const DESKTOP_PLATFORM_LIST: readonly DesktopPlatformSpec[] =
  DESKTOP_PLATFORMS.map((id) => DESKTOP_DOWNLOADS[id]);

export type NavigatorPlatformHints = {
  userAgentData?: { platform?: string } | null;
  platform?: string;
  userAgent?: string;
};

const MOBILE_HINT_RE = /(?:android|iphone|ipad|ipod|ios)/u;

function matchPlatformHint(raw: string): DesktopPlatformId | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (MOBILE_HINT_RE.test(s)) return null;
  if (/(?:win32|win64|windows|wow64|\bwin\b)/u.test(s)) return "windows";
  if (
    /(?:macintel|macppc|mac68k|macos|mac os|macintosh|darwin|\bmac\b)/u.test(s)
  ) {
    return "macos";
  }
  if (/(?:linux|x11|ubuntu|fedora|debian|arch|cros)/u.test(s)) return "linux";
  return null;
}

/**
 * Detects the visitor's desktop platform on the client from Navigator User-Agent Client Hints,
 * falling back to navigator.platform and navigator.userAgent.
 * Returns null for mobile OSes (e.g. Android with platform "Linux armv8l") or when no real
 * desktop platform hint matched.
 */
export function detectMatchedDesktopPlatform(
  nav?: NavigatorPlatformHints | null,
): DesktopPlatformId | null {
  const source: NavigatorPlatformHints | null =
    nav !== undefined
      ? nav
      : typeof navigator !== "undefined"
        ? (navigator as NavigatorPlatformHints)
        : null;

  if (!source) return null;

  const candidates = [
    source.userAgentData?.platform ?? "",
    source.platform ?? "",
    source.userAgent ?? "",
  ];

  // Mobile OSes (e.g. Android with platform "Linux armv8l") do not match any desktop platform.
  if (candidates.some((hint) => MOBILE_HINT_RE.test(hint.toLowerCase()))) {
    return null;
  }

  for (const hint of candidates) {
    const matched = matchPlatformHint(hint);
    if (matched) return matched;
  }

  return null;
}

/**
 * Detects the visitor's desktop platform with a safe default ("windows") for CTA fallback.
 */
export function detectDesktopPlatform(
  nav?: NavigatorPlatformHints | null,
): DesktopPlatformId {
  return detectMatchedDesktopPlatform(nav) ?? DEFAULT_DESKTOP_PLATFORM;
}

export type DesktopCtaLabels = {
  ctaLabel: Record<DesktopPlatformId, string>;
  heroNote: Record<DesktopPlatformId, string>;
};

export type ResolvedDesktopCta = {
  platform: DesktopPlatformId;
  status: DesktopPlatformStatus;
  label: string;
  note: string;
  href: string;
  external: boolean;
};

/**
 * Resolves the honest primary CTA target and label for a detected platform.
 * Platforms with a real URL link to it; planned platforms point to #platforms (never a dead link).
 */
export function resolveDesktopCta(
  platform: DesktopPlatformId,
  labels: DesktopCtaLabels,
): ResolvedDesktopCta {
  const spec = DESKTOP_DOWNLOADS[platform];
  if (spec.downloadUrl) {
    return {
      platform,
      status: spec.status,
      label: labels.ctaLabel[platform],
      note: labels.heroNote[platform],
      href: spec.downloadUrl,
      external: spec.external,
    };
  }
  return {
    platform,
    status: spec.status,
    label: labels.ctaLabel[platform],
    note: labels.heroNote[platform],
    href: "#platforms",
    external: false,
  };
}

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { SITE_COPY } from "./copy";
import {
  DEFAULT_DESKTOP_PLATFORM,
  DESKTOP_DOWNLOADS,
  DESKTOP_PLATFORM_LIST,
  DESKTOP_PLATFORMS,
  detectDesktopPlatform,
  resolveDesktopCta,
  WINDOWS_INSTALLER_GUIDE_URL,
} from "./downloads";

describe("desktop downloads catalog (single source of truth)", () => {
  it("lists Windows, macOS, and Linux with honest release states and no invented binary URLs", () => {
    expect(DESKTOP_PLATFORMS).toEqual(["windows", "macos", "linux"]);
    expect(DESKTOP_PLATFORM_LIST.map((p) => p.id)).toEqual([
      "windows",
      "macos",
      "linux",
    ]);

    // Windows: real NSIS installer exists in apps/windows + docs/windows-app.md,
    // zero hosted GitHub releases yet, so it points to the real guide page.
    const win = DESKTOP_DOWNLOADS.windows;
    expect(win.status).toBe("source");
    expect(win.downloadUrl).toBe(WINDOWS_INSTALLER_GUIDE_URL);
    expect(win.external).toBe(true);
    expect(win.buildCommand).toContain("build:installer");
    expect(win.downloadUrl).not.toMatch(/releases\/download\//u);

    // macOS and Linux: no real packages exist yet -> strictly "planned" with null downloadUrl.
    for (const id of ["macos", "linux"] as const) {
      const spec = DESKTOP_DOWNLOADS[id];
      expect(spec.status, id).toBe("planned");
      expect(spec.downloadUrl, id).toBeNull();
      expect(spec.buildCommand, id).toBeNull();
      expect(spec.browserHref, id).toBe("/create");
    }
  });

  it("detects Windows, macOS, and Linux from userAgentData, platform, and userAgent with safe default", () => {
    // Modern Client Hints take precedence.
    expect(
      detectDesktopPlatform({
        userAgentData: { platform: "Windows" },
        platform: "MacIntel",
      }),
    ).toBe("windows");
    expect(
      detectDesktopPlatform({
        userAgentData: { platform: "macOS" },
        platform: "Win32",
      }),
    ).toBe("macos");
    expect(
      detectDesktopPlatform({
        userAgentData: { platform: "Linux" },
        platform: "Win32",
      }),
    ).toBe("linux");

    // Fallback to navigator.platform (Firefox / Safari / WebKit).
    expect(detectDesktopPlatform({ platform: "Win32" })).toBe("windows");
    expect(detectDesktopPlatform({ platform: "MacIntel" })).toBe("macos");
    expect(detectDesktopPlatform({ platform: "Linux x86_64" })).toBe("linux");

    // Fallback to userAgent when platform is empty.
    expect(
      detectDesktopPlatform({
        platform: "",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      }),
    ).toBe("windows");
    expect(
      detectDesktopPlatform({
        platform: "",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      }),
    ).toBe("macos");
    expect(
      detectDesktopPlatform({
        platform: "",
        userAgent: "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:130.0)",
      }),
    ).toBe("linux");

    // Mobile OSes and unknown values fall back to safe default (windows).
    expect(
      detectDesktopPlatform({
        userAgentData: { platform: "Android" },
        platform: "Linux armv8l",
        userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)",
      }),
    ).toBe(DEFAULT_DESKTOP_PLATFORM);
    expect(
      detectDesktopPlatform({
        platform: "iPhone",
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      }),
    ).toBe(DEFAULT_DESKTOP_PLATFORM);
    expect(detectDesktopPlatform({})).toBe(DEFAULT_DESKTOP_PLATFORM);
    expect(detectDesktopPlatform(null)).toBe(DEFAULT_DESKTOP_PLATFORM);
  });

  it("resolves honest CTA hrefs and labels for every platform in EN and IT", () => {
    for (const lang of ["en", "it"] as const) {
      const d = SITE_COPY[lang].desktop;

      const winCta = resolveDesktopCta("windows", d);
      expect(winCta.href).toBe(WINDOWS_INSTALLER_GUIDE_URL);
      expect(winCta.external).toBe(true);
      expect(winCta.status).toBe("source");
      expect(winCta.label).toBe(d.ctaLabel.windows);

      for (const plannedId of ["macos", "linux"] as const) {
        const cta = resolveDesktopCta(plannedId, d);
        expect(cta.href, `${lang}:${plannedId}`).toBe("#platforms");
        expect(cta.external, `${lang}:${plannedId}`).toBe(false);
        expect(cta.status, `${lang}:${plannedId}`).toBe("planned");
        expect(cta.label, `${lang}:${plannedId}`).toBe(d.ctaLabel[plannedId]);
        expect(cta.note, `${lang}:${plannedId}`).toBe(d.heroNote[plannedId]);
      }
    }
  });
});

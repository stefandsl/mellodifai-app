// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SITE_COPY } from "./copy";
import {
  DEFAULT_DESKTOP_PLATFORM,
  DESKTOP_DOWNLOADS,
  DESKTOP_PLATFORM_LIST,
  DESKTOP_PLATFORMS,
  detectDesktopPlatform,
  detectMatchedDesktopPlatform,
  resolveDesktopCta,
  WINDOWS_INSTALLER_GUIDE_URL,
} from "./downloads";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

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

    // Mobile OSes and unknown values fall back to safe default (windows) for CTAs,
    // while detectMatchedDesktopPlatform returns null so no false "Your system" badge is shown.
    const androidHints = {
      userAgentData: { platform: "Android" },
      platform: "Linux armv8l",
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)",
    };
    const iphoneHints = {
      platform: "iPhone",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    };
    expect(detectDesktopPlatform(androidHints)).toBe(DEFAULT_DESKTOP_PLATFORM);
    expect(detectDesktopPlatform(iphoneHints)).toBe(DEFAULT_DESKTOP_PLATFORM);
    expect(detectDesktopPlatform({})).toBe(DEFAULT_DESKTOP_PLATFORM);
    expect(detectDesktopPlatform(null)).toBe(DEFAULT_DESKTOP_PLATFORM);

    expect(detectMatchedDesktopPlatform({ platform: "Win32" })).toBe("windows");
    expect(detectMatchedDesktopPlatform({ platform: "MacIntel" })).toBe(
      "macos",
    );
    expect(detectMatchedDesktopPlatform({ platform: "Linux x86_64" })).toBe(
      "linux",
    );
    expect(detectMatchedDesktopPlatform(androidHints)).toBeNull();
    expect(detectMatchedDesktopPlatform(iphoneHints)).toBeNull();
    expect(detectMatchedDesktopPlatform({})).toBeNull();
    expect(detectMatchedDesktopPlatform(null)).toBeNull();
  });

  it("points WINDOWS_INSTALLER_GUIDE_URL to a real documentation file in this repository", () => {
    const match = WINDOWS_INSTALLER_GUIDE_URL.match(
      /^https:\/\/github\.com\/stefandsl\/mellodifai-app\/blob\/main\/(.+)$/u,
    );
    expect(match).not.toBeNull();
    const relPath = match?.[1] ?? "";
    const absPath = resolve(REPO_ROOT, relPath);
    expect(existsSync(absPath), `${relPath} must exist in the repo`).toBe(true);
    const content = readFileSync(absPath, "utf8");
    expect(content).toContain("build:installer");
    expect(content).toContain("apps/windows");
  });

  it("keeps e2e/site/layout-ref/desktop.json grounded in desktop study measures with an explicit repairs list", () => {
    const refPath = resolve(
      REPO_ROOT,
      "apps/web/e2e/site/layout-ref/desktop.json",
    );
    const ref = JSON.parse(readFileSync(refPath, "utf8")) as {
      repairs?: Array<{
        width: number;
        section: number;
        field: string;
        source: string;
        reason?: string;
      }>;
      widths: Record<
        string,
        {
          sections: Array<{
            present: boolean;
            reason?: string;
            blocks?: number;
            contentLeft?: number;
            contentRight?: number;
            grid?: {
              items: number;
              perRow: number;
              colGap: number;
              rowGap: number;
              itemW: number;
              x: number;
              w: number;
            } | null;
          }>;
        }
      >;
    };

    expect(Array.isArray(ref.repairs)).toBe(true);
    expect(ref.repairs?.length).toBeGreaterThanOrEqual(10);
    for (const r of ref.repairs ?? []) {
      expect(r.source).toMatch(/^pages\/desktop\/outline-(390|1024)\.json$/u);
    }

    // 390 #8 Closing band stays present: false with reason (no desktop study measure).
    expect(ref.widths["390"].sections[8].present).toBe(false);
    expect(ref.widths["390"].sections[8].reason).toBeTruthy();

    // 390 #2 keeps its desktop study grid and blocks=3.
    expect(ref.widths["390"].sections[2].blocks).toBe(3);
    expect(ref.widths["390"].sections[2].grid).toEqual({
      items: 2,
      perRow: 1,
      colGap: 48,
      rowGap: 48,
      itemW: 358,
      x: 16,
      w: 358,
    });

    // 390 #4 Showcase uses desktop outline container x=16 + padX=8 -> 24 (matching 1024 and 1440).
    expect(ref.widths["390"].sections[4].contentLeft).toBe(24);
    expect(ref.widths["390"].sections[4].contentRight).toBe(24);
    const showcase390Repair = ref.repairs?.find(
      (r) =>
        r.width === 390 && r.section === 4 && r.field.includes("contentLeft"),
    );
    expect(showcase390Repair?.reason).toContain("padX");

    // 1024 #7 Own agents grid uses the outer stack consistently (itemW 862, colGap/rowGap 60),
    // with every repaired field recorded in repairs.
    expect(ref.widths["1024"].sections[7].grid).toEqual({
      items: 2,
      perRow: 1,
      colGap: 60,
      rowGap: 60,
      itemW: 862,
      x: 81,
      w: 862,
    });
    const repaired1024Sec7Fields = (ref.repairs ?? [])
      .filter((r) => r.width === 1024 && r.section === 7)
      .map((r) => r.field);
    expect(repaired1024Sec7Fields).toEqual(
      expect.arrayContaining(["grid.itemW", "grid.colGap", "grid.rowGap"]),
    );

    // Study blocks values preserved.
    expect(ref.widths["390"].sections[6].blocks).toBe(4);
    expect(ref.widths["390"].sections[7].blocks).toBe(2);
    expect(ref.widths["1024"].sections[2].blocks).toBe(2);
    expect(ref.widths["1024"].sections[7].blocks).toBe(2);
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

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(import.meta.dirname, "../..");

describe("public site has its own root layout", () => {
  it("splits (site) and (studio) into two root layouts without a shared app/layout.tsx", () => {
    expect(existsSync(join(WEB, "app/layout.tsx"))).toBe(false);
    expect(existsSync(join(WEB, "app/(studio)/layout.tsx"))).toBe(true);
    const siteLayout = readFileSync(join(WEB, "app/(site)/layout.tsx"), "utf8");
    expect(siteLayout).toContain("<html");
    expect(siteLayout).toContain("<body");
    expect(siteLayout).not.toContain("globals.css");
    expect(siteLayout).not.toContain("Toaster");
    expect(siteLayout).not.toContain("LocaleProvider");
    expect(siteLayout).not.toContain("THEME_SCRIPT");
    expect(siteLayout).not.toContain("GLASS_SCRIPT");
  });

  it("keeps the studio root layout with Tailwind, Toaster, LocaleProvider and bootstrap scripts", () => {
    const studioLayout = readFileSync(
      join(WEB, "app/(studio)/layout.tsx"),
      "utf8",
    );
    expect(studioLayout).toContain("../globals.css");
    expect(studioLayout).toContain("Toaster");
    expect(studioLayout).toContain("LocaleProvider");
    expect(studioLayout).toContain("THEME_SCRIPT");
    expect(studioLayout).toContain("GLASS_SCRIPT");
  });
});

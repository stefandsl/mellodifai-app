import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(import.meta.dirname, "../..");

describe("public site has its own document shell separate from studio", () => {
  it("keeps (site) static documents free of studio globals, Toaster, LocaleProvider and bootstrap scripts", () => {
    expect(existsSync(join(WEB, "app/layout.tsx"))).toBe(false);
    expect(existsSync(join(WEB, "app/(site)/layout.tsx"))).toBe(false);
    expect(existsSync(join(WEB, "app/(studio)/layout.tsx"))).toBe(true);
    for (const rel of [
      "app/(site)/route.ts",
      "app/(site)/pricing/route.ts",
      "app/(site)/recipes/route.ts",
    ]) {
      expect(existsSync(join(WEB, rel)), `${rel} exists`).toBe(true);
    }
    const staticEntry = readFileSync(
      join(WEB, "lib/site/render-static-entry.tsx"),
      "utf8",
    );
    expect(staticEntry).toContain("<html");
    expect(staticEntry).toContain("<body");
    expect(staticEntry).not.toContain("globals.css");
    expect(staticEntry).not.toContain("Toaster");
    expect(staticEntry).not.toContain("LocaleProvider");
    expect(staticEntry).not.toContain("THEME_SCRIPT");
    expect(staticEntry).not.toContain("GLASS_SCRIPT");
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

  it("defines a global 404 document with lang, the site look and a link home for unknown URLs", () => {
    const config = readFileSync(join(WEB, "next.config.ts"), "utf8");
    expect(config).toContain("globalNotFound: true");
    const notFoundPath = join(WEB, "app/global-not-found.tsx");
    expect(existsSync(notFoundPath)).toBe(true);
    const src = readFileSync(notFoundPath, "utf8");
    expect(src).toContain("<html");
    expect(src).toContain("lang=");
    expect(src).toContain('data-astryx-theme="mesh"');
    expect(src).toContain("site-astryx.css");
    expect(src).not.toContain("globals.css");
    expect(src).toContain('href="/"');
  });
});

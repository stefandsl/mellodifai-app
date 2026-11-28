// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SiteLang } from "./copy";
import { renderNotFoundStatic } from "./render-static-entry";

let mockLocale: SiteLang = "en";
vi.mock("@/lib/locale", () => ({
  getLocale: async () => mockLocale,
}));
vi.mock("@/components/site/site-theme", () => ({
  SiteThemeSync: () => null,
}));

const { default: GlobalNotFound } = await import("@/app/global-not-found");

const WEB = join(import.meta.dirname, "../..");

function extractVisibleText(html: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/u);
  const body = bodyMatch ? bodyMatch[1] : html;
  return body
    .replaceAll(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/giu, " ")
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

describe("public site has its own document shell separate from studio", () => {
  it("keeps (site) static documents free of studio globals, Toaster, LocaleProvider and bootstrap scripts", () => {
    expect(existsSync(join(WEB, "app/layout.tsx"))).toBe(false);
    expect(existsSync(join(WEB, "app/(site)/layout.tsx"))).toBe(false);
    expect(existsSync(join(WEB, "app/(studio)/layout.tsx"))).toBe(true);
    for (const rel of [
      "app/(site)/route.ts",
      "app/(site)/pricing/route.ts",
      "app/(site)/changelog/route.ts",
      "app/(site)/agents/route.ts",
      "app/(site)/recipes/route.ts",
      "app/(site)/recipes/[slug]/route.ts",
      "app/(site)/recipes/[slug]/try/route.ts",
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

  it("defines a global 404 document and static 404 from the same shared NotFoundBody source", async () => {
    const config = readFileSync(join(WEB, "next.config.ts"), "utf8");
    expect(config).toContain("globalNotFound: true");
    const notFoundPath = join(WEB, "app/global-not-found.tsx");
    const bodyPath = join(WEB, "components/site/not-found-body.tsx");
    const staticEntryPath = join(WEB, "lib/site/render-static-entry.tsx");
    expect(existsSync(notFoundPath)).toBe(true);
    expect(existsSync(bodyPath)).toBe(true);
    const src = readFileSync(notFoundPath, "utf8");
    const bodySrc = readFileSync(bodyPath, "utf8");
    const staticEntrySrc = readFileSync(staticEntryPath, "utf8");
    expect(src).toContain("<html");
    expect(src).toContain("lang=");
    expect(src).toContain('data-astryx-theme="mesh"');
    expect(src).toContain("site-astryx.css");
    expect(src).not.toContain("globals.css");
    expect(src).toContain("<NotFoundBody");
    expect(staticEntrySrc).toContain("<NotFoundBody");
    expect(bodySrc).toContain('href="/"');

    for (const lang of ["en", "it"] as const) {
      mockLocale = lang;
      const globalHtml = renderToStaticMarkup(await GlobalNotFound());
      const staticHtml = renderNotFoundStatic(lang).html;
      expect(extractVisibleText(staticHtml), `${lang} 404 text`).toBe(
        extractVisibleText(globalHtml),
      );
    }
  });
});

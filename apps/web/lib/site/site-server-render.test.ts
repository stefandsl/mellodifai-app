// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderHomeStatic } from "./render-static-entry";

const WEB = join(import.meta.dirname, "../..");

const STATIC_FILES = [
  "app/(site)/route.ts",
  "app/(site)/pricing/route.ts",
  "app/(site)/desktop/route.ts",
  "app/(site)/recipes/route.ts",
  "app/(site)/recipes/[slug]/route.ts",
  "app/(site)/recipes/[slug]/try/route.ts",
  "components/site/home.tsx",
  "components/site/shared-sections.tsx",
  "components/site/desktop-page.tsx",
  "components/site/platform-table.tsx",
  "components/site/not-found-body.tsx",
  "components/site/site-footer.tsx",
  "components/site/brand.tsx",
  "components/site/site-header.tsx",
  "components/site/compare-table.tsx",
  "components/site/plan-card.tsx",
  "components/site/pricing-plans.tsx",
  "components/site/recipe-detail.tsx",
  "components/site/clip-player.tsx",
  "components/site/inputs-list.tsx",
  "components/site/card-row.tsx",
  "components/site/icons.tsx",
] as const;

const BANNED_CLIENT_PRIMITIVES = [
  "@astryxdesign/core/Text",
  "@astryxdesign/core/Heading",
  "@astryxdesign/core/Link",
  "@astryxdesign/core/Icon",
  "@astryxdesign/core/Table",
  "@astryxdesign/core/theme",
] as const;

describe("public site renders static parts on the server", () => {
  it("keeps static site modules free of 'use client' and client-only text/link/table/theme imports", () => {
    for (const rel of STATIC_FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, `${rel} should be a Server Component`).not.toMatch(
        /^\s*["']use client["']/mu,
      );
      for (const spec of [
        ...BANNED_CLIENT_PRIMITIVES,
        "@astryxdesign/core/TopNav",
        "@astryxdesign/core/Button",
      ]) {
        expect(src, `${rel} should not import ${spec}`).not.toContain(
          `"${spec}"`,
        );
      }
    }
  });

  it("removes client-only Text/Heading/Link/Icon/Table/Theme imports from all interactive site islands", () => {
    const islands = [
      "components/site/hero-composer.tsx",
      "components/site/feature-reel.tsx",
      "components/site/home-client.tsx",
      "components/site/site-menu.tsx",
      "components/site/site-theme.tsx",
      "components/site/faq.tsx",
    ];
    for (const rel of islands) {
      const src = readFileSync(join(WEB, rel), "utf8");
      for (const spec of BANNED_CLIENT_PRIMITIVES) {
        expect(src, `${rel} should not import ${spec}`).not.toContain(
          `"${spec}"`,
        );
      }
    }
  });

  it("keeps Astryx components for interactive controls", () => {
    const hero = readFileSync(
      join(WEB, "components/site/hero-composer.tsx"),
      "utf8",
    );
    expect(hero).toContain("@astryxdesign/core/Button");
    expect(hero).toContain("@astryxdesign/core/ToggleButton");

    const reel = readFileSync(
      join(WEB, "components/site/feature-reel.tsx"),
      "utf8",
    );
    expect(reel).toContain("@astryxdesign/core/ToggleButton");

    const segmented = readFileSync(
      join(WEB, "components/site/segmented.tsx"),
      "utf8",
    );
    expect(segmented).toContain("@astryxdesign/core/SegmentedControl");

    const menu = readFileSync(
      join(WEB, "components/site/site-menu.tsx"),
      "utf8",
    );
    expect(menu).toContain("@astryxdesign/core/Button");

    const faq = readFileSync(join(WEB, "components/site/faq.tsx"), "utf8");
    expect(faq).toContain("@astryxdesign/core/Button");

    const agents = readFileSync(
      join(WEB, "components/site/site-header-client.tsx"),
      "utf8",
    );
    expect(agents).toContain("@astryxdesign/core/TopNav");

    const home = readFileSync(join(WEB, "components/site/home.tsx"), "utf8");
    expect(home).toContain("@astryxdesign/core/Collapsible");
  });

  it("renders feature reel bullets without aria-current and exposes only slide 0 in SSR HTML", () => {
    const { html } = renderHomeStatic("en");

    const bulletTags = [
      ...html.matchAll(/<button\b[^>]*data-reel-bullet=[^>]*>/gu),
    ].map((m) => m[0]);
    expect(bulletTags).toHaveLength(9);
    for (const tag of bulletTags) {
      expect(tag).toContain("aria-pressed=");
      expect(tag).not.toContain("aria-current");
    }

    const slideTags = [
      ...html.matchAll(/<div\b[^>]*data-reel-slide="(\d+)"[^>]*>/gu),
    ];
    expect(slideTags).toHaveLength(9);
    for (const [tag, idx] of slideTags) {
      if (idx === "0") {
        expect(tag).not.toContain("aria-hidden");
      } else {
        expect(tag).toContain('aria-hidden="true"');
      }
    }
  });
});

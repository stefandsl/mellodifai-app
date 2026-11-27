// @vitest-environment node
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeSiteAstryxCss } from "../../scripts/build-site-astryx-css.mjs";
import {
  deriveHomeAstryxStateClasses,
  renderHomeStatic,
  renderPricingStatic,
} from "./render-static-entry";

const WEB = join(import.meta.dirname, "../..");

describe("public site loads only the Astryx CSS it uses", () => {
  it("prunes inline page CSS to used Astryx rules and excludes unused full-Astryx classes", () => {
    const fullAstryx = readFileSync(
      join(WEB, "node_modules/@astryxdesign/core/dist/astryx.css"),
      "utf8",
    );
    const { html: homeHtml } = renderHomeStatic("en");
    const { html: pricingHtml } = renderPricingStatic("en");

    const homeStyleMatch = homeHtml.match(/<style>([\s\S]*?)<\/style>/u);
    const pricingStyleMatch = pricingHtml.match(/<style>([\s\S]*?)<\/style>/u);
    expect(homeStyleMatch).not.toBeNull();
    expect(pricingStyleMatch).not.toBeNull();
    const homeCss = homeStyleMatch?.[1] ?? "";
    const pricingCss = pricingStyleMatch?.[1] ?? "";

    // Real pruned CSS is a small fraction of the 304 KB full astryx.css.
    expect(Buffer.byteLength(homeCss)).toBeLessThan(
      Buffer.byteLength(fullAstryx) * 0.25,
    );
    expect(Buffer.byteLength(pricingCss)).toBeLessThan(
      Buffer.byteLength(fullAstryx) * 0.3,
    );

    // Every derived Home state (pressed/unpressed toggle chips) has active rules in pruned CSS.
    const derived = deriveHomeAstryxStateClasses();
    for (const [label, classes] of [
      ["chipPressed", derived.chipPressed],
      ["chipUnpressed", derived.chipUnpressed],
    ] as const) {
      expect(classes.length, `${label} should derive classes`).toBeGreaterThan(
        0,
      );
      const presentInCss = classes.filter((cls) => homeCss.includes(`.${cls}`));
      expect(
        presentInCss.length,
        `${label} (${classes.join(", ")}) missing from pruned home CSS`,
      ).toBeGreaterThan(0);
    }

    // Home must not pull in pricing-only table CSS.
    expect(homeCss).not.toContain(".site-price-compare");
    expect(pricingCss).toContain(".site-price-compare");
  });

  it("does not hard-code StyleX class hashes in home.ts, recipe-detail.ts, or render-static-entry.tsx", () => {
    for (const rel of [
      "lib/site/islands/home.ts",
      "lib/site/islands/recipe-detail.ts",
      "lib/site/render-static-entry.tsx",
    ]) {
      const src = readFileSync(join(WEB, rel), "utf8");
      const hardcoded = [...src.matchAll(/["']x[0-9a-z]{6,7}["']/gu)].map(
        (m) => m[0],
      );
      expect(hardcoded, `${rel} has hardcoded StyleX hashes`).toEqual([]);
    }
  });

  it("keeps generated site Astryx CSS in sync with site imports and smaller than half of astryx.css", () => {
    const fullSize = statSync(
      join(WEB, "node_modules/@astryxdesign/core/dist/astryx.css"),
    ).size;
    const sharedPath = join(WEB, "src/site-astryx.css");
    const tablePath = join(WEB, "src/site-astryx-table.css");
    expect(existsSync(sharedPath)).toBe(true);
    expect(existsSync(tablePath)).toBe(true);
    const { sharedCss, tableCss } = computeSiteAstryxCss();
    expect(readFileSync(sharedPath, "utf8")).toBe(sharedCss);
    expect(readFileSync(tablePath, "utf8")).toBe(tableCss);
    expect(sharedCss).toContain("@layer reset");
    expect(Buffer.byteLength(sharedCss)).toBeLessThan(fullSize * 0.45);
  });

  it("throws listing missing class names when a copied class is absent from astryx.css", () => {
    expect(() =>
      computeSiteAstryxCss({
        extraTokens: { shared: ["xzz9999"] },
      }),
    ).toThrow(/xzz9999/u);
    expect(() =>
      computeSiteAstryxCss({
        extraTokens: { pricing: ["xzz8888"] },
      }),
    ).toThrow(/xzz8888/u);
  });

  it("verifies every x-class token in site primitives exists in astryx.css and in the emitted subset", () => {
    const astryxCss = readFileSync(
      join(WEB, "node_modules/@astryxdesign/core/dist/astryx.css"),
      "utf8",
    );
    const emittedCss =
      readFileSync(join(WEB, "src/site-astryx.css"), "utf8") +
      "\n" +
      readFileSync(join(WEB, "src/site-astryx-table.css"), "utf8");
    for (const rel of [
      "src/site-primitives.tsx",
      "src/site-table-primitives.tsx",
    ]) {
      const src = readFileSync(join(WEB, rel), "utf8");
      const tokens = [
        ...new Set([...src.matchAll(/\bx[0-9a-z]{5,7}\b/gu)].map((m) => m[0])),
      ];
      const missingInAstryx = tokens.filter(
        (t) => !new RegExp(`\\.${t}\\b`, "u").test(astryxCss),
      );
      const missingInSubset = tokens.filter(
        (t) => !new RegExp(`\\.${t}\\b`, "u").test(emittedCss),
      );
      expect(missingInAstryx, `${rel} missing in astryx.css`).toEqual([]);
      expect(missingInSubset, `${rel} missing in site subset CSS`).toEqual([]);
    }
  });
});

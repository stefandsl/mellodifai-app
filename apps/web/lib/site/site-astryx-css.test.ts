// @vitest-environment node
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeSiteAstryxCss } from "../../scripts/build-site-astryx-css.mjs";

const WEB = join(import.meta.dirname, "../..");

describe("public site loads only the Astryx CSS it uses", () => {
  it("does not import the full 304 KB @astryxdesign/core/astryx.css in the static site CSS pipeline", () => {
    const cssPipeline = readFileSync(
      join(WEB, "lib/site/site-static-css.ts"),
      "utf8",
    );
    expect(cssPipeline).not.toContain("@astryxdesign/core/astryx.css");
    expect(cssPipeline).not.toContain("@astryxdesign/core/reset.css");
    expect(cssPipeline).toContain("site-astryx.css");
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

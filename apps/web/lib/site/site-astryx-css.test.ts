// @vitest-environment node
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeSiteAstryxCss } from "../../scripts/build-site-astryx-css.mjs";

const WEB = join(import.meta.dirname, "../..");

describe("public site loads only the Astryx CSS it uses", () => {
  it("does not import the full 304 KB @astryxdesign/core/astryx.css in the site layout", () => {
    const layout = readFileSync(join(WEB, "app/(site)/layout.tsx"), "utf8");
    expect(layout).not.toContain("@astryxdesign/core/astryx.css");
    expect(layout).toContain("site-astryx.css");
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
    expect(Buffer.byteLength(sharedCss)).toBeLessThan(fullSize * 0.45);
  });
});

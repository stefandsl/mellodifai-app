import { describe, expect, it } from "vitest";
import { artFor, COVER_FAMILIES, coverFamily } from "./cover-art";

const ids = Array.from(
  { length: 600 },
  (_, i) =>
    `${(i * 2654435761).toString(16)}-0000-4000-8000-${i.toString(16).padStart(12, "0")}`,
);

// The function names each family must be built from.
const SIGNATURE: Record<(typeof COVER_FAMILIES)[number], RegExp> = {
  mesh: /^radial-gradient\(at /u,
  orbs: /^radial-gradient\(circle at /u,
  rays: /repeating-conic-gradient\(/u,
  waves: /^repeating-radial-gradient\(ellipse at /u,
  conic: /(^|, )conic-gradient\(from /u,
  blobs: /^radial-gradient\(ellipse /u,
};

describe("procedural covers", () => {
  it("is deterministic and differs between songs", () => {
    expect(artFor("song-1")).toBe(artFor("song-1"));
    expect(artFor("song-1")).not.toBe(artFor("song-2"));
    expect(coverFamily("song-1")).toBe(coverFamily("song-1"));
    expect(new Set(ids.map(artFor)).size).toBeGreaterThan(590);
  });

  it("spreads songs over all six families", () => {
    const counts = new Map<string, number>();
    for (const id of ids)
      counts.set(coverFamily(id), (counts.get(coverFamily(id)) ?? 0) + 1);
    expect([...counts.keys()].sort()).toEqual([...COVER_FAMILIES].sort());
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(60);
      expect(count).toBeLessThan(150);
    }
  });

  it("builds each family from its own CSS functions", () => {
    for (const family of COVER_FAMILIES) {
      const id = ids.find((candidate) => coverFamily(candidate) === family);
      expect(id).toBeDefined();
      expect(artFor(id as string)).toMatch(SIGNATURE[family]);
    }
  });

  it("is a plain background value: balanced, no stray colour, no bad numbers", () => {
    for (const id of ids.slice(0, 200)) {
      const css = artFor(id);
      expect(css).not.toMatch(/NaN|undefined|Infinity|—/u);
      let depth = 0;
      for (const char of css) {
        if (char === "(") depth += 1;
        if (char === ")") depth -= 1;
        expect(depth).toBeGreaterThanOrEqual(0);
      }
      expect(depth).toBe(0);
      // Every layer is a gradient, so it can sit under a real cover image in one shorthand.
      const layers = css.split(
        /, (?=(?:repeating-)?(?:linear|radial|conic)-gradient)/u,
      );
      for (const layer of layers)
        expect(layer).toMatch(
          /^(repeating-)?(linear|radial|conic)-gradient\(/u,
        );
      expect(layers.at(-1)).toMatch(/^linear-gradient\(|^conic-gradient\(/u);
    }
  });

  it("stays in the brand's warm hues over a dark ink", () => {
    const allowed = new Set([352, 4, 14, 26, 336, 316, 290, 266]);
    for (const id of ids.slice(0, 100)) {
      const lightness = [...artFor(id).matchAll(/hsl\((\d+) (\d+)% (\d+)%/gu)];
      expect(lightness.length).toBeGreaterThan(2);
      // The ink (deep, desaturated) is always present, so the cover stays dark overall.
      expect(lightness.some((m) => Number(m[3]) <= 16)).toBe(true);
      const hues = lightness.map((m) => Number(m[1]));
      expect(
        hues.some((h) => [...allowed].some((a) => Math.abs(a - h) <= 12)),
      ).toBe(true);
    }
  });
});

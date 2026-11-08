import { expect, it } from "vitest";
import { contrast, coverColors, guardColor } from "./ambient";

it("samples three spatial cover colors and skips transparent pixels", () => {
  const data = new Uint8ClampedArray(12 * 4);
  for (let i = 0; i < 12; i++) {
    data.set(
      i < 4
        ? [240, 20, 30, 255]
        : i < 8
          ? [20, 200, 40, 255]
          : [30, 40, 230, 255],
      i * 4,
    );
  }
  data[3] = 0;
  expect(coverColors({ data, width: 12, height: 1 } as ImageData)).toEqual([
    [240, 20, 30],
    [20, 200, 40],
    [30, 40, 230],
  ]);
});

it("guards both themes to at least 7:1 for foreground text", () => {
  for (const color of [
    [255, 255, 255],
    [0, 0, 0],
    [250, 40, 80],
    [30, 80, 210],
  ] as const) {
    expect(
      contrast(guardColor([...color], false), [247, 244, 239]),
    ).toBeGreaterThanOrEqual(7);
    expect(
      contrast(guardColor([...color], true), [20, 20, 22]),
    ).toBeGreaterThanOrEqual(7);
    for (const [light, alpha, ink] of [
      [false, 0.56, [247, 244, 239]],
      [true, 0.64, [20, 20, 22]],
    ] as const) {
      const background = guardColor([...color], light);
      const faded = background.map((value, index) =>
        Math.round(value * (1 - alpha) + ink[index] * alpha),
      ) as [number, number, number];
      expect(contrast(background, faded)).toBeGreaterThanOrEqual(4.5);
    }
  }
});

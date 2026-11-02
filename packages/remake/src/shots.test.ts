import { describe, expect, it } from "vitest";
import { buildShots, capFrames, classifyVocal, sheetCells } from "./shots.js";
import { analysisFixture } from "./test-fixtures.js";

const sections = analysisFixture().music.sections; // 0-8, 8-18, 18-30
const beats = Array.from({ length: 61 }, (_, i) => i * 0.5);

describe("buildShots", () => {
  it("snaps cuts to beats, splits at section starts and marks on-beat shots", () => {
    const shots = buildShots({
      cuts: [0, 3.93, 12.2, 25.1],
      beats,
      sections,
      durationS: 30,
    });
    expect(shots.map((s) => [s.start, s.end, s.sectionId])).toEqual([
      [0, 4, "intro-1"],
      [4, 8, "intro-1"],
      [8, 12, "verse-1"],
      [12, 18, "verse-1"],
      [18, 25, "chorus-1"],
      [25, 30, "chorus-1"],
    ]);
    expect(shots.every((s) => s.onBeat)).toBe(true);
    expect(shots[3]?.offsetInSection).toBeCloseTo(0.4);
  });

  it("keeps an off-beat cut where it is and says so", () => {
    const sparse = Array.from({ length: 16 }, (_, i) => i * 2);
    const shots = buildShots({
      cuts: [0, 5.3],
      beats: sparse,
      sections,
      durationS: 30,
    });
    expect(shots.find((s) => s.start === 5.3)?.onBeat).toBe(false);
  });

  it("merges flicker shots and caps the count", () => {
    const cuts = Array.from({ length: 200 }, (_, i) => i * 0.15);
    const shots = buildShots({
      cuts,
      beats,
      sections,
      durationS: 30,
      maxShots: 20,
    });
    expect(shots.length).toBeLessThanOrEqual(20);
    expect(
      Math.min(...shots.map((s) => s.end - s.start)),
    ).toBeGreaterThanOrEqual(0.4);
    for (let i = 1; i < shots.length; i++)
      expect(shots[i]?.start).toBe(shots[i - 1]?.end);
    expect(shots.at(-1)?.end).toBe(30);
  });
});

describe("capFrames", () => {
  it("keeps at most n cuts, evenly spread, always the first", () => {
    const cuts = [0, 1, 1.2, 1.3, 5, 9, 9.1, 15];
    const kept = capFrames(cuts, 4);
    expect(kept).toHaveLength(4);
    expect(kept[0]).toBe(0);
    expect(kept).toEqual(expect.arrayContaining([5, 15]));
    expect(capFrames([0, 3], 48)).toEqual([0, 3]);
  });
});

describe("sheetCells", () => {
  it("maps a time span to contact sheet cells (5x4, one per second)", () => {
    expect(sheetCells(18.5, 22.1)).toBe("sheet 1 cell 19 to sheet 2 cell 3");
    expect(sheetCells(41, 43)).toBe("sheet 3 cells 2-3");
  });
});

describe("classifyVocal", () => {
  const shares = { vocals: 0.2, drums: 0.3, bass: 0.3, other: 0.2 };
  it.each([
    [
      {
        medianF0Hz: 351,
        voicedShare: 0.85,
        pitchStability: 0.82,
        lowShare: 0.02,
        highShare: 0.92,
      },
      "female",
      "sung",
    ],
    [
      {
        medianF0Hz: 130,
        voicedShare: 0.8,
        pitchStability: 0.8,
        lowShare: 0.8,
        highShare: 0.05,
      },
      "male",
      "sung",
    ],
    [
      {
        medianF0Hz: 190,
        voicedShare: 0.8,
        pitchStability: 0.8,
        lowShare: 0.4,
        highShare: 0.4,
      },
      "duet",
      "sung",
    ],
    [
      {
        medianF0Hz: 150,
        voicedShare: 0.4,
        pitchStability: 0.25,
        lowShare: 0.6,
        highShare: 0.1,
      },
      "male",
      "rap",
    ],
  ])("%j is %s %s", (vocal, type, delivery) => {
    expect(classifyVocal(vocal, shares, true)).toEqual({ type, delivery });
  });

  it("is none without vocals and lyrics, undecided without stems or in the middle range", () => {
    expect(classifyVocal(null, { ...shares, vocals: 0.01 }, false)).toEqual({
      type: "none",
      delivery: "unknown",
    });
    expect(classifyVocal(null, null, true)).toEqual({
      type: null,
      delivery: "unknown",
    });
    expect(
      classifyVocal(
        {
          medianF0Hz: 185,
          voicedShare: 0.8,
          pitchStability: 0.8,
          lowShare: 0.1,
          highShare: 0.1,
        },
        shares,
        true,
      ),
    ).toEqual({ type: null, delivery: "sung" });
  });
});

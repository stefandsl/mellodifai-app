import { describe, expect, it } from "vitest";
import {
  countSyllables,
  fitLine,
  lineEnding,
  singingRate,
} from "./syllables.js";

describe("countSyllables", () => {
  it.each([
    ["nel mezzo del cammin di nostra vita", 11, 11],
    ["paese", 3, 3],
    ["ciao bella", 4, 4],
    ["aiuola", 3, 3],
    ["quando", 2, 2],
    // "mio" may be sung as one or two syllables.
    ["amore mio", 4, 5],
    // Synalepha: "come un'onda" is co-meu-non-da when sung.
    ["come un'onda", 4, 5],
  ])("Italian %s", (line, min, max) => {
    expect(countSyllables(line, "it")).toEqual({ min, max });
  });

  it.each([
    ["I walk alone through the empty streets", 9],
    ["Hold on to the light tonight", 7],
    ["beautiful", 3],
    ["little", 2],
    ["loved", 1],
    ["wanted", 2],
    ["blue", 1],
    ["you and me", 3],
  ])("English %s", (line, n) => {
    expect(countSyllables(line, "en")).toEqual({ min: n, max: n });
  });

  it("Spanish with synalepha", () => {
    expect(countSyllables("te quiero mucho", "es")).toEqual({ min: 5, max: 5 });
    expect(countSyllables("mi alma", "es")).toEqual({ min: 2, max: 3 });
  });

  it("Russian counts vowel letters", () => {
    expect(countSyllables("Я люблю тебя", "ru")).toEqual({ min: 5, max: 5 });
  });

  it("Japanese counts morae, small kana merge", () => {
    expect(countSyllables("ありがとう", "ja")).toEqual({ min: 5, max: 5 });
    expect(countSyllables("きょう", "ja")).toEqual({ min: 2, max: 2 });
  });

  it("Chinese counts one syllable per character", () => {
    expect(countSyllables("我爱你", "zh")).toEqual({ min: 3, max: 3 });
  });

  it("ignores punctuation and vocables are still syllables", () => {
    expect(countSyllables("Oh, oh, oh!", "en")).toEqual({ min: 3, max: 3 });
    expect(countSyllables("", "en")).toEqual({ min: 0, max: 0 });
  });
});

describe("lineEnding", () => {
  it.each([
    ["ti porto via con me", "it", "stressed"],
    ["nel mezzo del cammin di nostra vita", "it", "unstressed"],
    ["sarà così", "it", "stressed"],
    ["mi corazón", "es", "stressed"],
    ["te quiero mucho", "es", "unstressed"],
    ["hasta la ciudad", "es", "stressed"],
    ["through the empty streets", "en", "stressed"],
    ["I keep on dreaming", "en", "unstressed"],
    ["je t'aime encore", "fr", "unstressed"],
    ["mon amour", "fr", "stressed"],
    ["Я люблю тебя", "ru", "unknown"],
  ])("%s (%s)", (line, lang, ending) => {
    expect(lineEnding(line, lang)).toBe(ending);
  });
});

describe("fitLine", () => {
  const target = { min: 8, max: 8, ending: "stressed" as const };

  it("accepts a line within tolerance", () => {
    expect(fitLine(target, { min: 9, max: 9, ending: "stressed" })).toEqual({
      fits: true,
      endingMatch: true,
      delta: 1,
    });
  });

  it("rejects a line far too long", () => {
    const fit = fitLine(target, { min: 13, max: 14, ending: "stressed" });
    expect(fit.fits).toBe(false);
    expect(fit.delta).toBe(5);
  });

  it("rejects a line far too short", () => {
    const fit = fitLine(target, { min: 4, max: 4, ending: "stressed" });
    expect(fit.fits).toBe(false);
    expect(fit.delta).toBe(-4);
  });

  it("holds plus or minus one strictly and only reports the ending (design 8.4 R3)", () => {
    expect(fitLine(target, { min: 10, max: 10, ending: "unstressed" })).toEqual(
      {
        fits: false,
        endingMatch: false,
        delta: 2,
      },
    );
    expect(fitLine(target, { min: 7, max: 7, ending: "unstressed" })).toEqual({
      fits: true,
      endingMatch: false,
      delta: -1,
    });
  });

  it("treats unknown endings as matching", () => {
    expect(
      fitLine(
        { min: 6, max: 6, ending: "unknown" },
        { min: 6, max: 6, ending: "stressed" },
      ).endingMatch,
    ).toBe(true);
  });

  it("uses overlapping ranges", () => {
    expect(
      fitLine(
        { min: 10, max: 12, ending: "unknown" },
        { min: 13, max: 15, ending: "unknown" },
      ).fits,
    ).toBe(true);
  });
});

describe("singingRate", () => {
  it("is syllables per second", () => {
    expect(singingRate({ min: 8, max: 10 }, 0, 3)).toBeCloseTo(3);
  });

  it("is zero for a zero-length line", () => {
    expect(singingRate({ min: 8, max: 10 }, 2, 2)).toBe(0);
  });
});

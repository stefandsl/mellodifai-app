import { describe, expect, it } from "vitest";
import {
  checkPhrases,
  checkSections,
  cosine,
  DEFAULT_THRESHOLDS,
  type Embed,
  jaccard4,
  longestSharedRun,
  rougeL,
  scoreLines,
} from "./originality.js";

const source = [
  "I walk alone through the empty streets",
  "Hold on to the light tonight",
];
const translation = [
  "Cammino da solo per le strade vuote",
  "Tieniti alla luce stanotte",
];

// Orthogonal one-hot vectors unless a test pins a vector for a text.
function fakeEmbed(pinned: Record<string, number[]> = {}): Embed {
  const dims = new Map<string, number>();
  return async (texts) =>
    texts.map((t) => {
      if (pinned[t]) return pinned[t];
      if (!dims.has(t)) dims.set(t, dims.size + 3);
      const v = new Array(64).fill(0);
      v[(dims.get(t) ?? 0) % 64] = 1;
      return v;
    });
}

describe("lexical measures", () => {
  it("4-gram Jaccard is 1 for the same text after folding accents and case", () => {
    expect(jaccard4("Città vuota", "citta VUOTA")).toBe(1);
    expect(jaccard4("the empty streets", "una barca nel mare")).toBe(0);
  });

  it("ROUGE-L is the word LCS F1", () => {
    expect(rougeL("a b c d", "a b c d")).toBe(1);
    // LCS "walk alone" (2) over 4 and 7 words.
    expect(
      rougeL("we walk alone tonight", "I walk alone through the empty streets"),
    ).toBeCloseTo((2 * (2 / 4) * (2 / 7)) / (2 / 4 + 2 / 7));
  });

  it("finds the longest shared run of words", () => {
    expect(
      longestSharedRun("and i walk alone through the night", source[0] ?? ""),
    ).toBe(5);
  });

  it("cosine handles zero vectors", () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe("scoreLines (design 10.3 binding values)", () => {
  it("uses 0.35 lexical and 0.80 semantic", () => {
    expect(DEFAULT_THRESHOLDS).toEqual({
      lexical: 0.35,
      semantic: 0.8,
      phraseWords: 3,
      sectionMeaning: 0.55,
    });
  });

  it("fails a literal translation and a copied line, passes a new one", async () => {
    const report = await scoreLines({
      lines: [
        "Cammino da solo per le strade vuote",
        "Hold on to the light tonight",
        "una barca di carta nel fosso",
      ],
      sourceLines: source,
      translationLines: translation,
      embed: fakeEmbed(),
    });
    expect(report.lines.map((l) => l.flagged)).toEqual([true, true, false]);
    expect(report.lines[0]).toMatchObject({
      against: "translation",
      closestSource: 0,
    });
    expect(report.lines[1]).toMatchObject({
      against: "source",
      closestSource: 1,
    });
    expect(report.lines[0]?.reasons.join(" ")).toContain("Jaccard");
    expect(report.flaggedLines).toBe(2);
  });

  it("fails a line whose meaning sits too close to a translated source line", async () => {
    const report = await scoreLines({
      lines: [
        "Stringi forte questa luce fino al mattino",
        "una barca di carta nel fosso",
      ],
      sourceLines: source,
      translationLines: translation,
      embed: fakeEmbed({
        "Stringi forte questa luce fino al mattino": [0, 1, 0.3],
        "Tieniti alla luce stanotte": [0, 1, 0.2],
      }),
    });
    expect(report.lines[0]).toMatchObject({
      flagged: true,
      against: "translation",
      closestSource: 1,
    });
    expect(report.lines[0]?.semantic).toBeGreaterThan(0.8);
    expect(report.lines[1]?.flagged).toBe(false);
  });

  it("compares with the source itself when the language does not change", async () => {
    const report = await scoreLines({
      lines: ["a paper boat drifts down the gutter"],
      sourceLines: source,
      translationLines: null,
      embed: fakeEmbed(),
    });
    expect(report.lines[0]?.flagged).toBe(false);
  });

  it("accepts tighter thresholds", async () => {
    const report = await scoreLines({
      lines: ["the night is long"],
      sourceLines: source,
      translationLines: null,
      embed: fakeEmbed(),
      thresholds: { ...DEFAULT_THRESHOLDS, lexical: 0.1 },
    });
    expect(report.lines[0]?.flagged).toBe(true);
  });
});

describe("checkPhrases", () => {
  it("fails a title or hook that reuses 3 words in a row", () => {
    expect(
      checkPhrases({
        title: "Alone in the crowd",
        hookLines: [],
        sourceTexts: ["Alone", "alone in the crowd tonight"],
      }),
    ).toMatchObject({ ok: false, longestRun: 4 });
    expect(
      checkPhrases({
        title: "Luci di vetro",
        hookLines: ["nessuno mi sente"],
        sourceTexts: ["Alone"],
      }).ok,
    ).toBe(true);
  });
});

describe("checkSections", () => {
  it("needs cosine 0.55 against the meaning map", async () => {
    const result = await checkSections({
      sections: [
        { sectionId: "v", text: "new verse", meaning: "loneliness at night" },
        { sectionId: "c", text: "new chorus", meaning: "hope" },
        { sectionId: "i", text: "", meaning: "" },
      ],
      embed: fakeEmbed({
        "new verse": [1, 1, 0],
        "loneliness at night": [1, 0.8, 0],
        "new chorus": [1, 0, 0],
        hope: [0, 1, 0],
      }),
    });
    expect(result.map((r) => r.ok)).toEqual([true, false, true]);
    expect(result[2]?.meaningCosine).toBeNull();
  });
});

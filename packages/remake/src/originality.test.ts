import { describe, expect, it } from "vitest";
import {
  charTrigramDice,
  checkOriginality,
  cosine,
  DEFAULT_THRESHOLDS,
  isExempt,
  longestSharedRun,
  scoreLexical,
} from "./originality.js";

const source = [
  "I walk alone through the empty streets",
  "Hold on to the light tonight",
  "Oh oh oh",
];

describe("lexical measures", () => {
  it("trigram dice is 1 for identical text and folds accents and case", () => {
    expect(charTrigramDice("Città vuota", "citta VUOTA")).toBe(1);
  });

  it("trigram dice is low for unrelated text", () => {
    expect(charTrigramDice("the empty streets", "una barca nel mare")).toBeLessThan(
      0.15,
    );
  });

  it("finds the longest shared run of words", () => {
    expect(
      longestSharedRun(
        "and i walk alone through the night",
        "I walk alone through the empty streets",
      ),
    ).toBe(5);
  });

  it("scores containment of content words", () => {
    const s = scoreLexical(
      "streets empty, I walk alone",
      "I walk alone through the empty streets",
      "en",
    );
    expect(s.lexical).toBeGreaterThanOrEqual(0.6);
  });
});

describe("isExempt", () => {
  it("exempts vocables and very short lines", () => {
    expect(isExempt("Oh oh oh", "en")).toBe(true);
    expect(isExempt("yeah", "en")).toBe(true);
    expect(isExempt("na na na, hey", "it")).toBe(true);
    expect(isExempt("I walk alone", "en")).toBe(false);
  });
});

describe("cosine", () => {
  it("is 1 for parallel vectors and 0 for orthogonal ones", () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe("checkOriginality", () => {
  it("flags a copied line and a line sharing a long run, passes a new one", async () => {
    const report = await checkOriginality({
      lines: [
        "I walk alone through the empty streets",
        "we walk alone through the empty town",
        "a paper boat drifts down the gutter",
        "oh oh oh",
      ],
      sourceLines: source,
      lang: "en",
      sourceLang: "en",
    });
    expect(report.lines.map((l) => l.flagged)).toEqual([true, true, false, false]);
    expect(report.lines[0]?.lexical).toBe(1);
    expect(report.lines[0]?.closestSource).toBe(0);
    expect(report.lines[1]?.sharedRun).toBeGreaterThanOrEqual(4);
    expect(report.lines[3]?.exempt).toBe(true);
    expect(report.flaggedLines).toBe(2);
    expect(report.semanticAvailable).toBe(false);
  });

  it("flags a line that is the literal translation when the language changes", async () => {
    const report = await checkOriginality({
      lines: ["Cammino da solo per le strade vuote", "Una barca di carta nel fosso"],
      sourceLines: source.slice(0, 2),
      translationLines: [
        "Cammino da solo per le strade vuote",
        "Resisti alla luce stanotte",
      ],
      lang: "it",
      sourceLang: "en",
    });
    expect(report.lines[0]).toMatchObject({ flagged: true, against: "translation" });
    expect(report.lines[1]?.flagged).toBe(false);
  });

  it("flags a line too close in meaning through embeddings", async () => {
    // Fake embeddings: the first new line points the same way as source line 1.
    const vectors: Record<string, number[]> = {
      "Tieniti stretto a questa luce stanotte": [0.1, 1, 0],
      "Una barca di carta nel fosso": [0, 0, 1],
      [source[0] ?? ""]: [1, 0, 0],
      [source[1] ?? ""]: [0.12, 1, 0],
    };
    const report = await checkOriginality({
      lines: ["Tieniti stretto a questa luce stanotte", "Una barca di carta nel fosso"],
      sourceLines: source.slice(0, 2),
      lang: "it",
      sourceLang: "en",
      embed: async (texts) => texts.map((t) => vectors[t] ?? [0, 0, 0]),
    });
    expect(report.semanticAvailable).toBe(true);
    expect(report.lines[0]).toMatchObject({ flagged: true, closestSource: 1 });
    expect(report.lines[0]?.semantic).toBeGreaterThan(DEFAULT_THRESHOLDS.semantic);
    expect(report.lines[1]?.flagged).toBe(false);
    expect(report.maxSemantic).toBeGreaterThan(0.9);
  });

  it("keeps the lexical check when embeddings fail", async () => {
    const report = await checkOriginality({
      lines: ["Hold on to the light tonight"],
      sourceLines: source,
      lang: "en",
      sourceLang: "en",
      embed: async () => {
        throw new Error("down");
      },
    });
    expect(report.semanticAvailable).toBe(false);
    expect(report.semanticError).toContain("down");
    expect(report.lines[0]?.flagged).toBe(true);
  });

  it("honours custom thresholds", async () => {
    const report = await checkOriginality({
      lines: ["we walk alone through the empty town"],
      sourceLines: source,
      lang: "en",
      sourceLang: "en",
      thresholds: { lexical: 0.99, semantic: 0.99, sharedRun: 9 },
    });
    expect(report.lines[0]?.flagged).toBe(false);
  });
});

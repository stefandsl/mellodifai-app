import { describe, expect, it } from "vitest";
import { activeLine, activeWord, karaokeLines, sectionLabel } from "./karaoke";

const lines = karaokeLines("[Verse]\nfirst line\nsecond line\nthird line", {
  source: "whisper",
  lines: [
    {
      text: "first line",
      start: 1,
      end: 3,
      words: [
        { word: "first", start: 1, end: 2 },
        { word: "line", start: 2, end: 3 },
      ],
    },
    { text: "second line", start: 4, end: 6 },
    { text: "third line", start: 5, end: 7 },
  ],
});

describe("karaoke selection", () => {
  it("handles backward seeks, gaps, overlaps, and the song end", () => {
    expect(
      [1.5, 3.5, 5.5, 1.5, 7].map((time) => activeLine(lines, time)),
    ).toEqual([1, -1, 3, 1, -1]);
  });
  it("lights only a word with a measured timestamp", () => {
    expect(
      [1.2, 2.2, 3].map((time) => activeWord(lines[1]?.words ?? [], time)),
    ).toEqual([0, 1, -1]);
  });
  it("keeps section labels and plain lyrics when timing is absent", () => {
    expect(
      karaokeLines("[Chorus]\nA long line", null).map((line) => [
        line.sung,
        line.start,
      ]),
    ).toEqual([
      [false, null],
      [true, null],
    ]);
  });
  it("shows common section names in the selected language", () => {
    expect(sectionLabel("[Verse 2]", "it")).toBe("Strofa 2");
    expect(sectionLabel("[Chorus]", "it")).toBe("Ritornello");
    expect(sectionLabel("[Verse 2]", "en")).toBe("Verse 2");
  });
});

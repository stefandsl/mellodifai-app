import { describe, expect, it } from "vitest";
import {
  alignWordsToLines,
  KIE_CREDITS,
  linesInRange,
  lyricLines,
  maxSection,
  parseLyricTiming,
  replaceSection,
  rewriteWindow,
  rewrittenTiming,
  SECTION_LIMITS,
  sectionProblem,
  sectionText,
  timedLyrics,
  windowLyrics,
  words,
} from "./rewrite.js";

const LYRICS = [
  "[Verse 1]",
  "Sono le nove, ho già l'aria stanca",
  "la prima mail e la voglia mi manca",
  "",
  "[Chorus]",
  "Solo un caffè, poi si va",
  "è una pausa, lo giuro",
].join("\n");

const TIMING = {
  source: "timing" as const,
  lines: [
    { text: "Sono le nove, ho già l'aria stanca", start: 21.6, end: 24.6 },
    { text: "la prima mail e la voglia mi manca", start: 24.6, end: 26.7 },
    { text: "Solo un caffè, poi si va", start: 56.4, end: 61.8 },
    { text: "è una pausa, lo giuro", start: 61.8, end: 63.7 },
  ],
};

describe("section limits", () => {
  it("accepts 10 to 30 seconds within half of the song", () => {
    expect(sectionProblem(20, 30, 200)).toBeNull();
    expect(sectionProblem(20, 50, 200)).toBeNull();
    expect(sectionProblem(20, 29.99, 200)).toBe("short");
    expect(sectionProblem(20, 50.01, 200)).toBe("long");
    // A 30 s song allows at most 15 s.
    expect(sectionProblem(0, 16, 30)).toBe("half");
    expect(sectionProblem(0, 15, 30)).toBeNull();
    expect(sectionProblem(-1, 12, 200)).toBe("outside");
    expect(sectionProblem(190, 211, 200)).toBe("outside");
    expect(sectionProblem(40, 30, 200)).toBe("outside");
    expect(SECTION_LIMITS).toEqual({
      minSeconds: 10,
      maxSeconds: 30,
      maxShare: 0.5,
    });
  });
  it("tells the longest part a take allows", () => {
    expect(maxSection(281)).toBe(30);
    expect(maxSection(41)).toBe(20.5);
  });
  it("puts context around the part, inside the song", () => {
    expect(rewriteWindow(21, 33, 281)).toEqual({ from: 16, to: 38 });
    expect(rewriteWindow(2, 14, 16)).toEqual({ from: 0, to: 16 });
  });
  it("keeps kie's prices in one place", () => {
    expect(KIE_CREDITS.replace).toBe(5);
    expect(KIE_CREDITS.cover).toBe(12);
    expect(KIE_CREDITS.extend).toBe(12);
  });
});

describe("lyric lines", () => {
  it("marks tags, directions and blank lines as not sung", () => {
    const lines = lyricLines(`${LYRICS}\n(spoken)`);
    expect(lines.filter((line) => line.sung).map((line) => line.index)).toEqual(
      [1, 2, 5, 6],
    );
    expect(lines.at(-1)?.sung).toBe(false);
  });
  it("compares words without accents or punctuation", () => {
    expect(words("È già l'aria, CAFFÈ!")).toEqual([
      "e",
      "gia",
      "l",
      "aria",
      "caffe",
    ]);
  });
});

describe("aligning heard words to lines", () => {
  it("times each line from its first to its last matched word", () => {
    const heard = [
      { word: "Sono", start: 21.6, end: 21.8 },
      { word: "le", start: 21.8, end: 21.9 },
      { word: "nove,", start: 21.9, end: 22.6 },
      { word: "ho", start: 22.6, end: 22.8 },
      { word: "gia", start: 22.8, end: 23 },
      { word: "l'aria", start: 23, end: 23.6 },
      { word: "stanca", start: 23.6, end: 24.6 },
      // A misheard word and an extra one do not break the alignment.
      { word: "la", start: 24.6, end: 24.7 },
      { word: "primma", start: 24.7, end: 25.1 },
      { word: "mail", start: 25.1, end: 25.4 },
      { word: "eh", start: 25.4, end: 25.5 },
      { word: "e", start: 25.5, end: 25.6 },
      { word: "la", start: 25.6, end: 25.7 },
      { word: "voglia", start: 25.7, end: 26 },
      { word: "mi", start: 26, end: 26.2 },
      { word: "manca", start: 26.2, end: 26.7 },
    ];
    expect(
      alignWordsToLines(
        [
          "Sono le nove, ho già l'aria stanca",
          "la prima mail e la voglia mi manca",
        ],
        heard,
      ),
    ).toEqual([
      { start: 21.6, end: 24.6 },
      { start: 24.6, end: 26.7 },
    ]);
  });
  it("gives an unheard line the gap between its neighbours", () => {
    const result = alignWordsToLines(
      ["uno due tre", "quattro cinque sei", "sette otto nove"],
      [
        { word: "uno", start: 0, end: 1 },
        { word: "due", start: 1, end: 2 },
        { word: "tre", start: 2, end: 3 },
        { word: "sette", start: 7, end: 8 },
        { word: "otto", start: 8, end: 9 },
        { word: "nove", start: 9, end: 10 },
      ],
    );
    expect(result).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 7 },
      { start: 7, end: 10 },
    ]);
  });
  it("returns nothing without words", () => {
    expect(alignWordsToLines(["a b"], [])).toEqual([null]);
  });
});

describe("timed lyrics and the lines in a range", () => {
  it("lays the take's timing over the lyrics by order", () => {
    const timed = timedLyrics(LYRICS, TIMING);
    expect(timed[1]).toMatchObject({ start: 21.6, end: 24.6, sung: true });
    expect(timed[0]).toMatchObject({ start: null, sung: false });
    expect(timed[6]).toMatchObject({ start: 61.8, end: 63.7 });
  });
  it("aligns by words when the lyrics have other lines than the timing", () => {
    const longer = `${LYRICS}\nUna riga nuova in fondo`;
    const timed = timedLyrics(longer, TIMING);
    expect(timed[1]?.start).toBeCloseTo(21.6, 1);
    expect(timed[5]?.start).toBeCloseTo(56.4, 1);
    expect(timed[7]?.start).toBeNull();
  });
  it("lights the lines sung inside the range", () => {
    const timed = timedLyrics(LYRICS, TIMING);
    expect(linesInRange(timed, 21, 33)).toEqual([1, 2]);
    // Half of a line is enough; a brush of it is not.
    expect(linesInRange(timed, 23, 40)).toEqual([1, 2]);
    expect(linesInRange(timed, 24.2, 40)).toEqual([2]);
    expect(linesInRange(timed, 30, 50)).toEqual([]);
  });
  it("reads only a well formed stored timing", () => {
    expect(parseLyricTiming(TIMING)?.lines).toHaveLength(4);
    expect(parseLyricTiming({ source: "timing", lines: [] })).toBeNull();
    expect(parseLyricTiming({ lines: "x" })).toBeNull();
  });
});

describe("rewriting the block", () => {
  it("edits the lines from the first chosen to the last", () => {
    expect(sectionText(LYRICS, [1, 2])).toBe(
      "Sono le nove, ho già l'aria stanca\nla prima mail e la voglia mi manca",
    );
    const next = replaceSection(
      LYRICS,
      [1, 2],
      "Sono le otto, ho gli occhi chiusi\nil primo file e i pensieri confusi\n",
    );
    expect(next.split("\n").slice(0, 4)).toEqual([
      "[Verse 1]",
      "Sono le otto, ho gli occhi chiusi",
      "il primo file e i pensieri confusi",
      "",
    ]);
    expect(next.endsWith("è una pausa, lo giuro")).toBe(true);
  });
  it("leaves the lyrics alone with nothing chosen", () => {
    expect(replaceSection(LYRICS, [], "x")).toBe(LYRICS);
    expect(sectionText(LYRICS, [])).toBe("");
  });
  it("moves the timing to the new words line by line", () => {
    const next = replaceSection(LYRICS, [1, 2], "Sono le otto\nil primo file");
    const timing = rewrittenTiming(TIMING, LYRICS, next);
    expect(timing?.source).toBe("copied");
    expect(timing?.lines[0]).toEqual({
      text: "Sono le otto",
      start: 21.6,
      end: 24.6,
    });
    expect(timing?.lines[2]?.text).toBe("Solo un caffè, poi si va");
  });
  it("spreads a block with another number of lines over the old block's time", () => {
    const next = replaceSection(LYRICS, [1, 2], "Una\nDue\nTre");
    const timing = rewrittenTiming(TIMING, LYRICS, next);
    expect(timing?.lines.map((line) => line.text)).toEqual([
      "Una",
      "Due",
      "Tre",
      "Solo un caffè, poi si va",
      "è una pausa, lo giuro",
    ]);
    expect(timing?.lines[0]?.start).toBe(21.6);
    expect(timing?.lines[2]?.end).toBe(26.7);
    expect(rewrittenTiming(null, LYRICS, next)).toBeNull();
  });
  it("gives ACE-Step the lines of the window with the new block", () => {
    expect(
      windowLyrics(
        TIMING,
        LYRICS,
        { from: 16, to: 58 },
        [1, 2],
        "Sono le otto\n\nil primo file",
      ),
    ).toBe("Sono le otto\nil primo file\nSolo un caffè, poi si va");
    expect(windowLyrics(null, LYRICS, { from: 0, to: 9 }, [], " nuove ")).toBe(
      "nuove",
    );
  });
});

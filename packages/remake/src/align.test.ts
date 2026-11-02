import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyseLines,
  buildSections,
  cleanCaption,
  findRepeatedLines,
  parseVtt,
  wordsToLines,
} from "./align.js";

const MANUAL_VTT = `WEBVTT
Kind: captions
Language: en

00:00:01.000 --> 00:00:03.500
♪ I walk alone ♪

00:00:03.500 --> 00:00:06.000
through the empty streets

00:00:06.000 --> 00:00:07.000
[Music]

00:00:08.000 --> 00:00:10.000
&gt;&gt; Hold on &amp; stay
`;

// YouTube auto captions repeat the previous line in each cue and add 10 ms cues.
const AUTO_VTT = `WEBVTT
Kind: captions
Language: en

00:00:01.000 --> 00:00:03.000 align:start position:0%
 
i<00:00:01.400><c> walk</c><00:00:01.800><c> alone</c>

00:00:03.000 --> 00:00:03.010 align:start position:0%
i walk alone


00:00:03.010 --> 00:00:05.000 align:start position:0%
i walk alone
through<00:00:03.500><c> the</c><00:00:04.000><c> streets</c>

00:00:05.000 --> 00:00:05.010 align:start position:0%
through the streets


00:00:05.010 --> 00:00:07.000 align:start position:0%
through the streets
hold<00:00:05.500><c> on</c>
`;

describe("captions", () => {
  it("cleans markers, tags and entities", () => {
    expect(cleanCaption("♪ I walk <i>alone</i> ♪")).toBe("I walk alone");
    expect(cleanCaption("[Music]")).toBe("");
    expect(cleanCaption("&gt;&gt; Hold on &amp; stay")).toBe("Hold on & stay");
    expect(cleanCaption("(Instrumental)")).toBe("");
    expect(cleanCaption("Leeeeave us, DOOOOOON'T shut")).toBe(
      "Leave us, DON'T shut",
    );
    expect(cleanCaption("Alone, alone— in the crowd")).toBe(
      "Alone, alone - in the crowd",
    );
  });

  it("parses manual captions", () => {
    expect(parseVtt(MANUAL_VTT)).toEqual([
      { start: 1, end: 3.5, text: "I walk alone" },
      { start: 3.5, end: 6, text: "through the empty streets" },
      { start: 8, end: 10, text: "Hold on & stay" },
    ]);
  });

  it("collapses rolling auto captions into single lines", () => {
    expect(parseVtt(AUTO_VTT)).toEqual([
      { start: 1, end: 3, text: "i walk alone" },
      { start: 3.01, end: 5, text: "through the streets" },
      { start: 5.01, end: 7, text: "hold on" },
    ]);
  });
});

describe("wordsToLines", () => {
  it("breaks on pauses and sentence punctuation", () => {
    const w = (word: string, start: number, end: number) => ({
      word,
      start,
      end,
    });
    expect(
      wordsToLines([
        w("I", 1, 1.2),
        w("walk", 1.2, 1.5),
        w("alone.", 1.5, 2),
        w("Through", 2.1, 2.4),
        w("the", 2.4, 2.5),
        w("streets", 2.5, 3),
        w("hold", 4.2, 4.5),
        w("on", 4.5, 4.9),
      ]),
    ).toEqual([
      { start: 1, end: 2, text: "I walk alone." },
      { start: 2.1, end: 3, text: "Through the streets" },
      { start: 4.2, end: 4.9, text: "hold on" },
    ]);
  });

  it("caps very long lines", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      word: `w${i}`,
      start: i * 0.3,
      end: i * 0.3 + 0.25,
    }));
    const lines = wordsToLines(many);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(
      Math.max(...lines.map((l) => l.text.split(" ").length)),
    ).toBeLessThanOrEqual(12);
  });
});

const line = (text: string, start: number, end: number) => ({
  text,
  start,
  end,
});

// A 60 s song: intro, verse, chorus, verse, chorus, outro.
const LINES = [
  line("I walk alone through the empty streets", 8.2, 11.8),
  line("the city sleeps but I cannot", 12.1, 15.9),
  line("hold on to the light tonight", 16.1, 19.8),
  line("hold on, don't let it go", 20.1, 23.8),
  line("morning comes and finds me here", 24.2, 27.8),
  line("counting cars along the road", 28.1, 31.8),
  line("Hold on to the light tonight", 32.1, 35.8),
  line("hold on don't let it go", 36.1, 39.8),
];
const DOWNBEATS = Array.from({ length: 30 }, (_, i) => i * 2);

describe("findRepeatedLines", () => {
  it("finds lines sung again later", () => {
    expect([...findRepeatedLines(LINES)].sort((a, b) => a - b)).toEqual([
      2, 3, 6, 7,
    ]);
  });
});

describe("buildSections", () => {
  const sections = buildSections({
    durationS: 48,
    // Audio boundaries slightly off the downbeats; 23.9 cuts no line.
    boundaries: [7.7, 16.3, 24.1, 31.9, 40.2],
    labels: ["A", "B", "C", "B", "C", "A"],
    lines: LINES,
    downbeats: DOWNBEATS,
    energy: Array.from({ length: 48 }, (_, t) => ({
      t,
      v: t >= 16 && t < 24 ? 0.9 : t >= 32 && t < 40 ? 0.95 : 0.4,
    })),
  });

  it("labels intro, verses, choruses and outro", () => {
    expect(sections.map((s) => s.label)).toEqual([
      "Intro",
      "Verse 1",
      "Chorus 1",
      "Verse 2",
      "Chorus 2",
      "Outro",
    ]);
  });

  it("snaps boundaries to downbeats and covers the whole song", () => {
    expect(sections.map((s) => s.start)).toEqual([0, 8, 16, 24, 32, 40]);
    expect(sections.at(-1)?.end).toBe(48);
  });

  it("averages the energy per section", () => {
    expect(sections[2]?.energy).toBeCloseTo(0.9);
    expect(sections[1]?.energy).toBeCloseTo(0.4);
  });

  it("never splits a sung line", () => {
    const cut = buildSections({
      durationS: 48,
      boundaries: [9.5],
      labels: ["A", "B"],
      lines: [line("a long line that crosses", 8.2, 11.8)],
      downbeats: DOWNBEATS,
      energy: [],
    });
    const starts = cut.map((s) => s.start);
    expect(starts).toContain(8);
    expect(starts.filter((b) => b > 8.2 && b < 11.8)).toEqual([]);
  });

  it("falls back to audio repetition for the chorus when no line repeats", () => {
    const texts = [
      "red kites above the harbour",
      "my shoes are full of sand",
      "nobody answers the phone",
      "seven bridges in the fog",
      "a radio hums in the kitchen",
      "the bus is late again",
      "paint drying on the fence",
      "we argue about the weather",
    ];
    const unique = LINES.map((l, i) => ({ ...l, text: texts[i] ?? "" }));
    const s = buildSections({
      durationS: 48,
      boundaries: [7.7, 16.3, 24.1, 31.9, 40.2],
      labels: ["A", "B", "C", "B", "C", "A"],
      lines: unique,
      downbeats: DOWNBEATS,
      energy: Array.from({ length: 48 }, (_, t) => ({
        t,
        v: t >= 16 && t < 24 ? 0.9 : t >= 32 && t < 40 ? 0.95 : 0.4,
      })),
    });
    expect(s.map((x) => x.kind)).toEqual([
      "intro",
      "verse",
      "chorus",
      "verse",
      "chorus",
      "outro",
    ]);
  });

  it("marks a lyric-free middle part as instrumental and a new late part as bridge", () => {
    const s = buildSections({
      durationS: 72,
      boundaries: [7.7, 16.3, 24.1, 31.9, 40.2, 48, 56, 64],
      labels: ["A", "B", "C", "B", "C", "D", "D", "E", "C"],
      lines: [
        ...LINES,
        line("a different place I never knew", 56.2, 59.8),
        line("Hold on to the light tonight", 64.1, 67.8),
      ],
      downbeats: Array.from({ length: 40 }, (_, i) => i * 2),
      energy: [],
    });
    expect(s.map((x) => x.kind)).toEqual([
      "intro",
      "verse",
      "chorus",
      "verse",
      "chorus",
      "other",
      "bridge",
      "chorus",
    ]);
  });
});

describe("buildSections on a real song", () => {
  // Measured on "Alone" by The Sixsters (CC BY): beat_this downbeats, novelty
  // boundaries and captions. The audio misses the bridge-to-chorus change and splits
  // the first chorus one line late; the lyrics fix both.
  const fixture = JSON.parse(
    readFileSync(
      join(
        import.meta.dirname,
        "..",
        "test",
        "fixtures",
        "alone-structure.json",
      ),
      "utf8",
    ),
  ) as {
    durationS: number;
    boundaries: number[];
    labels: string[];
    downbeats: number[];
    lines: { start: number; end: number; text: string }[];
  };
  const sections = buildSections({ ...fixture, energy: [] });

  it("finds intro, verses, three choruses, the bridge and the outro", () => {
    expect(sections.map((s) => s.label)).toEqual([
      "Intro",
      "Verse 1",
      "Chorus 1",
      "Verse 2",
      "Chorus 2",
      "Bridge",
      "Chorus 3",
      "Outro",
    ]);
  });

  it("starts each chorus on its first repeated line", () => {
    const starts = Object.fromEntries(sections.map((s) => [s.id, s.start]));
    expect(starts["chorus-1"]).toBeCloseTo(42.22, 1);
    expect(starts["chorus-3"]).toBeCloseTo(131.44, 1);
    const lines = analyseLines(fixture.lines, sections, [], "en");
    expect(lines.find((l) => l.text.startsWith("Alone"))?.sectionId).toBe(
      "chorus-1",
    );
    expect(lines.find((l) => l.text.startsWith("The edge"))?.sectionId).toBe(
      "bridge-1",
    );
  });
});

describe("analyseLines", () => {
  it("assigns sections, syllables, endings and beats", () => {
    const sections = buildSections({
      durationS: 48,
      boundaries: [7.7, 16.3, 24.1, 31.9, 40.2],
      labels: ["A", "B", "C", "B", "C", "A"],
      lines: LINES,
      downbeats: DOWNBEATS,
      energy: [],
    });
    const beats = Array.from({ length: 96 }, (_, i) => i * 0.5);
    const analysed = analyseLines(LINES, sections, beats, "en");
    expect(analysed[0]).toMatchObject({
      index: 0,
      sectionId: "verse-1",
      syllables: { min: 9, max: 9 },
      ending: "stressed",
      beats: 7,
    });
    expect(analysed[2]?.sectionId).toBe("chorus-1");
    expect(analysed[7]?.sectionId).toBe("chorus-2");
  });
});

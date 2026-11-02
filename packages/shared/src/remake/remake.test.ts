import { describe, expect, it } from "vitest";
import {
  type Blueprint,
  BlueprintSchema,
  keepsTiming,
  ORIGINALITY_THRESHOLDS,
  OriginalityThresholdsSchema,
  RemakeAnalysisSchema,
  RemakeLyricsSchema,
} from "../index.js";

function shot(id: string, sectionId: string, startS: number, endS: number) {
  return {
    id,
    sectionId,
    startS,
    endS,
    offsetInSection: 0,
    layout: "full_bleed" as const,
    typographyRoles: [
      {
        role: "lyric" as const,
        weight: "bold" as const,
        case: "upper" as const,
        position: "bottom" as const,
      },
    ],
    palette: ["#101820"],
    motion: {
      camera: "push_in" as const,
      cutOnBeat: true,
      kineticText: "word_pop" as const,
      visualizer: null,
    },
    transition: "cut" as const,
    overlays: [{ kind: "lyric" as const, position: "bottom" }],
    imageNeed: "background" as const,
  };
}

function blueprint(): Blueprint {
  return {
    schemaVersion: 1,
    source: {
      videoId: "abc123def45",
      url: "https://www.youtube.com/watch?v=abc123def45",
      durationS: 30,
      analysedAt: "2026-11-01T00:00:00Z",
    },
    music: {
      bpm: 120,
      key: "A minor",
      timeSig: "4/4",
      sections: [
        {
          id: "intro-1",
          label: "intro",
          startS: 0,
          endS: 8,
          energy: 0.2,
          bars: 4,
        },
        {
          id: "verse-1",
          label: "verse",
          startS: 8,
          endS: 18,
          energy: 0.5,
          bars: 5,
        },
        {
          id: "chorus-1",
          label: "chorus",
          startS: 18,
          endS: 30,
          energy: 0.9,
          bars: 6,
        },
      ],
      downbeatsS: [0, 2, 4],
      vocal: "female",
      instrumentation: ["synth pads"],
    },
    shots: [
      shot("s1", "intro-1", 0, 8),
      shot("s2", "verse-1", 8, 18),
      shot("s3", "chorus-1", 18, 30),
    ],
    global: {
      palette: ["#101820", "#f2aa4c"],
      aspect: "16:9",
      typeScale: { basePx: 48, ratio: 1.25 },
    },
  };
}

describe("blueprint schema v1", () => {
  it("accepts the design's shape", () => {
    expect(BlueprintSchema.parse(blueprint()).shots).toHaveLength(3);
  });

  it("rejects overlapping shots, shots past the end and unknown sections", () => {
    const a = blueprint();
    a.shots[1] = { ...shot("s2", "verse-1", 7, 18) };
    expect(BlueprintSchema.safeParse(a).success).toBe(false);
    const b = blueprint();
    b.shots[2] = shot("s3", "chorus-1", 18, 40);
    expect(BlueprintSchema.safeParse(b).success).toBe(false);
    const c = blueprint();
    c.shots[2] = shot("s3", "ghost", 18, 30);
    expect(BlueprintSchema.safeParse(c).success).toBe(false);
  });

  it("rejects values outside the design's enums", () => {
    expect(
      BlueprintSchema.safeParse({
        ...blueprint(),
        global: { ...blueprint().global, aspect: "4:3" },
      }).success,
    ).toBe(false);
    const d = blueprint();
    (d.shots[0] as { layout: string }).layout = "collage";
    expect(BlueprintSchema.safeParse(d).success).toBe(false);
  });
});

describe("originality thresholds", () => {
  it("accepts the binding values and tighter ones, never looser", () => {
    expect(
      OriginalityThresholdsSchema.safeParse(ORIGINALITY_THRESHOLDS).success,
    ).toBe(true);
    expect(
      OriginalityThresholdsSchema.safeParse({
        ...ORIGINALITY_THRESHOLDS,
        lexical: 0.3,
      }).success,
    ).toBe(true);
    expect(
      OriginalityThresholdsSchema.safeParse({
        ...ORIGINALITY_THRESHOLDS,
        lexical: 0.5,
      }).success,
    ).toBe(false);
    expect(
      OriginalityThresholdsSchema.safeParse({
        ...ORIGINALITY_THRESHOLDS,
        semantic: 0.9,
      }).success,
    ).toBe(false);
    expect(
      OriginalityThresholdsSchema.safeParse({
        ...ORIGINALITY_THRESHOLDS,
        sectionMeaning: 0.4,
      }).success,
    ).toBe(false);
  });
});

describe("analysis schema", () => {
  const analysis = () => ({
    schemaVersion: 1,
    videoId: "abc123def45",
    url: "https://www.youtube.com/watch?v=abc123def45",
    title: "Night Song",
    protectedNames: [],
    sourceLanguage: "en",
    music: {
      durationS: 30,
      bpm: 120,
      beatTracker: "beat_this final0",
      key: { tonic: "A", mode: "minor", confidence: 0.8 },
      timeSignature: { beatsPerBar: 4, confidence: 0.9 },
      beats: [],
      downbeats: [],
      sections: [
        {
          id: "intro-1",
          kind: "intro",
          label: "Intro",
          start: 0,
          end: 8,
          audioLabel: "A",
          energy: 0.2,
        },
        {
          id: "verse-1",
          kind: "verse",
          label: "Verse 1",
          start: 8,
          end: 18,
          audioLabel: "B",
          energy: 0.4,
        },
        {
          id: "chorus-1",
          kind: "chorus",
          label: "Chorus 1",
          start: 18,
          end: 30,
          audioLabel: "B",
          energy: 0.9,
        },
      ],
      vocal: {
        type: "female",
        delivery: "sung",
        medianF0Hz: 300,
        voicedShare: 0.8,
        pitchStability: 0.8,
        notes: "",
      },
      instrumentation: { stemShares: null, inferred: [] },
      energy: [],
    },
    lines: [
      {
        index: 0,
        sectionId: "verse-1",
        start: 1,
        end: 3,
        text: "I walk alone",
        syllables: { min: 3, max: 3 },
        ending: "stressed",
        beats: 4,
      },
    ],
    meaning: [
      {
        sectionId: "verse-1",
        theme: "loneliness",
        storyBeat: "wandering",
        imagery: [],
        emotionalArc: "quiet",
        hookIdea: "",
      },
    ],
    overall: { genre: [], mood: [], summary: "" },
    blueprint: blueprint(),
    styleTags: [],
    cost: { usd: 0, calls: [] },
    sourceMediaDeleted: false,
  });

  it("accepts a consistent analysis", () => {
    expect(RemakeAnalysisSchema.safeParse(analysis()).success).toBe(true);
  });

  it("rejects lines and meaning entries for unknown sections", () => {
    const a = analysis();
    a.lines[0] = {
      ...(a.lines[0] as (typeof a.lines)[number]),
      sectionId: "ghost",
    };
    expect(RemakeAnalysisSchema.safeParse(a).success).toBe(false);
  });

  it("rejects a section kind outside the shared vocabulary", () => {
    const a = analysis();
    (a.music.sections[0] as { kind: string }).kind = "pre-chorus";
    expect(RemakeAnalysisSchema.safeParse(a).success).toBe(false);
  });
});

describe("lyrics schema", () => {
  it("rejects a stop reason outside the list", () => {
    const result = RemakeLyricsSchema.safeParse({
      jury: { stoppedBecause: "tired" },
    });
    expect(result.success).toBe(false);
  });
});

describe("keepsTiming (AC11)", () => {
  const source = {
    bpm: 100,
    sections: [
      { label: "verse", startS: 0, endS: 20 },
      { label: "chorus", startS: 20, endS: 40 },
    ],
  };
  it("passes within 5% tempo and 15% per section", () => {
    const r = keepsTiming(source, {
      bpm: 104,
      sections: [
        { label: "verse", startS: 0, endS: 22 },
        { label: "chorus", startS: 22, endS: 39.5 },
      ],
    });
    expect(r.ok).toBe(true);
  });
  it("fails on tempo, a long section or a changed sequence", () => {
    expect(keepsTiming(source, { ...source, bpm: 106 }).tempoOk).toBe(false);
    const long = keepsTiming(source, {
      bpm: 100,
      sections: [
        { label: "verse", startS: 0, endS: 24 },
        { label: "chorus", startS: 24, endS: 44 },
      ],
    });
    expect(long.sections.map((s) => s.ok)).toEqual([false, true]);
    expect(
      keepsTiming(source, {
        bpm: 100,
        sections: [...source.sections].reverse(),
      }).sequenceOk,
    ).toBe(false);
  });
});

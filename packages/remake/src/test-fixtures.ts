// Small hand-made fixtures shared by the unit tests (no network, no media).
import type {
  Blueprint,
  BlueprintShot,
  RemakeAnalysis,
} from "@mellodifai/shared";

export type FakeCall = { url: string; body: Record<string, unknown> };

// A fetch stand-in: `reply` maps each request to a JSON body (or an HTTP status).
export function fakeFetch(
  reply: (call: FakeCall) => unknown | { status: number; text: string },
): { fetchFn: typeof globalThis.fetch; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fetchFn = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const call = {
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    };
    calls.push(call);
    const out = reply(call);
    if (out && typeof out === "object" && "status" in out && "text" in out) {
      const { status, text } = out as { status: number; text: string };
      return new Response(text, { status });
    }
    return new Response(JSON.stringify(out), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetchFn, calls };
}

export function chatReply(content: unknown, cost = 0.001) {
  return {
    choices: [
      {
        message: {
          content:
            typeof content === "string" ? content : JSON.stringify(content),
        },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 50, cost },
  };
}

export function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new Error("fixture value missing");
  return value;
}

function shot(
  id: string,
  sectionId: string,
  startS: number,
  endS: number,
): BlueprintShot {
  return {
    id,
    sectionId,
    startS,
    endS,
    offsetInSection: 0,
    layout: "full_bleed",
    typographyRoles: [],
    palette: ["#101820"],
    motion: {
      camera: "static",
      cutOnBeat: true,
      kineticText: "none",
      visualizer: null,
    },
    transition: "cut",
    overlays: [],
    imageNeed: "background",
  };
}

export function blueprintFixture(): Blueprint {
  return {
    schemaVersion: 1,
    source: {
      videoId: "abc123def45",
      url: "https://www.youtube.com/watch?v=abc123def45",
      durationS: 30,
      analysedAt: "2026-11-01T00:00:00.000Z",
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
      downbeatsS: [0, 2],
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

export function analysisFixture(): RemakeAnalysis {
  return {
    schemaVersion: 1,
    videoId: "abc123def45",
    url: "https://www.youtube.com/watch?v=abc123def45",
    title: "Night Song",
    protectedNames: ["Some Artist", "Night Song"],
    sourceLanguage: "en",
    music: {
      durationS: 30,
      bpm: 120,
      beatTracker: "librosa",
      key: { tonic: "A", mode: "minor", confidence: 0.8 },
      timeSignature: { beatsPerBar: 4, confidence: 0.9 },
      beats: [0, 0.5, 1, 1.5, 2],
      downbeats: [0, 2],
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
          energy: 0.5,
        },
        {
          id: "chorus-1",
          kind: "chorus",
          label: "Chorus 1",
          start: 18,
          end: 30,
          audioLabel: "C",
          energy: 0.9,
        },
      ],
      vocal: {
        type: "female",
        delivery: "sung",
        medianF0Hz: 280,
        voicedShare: 0.6,
        pitchStability: 0.7,
        notes: "",
      },
      instrumentation: {
        stemShares: { vocals: 0.3, drums: 0.3, bass: 0.2, other: 0.2 },
        inferred: ["synth pads"],
      },
      energy: [{ t: 0, v: 0.2 }],
    },
    lines: [
      {
        index: 0,
        sectionId: "verse-1",
        start: 8.2,
        end: 12,
        text: "I walk alone through the empty streets",
        syllables: { min: 9, max: 9 },
        ending: "stressed",
        beats: 8,
      },
      {
        index: 1,
        sectionId: "chorus-1",
        start: 18.1,
        end: 22,
        text: "Hold on to the light tonight",
        syllables: { min: 7, max: 7 },
        ending: "stressed",
        beats: 8,
      },
    ],
    meaning: [
      {
        sectionId: "verse-1",
        theme: "loneliness",
        storyBeat: "the narrator wanders at night",
        imagery: ["empty streets"],
        emotionalArc: "quiet to restless",
        hookIdea: "",
      },
      {
        sectionId: "chorus-1",
        theme: "hope",
        storyBeat: "decides to keep going",
        imagery: ["light"],
        emotionalArc: "lift",
        hookIdea: "a call to hold on",
      },
    ],
    overall: { genre: ["synth pop"], mood: ["nocturnal"], summary: "" },
    blueprint: blueprintFixture(),
    styleTags: ["synth pop", "120 bpm"],
    cost: { usd: 0, calls: [] },
    sourceMediaDeleted: false,
  };
}

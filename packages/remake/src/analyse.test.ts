import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlueprintSchema, RemakeAnalysisSchema } from "@mellodifai/shared";
import { describe, expect, it } from "vitest";
import { analyse, lookToShot, parseKey, protectedNamesOf } from "./analyse.js";
import type { Env } from "./env.js";
import { createClient } from "./openrouter.js";
import type { Run } from "./run.js";
import { chatReply, type FakeCall, fakeFetch } from "./test-fixtures.js";

const ENV: Env = {
  files: [],
  get: () => undefined,
  require: () => "x",
  redact: (s) => s,
};

const LINES = [
  { start: 8.2, end: 11.8, text: "I walk alone through the empty streets" },
  { start: 12.1, end: 15.9, text: "the city sleeps but I cannot" },
  { start: 16.1, end: 19.8, text: "hold on to the light tonight" },
  { start: 20.1, end: 23.8, text: "hold on, don't let it go" },
  { start: 24.2, end: 27.8, text: "morning comes and finds me here" },
  { start: 28.1, end: 31.8, text: "counting cars along the road" },
  { start: 32.1, end: 35.8, text: "Hold on to the light tonight" },
  { start: 36.1, end: 39.8, text: "hold on don't let it go" },
];

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "remake-analyse-")).replaceAll(
    "\\",
    "/",
  );
  mkdirSync(join(dir, "sheets"));
  mkdirSync(join(dir, "frames"));
  for (const f of [
    "audio.wav",
    "video.mp4",
    "sheets/sheet_001.jpg",
    "sheets/sheet_002.jpg",
    "frames/scene_0001.jpg",
  ])
    writeFileSync(join(dir, f), "x");
  writeFileSync(
    join(dir, "source.info.json"),
    JSON.stringify({ width: 1280, height: 720 }),
  );
  writeFileSync(join(dir, "names.json"), JSON.stringify(["Some Artist"]));
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      videoId: "abc123def45",
      url: "https://www.youtube.com/watch?v=abc123def45",
      title: "Some Artist - Night Song (Official Music Video)",
      uploader: "Some Artist",
      durationS: 48,
      license: "Creative Commons Attribution license (reuse allowed)",
      language: "en",
      tags: [],
      description: "",
      files: {
        dir,
        audio: `${dir}/audio.wav`,
        video: `${dir}/video.mp4`,
        info: `${dir}/source.info.json`,
        captions: null,
      },
      transcript: { source: "captions", language: "en", lines: LINES },
      frames: {
        cutTimes: [0, 7.9, 16.1, 30.2],
        sceneCuts: [{ t: 0, file: `${dir}/frames/scene_0001.jpg` }],
        contactSheets: [
          {
            file: `${dir}/sheets/sheet_001.jpg`,
            start: 0,
            end: 20,
            cols: 5,
            rows: 4,
          },
          {
            file: `${dir}/sheets/sheet_002.jpg`,
            start: 20,
            end: 40,
            cols: 5,
            rows: 4,
          },
        ],
      },
      createdAt: "2026-11-01T00:00:00Z",
    }),
  );
  return dir;
}

function fakeRunner() {
  const calls: string[][] = [];
  const runner: Run = async (command, args) => {
    calls.push([command, ...args]);
    const script = args[1] ?? "";
    const out = args.at(-1) ?? "";
    if (args.includes("demucs")) {
      const stems = join(
        args[args.indexOf("-o") + 1] ?? "",
        "htdemucs",
        "audio",
      );
      mkdirSync(stems, { recursive: true });
      for (const s of ["vocals", "drums", "bass", "other"])
        writeFileSync(join(stems, `${s}.wav`), "x");
    } else if (script.endsWith("beats.py"))
      writeFileSync(
        out,
        JSON.stringify({
          tracker: "beat_this final0",
          beats: [],
          downbeats: [],
        }),
      );
    else if (script.endsWith("music.py"))
      writeFileSync(
        args[3] ?? "",
        JSON.stringify({
          duration: 48,
          bpm: 120,
          beatTracker: "beat_this final0",
          beats: Array.from({ length: 96 }, (_, i) => i * 0.5),
          downbeats: Array.from({ length: 24 }, (_, i) => i * 2),
          beatsPerBar: 4,
          meterConfidence: 0.95,
          boundaries: [7.7, 16.3, 24.1, 31.9, 40.2],
          labels: ["A", "B", "C", "B", "C", "A"],
          energy: Array.from({ length: 48 }, (_, t) => ({
            t,
            v: t >= 16 && t < 24 ? 0.9 : 0.4,
          })),
          stemShares: { vocals: 0.25, drums: 0.3, bass: 0.35, other: 0.1 },
          vocal: {
            medianF0Hz: 320,
            voicedShare: 0.8,
            pitchStability: 0.8,
            lowShare: 0.05,
            highShare: 0.9,
          },
        }),
      );
    else if (script.endsWith("analyze_audio.py"))
      writeFileSync(
        out,
        JSON.stringify({ key_global_top4: [["D minor", 0.75]] }),
      );
    return { code: 0, stdout: "", stderr: "" };
  };
  return { runner, calls };
}

function role(call: FakeCall) {
  const messages = call.body.messages as { content: unknown }[];
  return /ROLE: ([a-z ]+)/u.exec(String(messages[0]?.content))?.[1] ?? "?";
}

function client(meaning: (n: number) => unknown) {
  let n = 0;
  const { fetchFn, calls } = fakeFetch((call) => {
    if (role(call).startsWith("song analyst"))
      return chatReply(meaning(++n), 0.001);
    return chatReply(
      {
        global: {
          palette: ["#101820", "#f2aa4c", "red"],
          typeScale: { basePx: 64, ratio: 1.333 },
        },
        looks: {
          a: {
            layout: "full_bleed",
            palette: ["#101820"],
            motion: {
              camera: "push_in",
              kineticText: "word_pop",
              visualizer: null,
            },
            transition: "cut",
            overlays: [{ kind: "lyric", position: "bottom" }],
            imageNeed: "background",
            typographyRoles: [
              {
                role: "lyric",
                weight: "black",
                case: "upper",
                position: "bottom",
              },
            ],
          },
          b: {
            layout: "collage",
            motion: { camera: "orbit" },
            transition: "whip",
            imageNeed: "subject",
          },
        },
        shotLooks: ["a", "b", "a", "b"],
      },
      0.004,
    );
  });
  return { client: createClient({ key: "k", fetchFn, retries: 0 }), calls };
}

const goodMeaning = {
  overall: {
    genre: ["synth pop"],
    mood: ["nocturnal"],
    summary: "A night walk turns into resolve.",
    instrumentation: ["synth pads", "drum machine"],
    vocal: "female",
  },
  sections: ["verse-1", "chorus-1", "verse-2", "chorus-2"].map((sectionId) => ({
    sectionId,
    theme: "solitude in a city",
    storyBeat: "the narrator keeps moving",
    imagery: ["streetlights"],
    emotionalArc: "quiet to determined",
    hookIdea: "a call to endure",
  })),
};

describe("analyse", () => {
  it("builds a schema-valid analysis and blueprint, then deletes the source media", async () => {
    const dir = setup();
    const { runner, calls } = fakeRunner();
    const { client: c } = client(() => goodMeaning);
    const a = await analyse(dir, {
      env: ENV,
      client: c,
      run: runner,
      stemsPython: `${dir}/audio.wav`,
    });
    expect(RemakeAnalysisSchema.safeParse(a).success).toBe(true);
    expect(a.music.sections.map((s) => s.label)).toEqual([
      "Intro",
      "Verse 1",
      "Chorus 1",
      "Verse 2",
      "Chorus 2",
      "Outro",
    ]);
    expect(a.music.key).toEqual({
      tonic: "D",
      mode: "minor",
      confidence: 0.75,
    });
    expect(a.music.vocal).toMatchObject({ type: "female", delivery: "sung" });
    expect(a.blueprint.music).toMatchObject({
      bpm: 120,
      key: "D minor",
      timeSig: "4/4",
      vocal: "female",
    });
    expect(a.blueprint.shots[0]).toMatchObject({
      layout: "full_bleed",
      motion: { camera: "push_in", cutOnBeat: true },
    });
    // Unknown enum values from the model fall back to defaults.
    expect(a.blueprint.shots[1]).toMatchObject({
      layout: "full_bleed",
      transition: "whip",
      motion: { camera: "static" },
    });
    expect(a.blueprint.global).toMatchObject({
      aspect: "16:9",
      palette: ["#101820", "#f2aa4c"],
      typeScale: { basePx: 64 },
    });
    expect(a.protectedNames).toEqual(
      expect.arrayContaining(["Some Artist", "Night Song"]),
    );
    expect(a.styleTags).toEqual(
      expect.arrayContaining([
        "synth pop",
        "120 bpm",
        "d minor",
        "female vocals",
      ]),
    );
    expect(a.cost.usd).toBeCloseTo(0.005);
    expect(a.sourceMediaDeleted).toBe(true);
    for (const f of [
      "audio.wav",
      "video.mp4",
      "stems",
      "frames/scene_0001.jpg",
    ])
      expect(existsSync(join(dir, f))).toBe(false);
    for (const f of ["analysis.json", "blueprint.json", "sheets/sheet_001.jpg"])
      expect(existsSync(join(dir, f))).toBe(true);
    expect(
      BlueprintSchema.safeParse(
        JSON.parse(await readFile(join(dir, "blueprint.json"), "utf8")),
      ).success,
    ).toBe(true);
    // Demucs is forced onto the CPU.
    expect(calls.find((x) => x.includes("demucs"))).toEqual(
      expect.arrayContaining(["-d", "cpu"]),
    );
  });

  it("rejects a meaning map that quotes a line, then accepts the abstract retry", async () => {
    const dir = setup();
    const quoting = {
      ...goodMeaning,
      sections: goodMeaning.sections.map((s, i) =>
        i === 0
          ? { ...s, storyBeat: "I walk alone through the empty streets" }
          : s,
      ),
    };
    const { client: c, calls } = client((n) =>
      n === 1 ? quoting : goodMeaning,
    );
    const a = await analyse(dir, {
      env: ENV,
      client: c,
      run: fakeRunner().runner,
      stemsPython: `${dir}/audio.wav`,
      keepMedia: true,
    });
    expect(
      calls.filter((x) => role(x).startsWith("song analyst")),
    ).toHaveLength(2);
    expect(a.sourceMediaDeleted).toBe(false);
    expect(existsSync(join(dir, "audio.wav"))).toBe(true);
  });

  it("fails when the meaning map keeps naming the artist", async () => {
    const dir = setup();
    const naming = {
      ...goodMeaning,
      sections: goodMeaning.sections.map((s) => ({
        ...s,
        theme: "Some Artist feels lonely",
      })),
    };
    const { client: c } = client(() => naming);
    await expect(
      analyse(dir, {
        env: ENV,
        client: c,
        run: fakeRunner().runner,
        stemsPython: `${dir}/audio.wav`,
      }),
    ).rejects.toThrow(/names "Some Artist"/u);
  });
});

describe("helpers", () => {
  it("parses the engine's key estimate", () => {
    expect(parseKey([["A# major", 0.43]])).toEqual({
      tonic: "A#",
      mode: "major",
      confidence: 0.43,
    });
    expect(parseKey(undefined).confidence).toBe(0);
  });

  it("collects names to protect from the title and metadata", () => {
    const names = protectedNamesOf(
      {
        title: "The Sixsters - Alone (Official Music Video)",
        uploader: "The Sixsters",
      } as never,
      [],
    );
    expect(names).toEqual(["The Sixsters", "The Sixsters - Alone", "Alone"]);
  });

  it("coerces a missing look to defaults", () => {
    const shot = lookToShot(undefined, {
      id: "shot-001",
      start: 0,
      end: 2,
      sectionId: "intro-1",
      offsetInSection: 0,
      onBeat: false,
    });
    expect(shot).toMatchObject({
      layout: "full_bleed",
      transition: "cut",
      imageNeed: "background",
      motion: { cutOnBeat: false },
    });
  });
});

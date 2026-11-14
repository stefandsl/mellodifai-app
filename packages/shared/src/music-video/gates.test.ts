import { describe, expect, it } from "vitest";

import {
  bibleFor,
  costumePrompt,
  generationPrompt,
  PERFORMER_FACE,
} from "./bible.js";
import {
  type DraftMeasurements,
  evaluateDraftGates,
  GATE_THRESHOLDS,
  parseSceneCuts,
} from "./gates.js";

function draft(over: Partial<DraftMeasurements> = {}): DraftMeasurements {
  return {
    shot: { index: 5, kind: "lipsync-single", sung: true, performer: true },
    fps: 30,
    targetFrames: 351,
    measuredFrames: 351,
    sceneCuts: 0,
    lipSync: { offsetFrames: 1.2, confidence: 7.5 },
    identity: { faceCosine: 0.86, fullCosine: 0.8, facesFound: 8 },
    ...over,
  };
}

describe("draft gates", () => {
  it("passes a single sung shot that meets every threshold", () => {
    const result = evaluateDraftGates(draft());
    expect(result.pass).toBe(true);
    expect(result.checks.map((c) => c.gate)).toEqual([
      "duration",
      "cuts",
      "lip-sync",
      "identity",
    ]);
  });

  it("fails each gate on its own limit", () => {
    const failing = (over: Partial<DraftMeasurements>) =>
      evaluateDraftGates(draft(over))
        .checks.filter((c) => !c.pass)
        .map((c) => c.gate);
    expect(failing({ measuredFrames: 349 })).toEqual(["duration"]);
    expect(failing({ measuredFrames: 352 })).toEqual([]);
    expect(failing({ sceneCuts: 1 })).toEqual(["cuts"]);
    expect(failing({ lipSync: { offsetFrames: -2.4, confidence: 9 } })).toEqual(
      ["lip-sync"],
    );
    expect(failing({ lipSync: { offsetFrames: 2, confidence: 2.9 } })).toEqual([
      "lip-sync",
    ]);
    expect(failing({ lipSync: null })).toEqual(["lip-sync"]);
    expect(
      failing({
        identity: { faceCosine: 0.749, fullCosine: 0.9, facesFound: 3 },
      }),
    ).toEqual(["identity"]);
    // No face found is a failure, whatever the whole-image score says.
    const noFace = evaluateDraftGates(
      draft({
        identity: { faceCosine: null, fullCosine: 0.95, facesFound: 0 },
      }),
    );
    expect(noFace.pass).toBe(false);
    expect(noFace.checks.at(-1)?.note).toMatch(/no face found/u);
  });

  it("allows cuts in a burst and skips lip sync on an instrumental shot", () => {
    const burst = evaluateDraftGates(
      draft({
        shot: { index: 13, kind: "burst", sung: true, performer: true },
        sceneCuts: 4,
      }),
    );
    expect(burst.pass).toBe(true);
    expect(burst.checks.some((c) => c.gate === "cuts")).toBe(false);
    const broll = evaluateDraftGates(
      draft({
        shot: {
          index: 24,
          kind: "instrumental-broll",
          sung: false,
          performer: false,
        },
        lipSync: null,
        identity: null,
      }),
    );
    expect(broll.pass).toBe(true);
    expect(broll.checks.map((c) => c.gate)).toEqual(["duration", "cuts"]);
  });

  it("keeps the thresholds the brief asks for", () => {
    expect(GATE_THRESHOLDS.lipSyncMaxOffsetFrames).toBe(2);
    expect(GATE_THRESHOLDS.durationMaxErrorFrames).toBe(1);
    expect(GATE_THRESHOLDS.singleShotMaxCuts).toBe(0);
  });

  it("reads scene-change times from an ffmpeg showinfo log", () => {
    const log =
      "[Parsed_showinfo_1 @ 0] n:   0 pts:  51200 pts_time:3.33333 duration:512\n" +
      "[Parsed_showinfo_1 @ 0] n:   1 pts: 102400 pts_time:6.66667 duration:512\n";
    expect(parseSceneCuts(log)).toEqual([3.33333, 6.66667]);
    expect(parseSceneCuts("")).toEqual([]);
  });
});

describe("bible and generation prompts", () => {
  const song = {
    title: "Va bene, passa",
    language: "Italian",
    genre: "Italo-disco revival nu-disco",
    story: "an ironic office song about an AI bot.",
  };
  const bible = bibleFor(
    song,
    { id: "costume-a", outfit: "a navy blazer" },
    [
      { id: "costume-b", outfit: "a silver sequinned jacket" },
      { id: "costume-c", outfit: "a lilac tracksuit" },
    ],
    { id: "set-verse", description: "An open-plan office at night. Desks." },
    { id: "set-chorus", description: "A disco stage with an LED wall." },
  );

  it("names the same face in the performer prompt and edits only the outfit", () => {
    expect(bible.performer.prompt).toContain(PERFORMER_FACE);
    expect(bible.performer.prompt).toContain("a navy blazer");
    expect(bible.costumes.variants).toHaveLength(2);
    expect(costumePrompt({ id: "x", outfit: "a red coat" })).toMatch(
      /^Change only the outfit/u,
    );
  });

  it("links the chorus set to the verse set", () => {
    const chorus = bible.sets[1];
    expect(chorus?.containsSet).toBe("set-verse");
    expect(chorus?.prompt).toContain("An open-plan office at night");
  });

  it("quotes the exact lyrics and asks for one continuous shot", () => {
    const prompt = generationPrompt(
      {
        kind: "lipsync-single",
        camera: "close-up",
        burst: [],
        lyrics: "Col bot sono gentile,\nchiedo «per piacere»",
      },
      song.genre,
      {
        images: [
          { role: "performer", label: "the singer" },
          { role: "set", label: "the office" },
        ],
        video: "song-audio",
      },
    );
    expect(prompt).toContain('"Col bot sono gentile, / chiedo «per piacere»"');
    expect(prompt).toContain("A single continuous shot without any cuts.");
    expect(prompt).toContain("Image 2 is the office.");
    expect(prompt).toContain("use only its sound");
    expect(prompt).not.toContain("—");
  });

  it("asks a burst for five cuts and an instrumental shot for closed lips", () => {
    const burst = generationPrompt(
      {
        kind: "burst",
        camera: "orbit",
        burst: ["orbit", "close-up", "medium", "overhead", "dolly"],
        lyrics: "Va bene, passa!",
      },
      song.genre,
      { images: [], video: "song-audio" },
    );
    expect(burst).toContain("5 shots with different cuts");
    expect(burst).not.toContain("single continuous shot");
    const broll = generationPrompt(
      { kind: "instrumental-broll", camera: "overhead", burst: [], lyrics: "" },
      song.genre,
      { images: [], video: "previz" },
    );
    expect(broll).toContain("grey-box 3D blocking");
    expect(broll).toContain("mouth stays closed");
    expect(broll).not.toContain("sings exactly");
  });
});

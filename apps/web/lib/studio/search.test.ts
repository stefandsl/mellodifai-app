import { describe, expect, it } from "vitest";
import type { Clip } from "./clips";
import { fold, matchClip, searchClips, searchNames } from "./search";

function clip(id: string, patch: Partial<Clip>): Clip {
  return {
    id,
    title: id,
    style: "",
    prompt: "",
    lyrics: "",
    ...patch,
  } as Clip;
}

const songs = [
  clip("a", { title: "Notte a Roma", style: "pop, synth", lyrics: "luna" }),
  clip("b", {
    title: "Mare",
    style: "pop notturno",
    prompt: "una notte al mare",
  }),
  clip("c", { title: "Città di vetro", style: "rock", lyrics: "Roma brucia" }),
];

describe("fold", () => {
  it("drops accents and case", () => {
    expect(fold("Città ÈÀ Ñ")).toBe("citta ea n");
  });
});

describe("matchClip", () => {
  it("matches title, style, prompt and lyrics, ignoring accents and case", () => {
    expect(matchClip(songs[0] as Clip, "NOTTE")).toBe(true);
    expect(matchClip(songs[0] as Clip, "synth")).toBe(true);
    expect(matchClip(songs[0] as Clip, "luna")).toBe(true);
    expect(matchClip(songs[1] as Clip, "al mare")).toBe(true);
    expect(matchClip(songs[2] as Clip, "citta")).toBe(true);
    expect(matchClip(songs[2] as Clip, "rock jazz")).toBe(false);
  });

  it("needs every word, in any order", () => {
    expect(matchClip(songs[0] as Clip, "roma notte")).toBe(true);
    expect(matchClip(songs[0] as Clip, "roma mare")).toBe(false);
  });

  it("matches everything for an empty query", () => {
    expect(matchClip(songs[0] as Clip, "  ")).toBe(true);
  });
});

describe("searchClips", () => {
  it("returns nothing for an empty query", () => {
    expect(searchClips(songs, "")).toEqual([]);
  });

  it("puts title matches before style and the rest", () => {
    expect(searchClips(songs, "notte").map((c) => c.id)).toEqual(["a", "b"]);
    expect(searchClips(songs, "roma").map((c) => c.id)).toEqual(["a", "c"]);
    expect(searchClips(songs, "pop").map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("finds a word that only the lyrics hold", () => {
    expect(searchClips(songs, "brucia").map((c) => c.id)).toEqual(["c"]);
  });
});

describe("searchNames", () => {
  it("filters named things and returns none for an empty query", () => {
    const lists = [
      { name: "Sera" },
      { name: "Allenamento" },
      { name: "Serata" },
    ];
    expect(searchNames(lists, "sera").map((l) => l.name)).toEqual([
      "Sera",
      "Serata",
    ]);
    expect(searchNames(lists, "")).toEqual([]);
  });
});

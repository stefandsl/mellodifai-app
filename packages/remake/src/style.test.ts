import { describe, expect, it } from "vitest";
import { deriveStyleTags, sanitizeTags } from "./style.js";
import { analysisFixture } from "./test-fixtures.js";

describe("deriveStyleTags", () => {
  it("builds tags from tempo, key, vocals, instrumentation and mood", () => {
    const a = analysisFixture();
    const tags = deriveStyleTags(a.music, a.overall, a.protectedNames);
    expect(tags).toEqual(
      expect.arrayContaining([
        "synth pop",
        "nocturnal",
        "120 bpm",
        "a minor",
        "female vocals",
        "synth pads",
      ]),
    );
    expect(tags.every((t) => t === t.toLowerCase())).toBe(true);
  });

  it("notes odd meters and a lifted chorus", () => {
    const a = analysisFixture();
    a.music.timeSignature.beatsPerBar = 3;
    const tags = deriveStyleTags(a.music, a.overall, []);
    expect(tags).toContain("3/4 time");
    expect(tags).toContain("big chorus lift");
  });
});

describe("sanitizeTags", () => {
  it("drops artist names, title words and comparisons", () => {
    expect(
      sanitizeTags(
        [
          "Synth Pop",
          "like Coldplay",
          "in the style of Some Artist",
          "Some Artist vibes",
          "night song energy",
          "dreamy",
          "dreamy",
          "inspired by the 80s",
        ],
        ["Some Artist", "Night Song"],
      ),
    ).toEqual(["synth pop", "dreamy"]);
  });
});

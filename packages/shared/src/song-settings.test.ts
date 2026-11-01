import { describe, expect, it } from "vitest";
import {
  MAX_SONGS_PER_CLICK,
  musicTags,
  readControls,
  SEED_LIMIT,
  SEED_MAX,
  SongSettingsSchema,
  styleWithout,
  withMusicTags,
} from "./song-settings.js";

describe("SongSettingsSchema.engine", () => {
  it("defaults to kie so projects created before local engines keep working", () => {
    expect(SongSettingsSchema.parse({}).engine).toBe("kie");
  });
  it("keeps the local engines and rejects unknown ones", () => {
    expect(SongSettingsSchema.parse({ engine: "yue2" }).engine).toBe("yue2");
    expect(SongSettingsSchema.parse({ engine: "ace-step" }).engine).toBe(
      "ace-step",
    );
    expect(SongSettingsSchema.safeParse({ engine: "suno" }).success).toBe(
      false,
    );
  });
});

describe("SongSettingsSchema musical controls", () => {
  it("keeps every control optional so older projects still parse", () => {
    const parsed = SongSettingsSchema.parse({});
    expect(parsed.bpm).toBeUndefined();
    expect(parsed.keyscale).toBeUndefined();
    expect(parsed.timeSignature).toBeUndefined();
    expect(parsed.seed).toBeUndefined();
    expect(parsed.steps).toBeUndefined();
    expect(parsed.guidance).toBeUndefined();
  });
  it("accepts values inside the ranges and rejects the rest", () => {
    const ok = {
      bpm: 120,
      keyscale: "D minor",
      timeSignature: "3",
      seed: 12345,
      steps: 30,
      guidance: 7,
    };
    expect(SongSettingsSchema.parse(ok)).toMatchObject(ok);
    for (const bad of [
      { bpm: 39 },
      { bpm: 241 },
      { bpm: 120.5 },
      { keyscale: "H major" },
      { keyscale: "C dorian" },
      { timeSignature: "5" },
      { seed: -1 },
      { seed: 2 ** 48 - 1 },
      { seed: 1.5 },
      { steps: 9 },
      { steps: 101 },
      { guidance: 0.5 },
      { guidance: 15.5 },
    ])
      expect(
        SongSettingsSchema.safeParse(bad).success,
        JSON.stringify(bad),
      ).toBe(false);
  });
  it("leaves room above the seed for take 2 and the extra songs of one click", () => {
    expect(SEED_MAX + 2 * (MAX_SONGS_PER_CLICK - 1)).toBeLessThanOrEqual(
      SEED_LIMIT,
    );
    expect(SEED_LIMIT + 1).toBeLessThan(2 ** 48);
  });
});

describe("musicTags", () => {
  it("is empty for Auto", () => {
    expect(musicTags({})).toEqual([]);
  });
  it("writes tempo, key and time signature the way the engines read them", () => {
    expect(
      musicTags({ bpm: 96, keyscale: "Eb major", timeSignature: "6" }),
    ).toEqual(["96 BPM", "Eb major", "6/8 time"]);
    expect(musicTags({ timeSignature: "4" })).toEqual(["4/4 time"]);
  });
});

describe("withMusicTags", () => {
  it("returns the style untouched when nothing is chosen", () => {
    expect(withMusicTags("synth pop, dreamy", {})).toBe("synth pop, dreamy");
  });
  it("appends the tags after the style", () => {
    expect(withMusicTags("synth pop, dreamy", { bpm: 100 })).toBe(
      "synth pop, dreamy, 100 BPM",
    );
    expect(withMusicTags("", { keyscale: "A minor" })).toBe("A minor");
  });
  it("replaces a tempo or key the drafted style already names, only for the fields chosen", () => {
    expect(
      withMusicTags("synth pop, 90 BPM, C major, dreamy", { bpm: 120 }),
    ).toBe("synth pop, C major, dreamy, 120 BPM");
    expect(
      withMusicTags("synth pop, 90 BPM, C major, dreamy", {
        keyscale: "D minor",
        timeSignature: "3",
      }),
    ).toBe("synth pop, 90 BPM, dreamy, D minor, 3/4 time");
  });
  it("drops the tags rather than overflowing the style limit", () => {
    const long = "x".repeat(995);
    expect(withMusicTags(long, { bpm: 100 })).toBe(long);
  });
});

describe("styleWithout", () => {
  it("returns the same string when nothing is chosen", () => {
    expect(styleWithout("pop, 90 BPM,  dreamy", {})).toBe(
      "pop, 90 BPM,  dreamy",
    );
  });
  it("removes only what the user overrides", () => {
    expect(styleWithout("pop, 90 BPM, A minor", { bpm: 100 })).toBe(
      "pop, A minor",
    );
  });
});

describe("readControls", () => {
  it("reads valid fields and ignores the rest one by one", () => {
    expect(
      readControls({
        bpm: 99,
        keyscale: "nope",
        seed: -3,
        steps: 40,
        guidance: 7.5,
        timeSignature: "9",
        model: "V6",
      }),
    ).toEqual({ bpm: 99, steps: 40, guidance: 7.5 });
    expect(readControls(null)).toEqual({});
    expect(readControls("x")).toEqual({});
  });
});

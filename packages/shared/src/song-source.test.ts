import { describe, expect, it } from "vitest";
import { SongSettingsSchema } from "./song-settings.js";
import {
  AudioSourceSchema,
  LICENCE_SHORT,
  licenceForbidsDerivatives,
  licenceNonCommercial,
  parseSongSource,
  SOURCE_LICENCES,
  sourceModesFor,
} from "./song-source.js";

const OWNER = "4b6f8d2e-1c3a-4e5f-9a7b-2c4d6e8f0a1b";
const FILE = "7c9e1a3b-5d7f-4b2c-8e4a-6f8b0c2d4e6f";

describe("song source", () => {
  it("keeps a full record and drops empty fields", () => {
    expect(
      parseSongSource({
        kind: "suno",
        title: " La mia canzone ",
        author: "",
        url: "https://suno.com/s/abc123",
        licence: "own",
      }),
    ).toEqual({
      kind: "suno",
      title: "La mia canzone",
      url: "https://suno.com/s/abc123",
      licence: "own",
    });
    expect(parseSongSource({ kind: "upload" })?.licence).toBe("unknown");
    expect(parseSongSource({ kind: "upload", url: "javascript:x" })).toBeNull();
    expect(parseSongSource({ kind: "nope" })).toBeNull();
  });
  it("knows what each licence allows", () => {
    expect(SOURCE_LICENCES).toContain("cc-by-sa");
    expect(LICENCE_SHORT["cc-by-sa"]).toBe("CC BY-SA 4.0");
    expect(LICENCE_SHORT.own).toBeNull();
    expect(licenceForbidsDerivatives("cc-by-nd")).toBe(true);
    expect(licenceForbidsDerivatives("cc-by")).toBe(false);
    expect(licenceNonCommercial("cc-by-nc-sa")).toBe(true);
    expect(licenceNonCommercial("cc-by-sa")).toBe(false);
  });
});

describe("audio source of a new song", () => {
  it("takes an upload of the owner's folder or a take, not both", () => {
    const upload = `${OWNER}/audio/${FILE}.mp3`;
    expect(AudioSourceSchema.safeParse({ mode: "cover", upload }).success).toBe(
      true,
    );
    expect(
      AudioSourceSchema.safeParse({ mode: "cover", takeId: FILE }).success,
    ).toBe(true);
    expect(
      AudioSourceSchema.safeParse({ mode: "cover", upload, takeId: FILE })
        .success,
    ).toBe(false);
    expect(AudioSourceSchema.safeParse({ mode: "cover" }).success).toBe(false);
    expect(
      AudioSourceSchema.safeParse({
        mode: "cover",
        upload: `${OWNER}/${FILE}.mp3`,
      }).success,
    ).toBe(false);
    expect(
      AudioSourceSchema.safeParse({ mode: "extend", upload, continueAt: 500 })
        .success,
    ).toBe(false);
  });
  it("lives in the song settings", () => {
    const parsed = SongSettingsSchema.parse({
      source: { mode: "reference", takeId: FILE, title: "Solo un caffè" },
    });
    expect(parsed.source?.mode).toBe("reference");
  });
  it("offers each engine only what it can do", () => {
    expect(sourceModesFor("kie")).toEqual(["cover", "reference", "extend"]);
    expect(sourceModesFor("ace-step")).toEqual(["cover"]);
    expect(sourceModesFor("yue2")).toEqual([]);
  });
});

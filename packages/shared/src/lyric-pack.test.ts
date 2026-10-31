import { describe, expect, it } from "vitest";
import frPack from "../test/fixtures/fr-pack.json" with { type: "json" };

import { validateLyricPack } from "./lyric-pack.js";

describe("validateLyricPack", () => {
  it("rejects an em dash and names the affected field", () => {
    const result = validateLyricPack(
      { ...frPack, title: `Bad\u2014title` },
      "general",
    );

    expect(result).toEqual({
      ok: false,
      errors: ["title contains an em dash"],
    });
  });

  it("rejects VBP packs that do not have exactly 80 sung lines", () => {
    const result = validateLyricPack(
      { ...frPack, lyrics: "[Verse]\nOne\nTwo" },
      "vbp",
    );

    expect(result).toEqual({
      ok: false,
      errors: [
        "lyrics must contain exactly 80 sung lines for the vbp theme (found 2)",
      ],
    });
  });

  it("accepts the shipped French pack", () => {
    expect(validateLyricPack(frPack, "vbp")).toEqual({ ok: true });
  });
});

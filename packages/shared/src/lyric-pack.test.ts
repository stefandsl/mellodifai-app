import { describe, expect, it } from "vitest";
import frPack from "../test/fixtures/fr-pack.json" with { type: "json" };

import { LyricPackSchema, validateLyricPack } from "./lyric-pack.js";

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

  it("accepts every studio model, a variety step, Auto duration and no vocal preference", () => {
    const { vocalGender: _omit, ...settings } = frPack.settings as Record<
      string,
      unknown
    >;
    const parsed = LyricPackSchema.parse({
      ...frPack,
      settings: { ...settings, model: "V6_WILD", variety: 3, duration: null },
    });
    expect(parsed.settings).toMatchObject({
      model: "V6_WILD",
      variety: 3,
      duration: null,
    });
    expect(parsed.settings.vocalGender).toBeUndefined();
  });

  it("keeps the legacy defaults for packs written before the studio", () => {
    const parsed = LyricPackSchema.parse(frPack);
    expect(parsed.settings).toMatchObject({ variety: 1 });
    expect(
      LyricPackSchema.parse({
        ...frPack,
        settings: { model: "V6", vocalGender: "f" },
      }).settings.duration,
    ).toBe(310);
  });
});

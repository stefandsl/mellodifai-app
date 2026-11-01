import { describe, expect, it } from "vitest";
import {
  ASPECT_SIZE,
  backgroundAsset,
  CLASSICO_COLORS,
  COLOR_PRESETS,
  classicoLines,
  colorPresetOf,
  defaultVisualizerParams,
  normalizeVisualizerParams,
  rerollSeed,
  STOCK_BACKGROUNDS,
  stockBackground,
  uploadPathOf,
  uploadUrlOf,
  VISUALIZER_EFFECTS,
  VISUALIZER_PRESETS,
  VisualizerParamsSchema,
} from "./viz-params.js";

describe("visualizer parameters", () => {
  it("has the presets of T13 plus Cerchio, Specchio and MellodifAI Classico", () => {
    for (const id of [
      "spectrum",
      "circle",
      "mirror",
      "waveform",
      "particles",
      "minimal",
      "classico",
    ])
      expect(VISUALIZER_PRESETS).toContain(id);
  });

  it("has the six effects of T13 in the order they are applied", () => {
    expect(VISUALIZER_EFFECTS).toEqual([
      "grain",
      "vhs",
      "scanlines",
      "vignette",
      "aberration",
      "glitch",
    ]);
  });

  it("offers ten colour presets, the first from the MellodifAI red", () => {
    expect(COLOR_PRESETS).toHaveLength(10);
    expect(COLOR_PRESETS[0]).toMatchObject({
      id: "mellodifai",
      primary: "#f2333d",
    });
    expect(new Set(COLOR_PRESETS.map((c) => c.id)).size).toBe(10);
  });

  it("defaults validate against the strict schema", () => {
    const params = defaultVisualizerParams();
    expect(VisualizerParamsSchema.parse(params)).toEqual(params);
    expect(params.background.dimming).toBe(60);
    expect(params.particles).toBe(30);
    expect(params.effects.map((e) => e.id)).toEqual([...VISUALIZER_EFFECTS]);
    expect(params.effects.every((e) => !e.enabled && e.intensity === 50)).toBe(
      true,
    );
  });

  it("renders 16:9 at 1920x1080 and true full-frame 9:16 at 1080x1920", () => {
    expect(ASPECT_SIZE["16:9"]).toEqual({ width: 1920, height: 1080 });
    expect(ASPECT_SIZE["9:16"]).toEqual({ width: 1080, height: 1920 });
  });

  it("rejects out-of-range values and foreign links in the strict schema", () => {
    const base = defaultVisualizerParams();
    const bad = [
      { ...base, particles: 101 },
      { ...base, background: { ...base.background, dimming: -1 } },
      { ...base, colors: { primary: "red", secondary: "#000000" } },
      {
        ...base,
        background: {
          ...base.background,
          assetUrl: "https://evil.example/x.jpg",
        },
      },
      {
        ...base,
        centerImage: {
          mode: "upload",
          assetUrl: "/media/uploads/../previews/x",
        },
      },
      {
        ...base,
        textLayers: Array.from({ length: 7 }, () => ({
          text: "x",
          x: 50,
          y: 50,
          size: 40,
          color: "#ffffff",
        })),
      },
      { ...base, effects: [base.effects[0], base.effects[0]] },
    ];
    for (const value of bad)
      expect(VisualizerParamsSchema.safeParse(value).success).toBe(false);
  });

  it("normalizes saved values field by field, keeping what is valid", () => {
    const params = normalizeVisualizerParams({
      preset: "mirror",
      aspect: "9:16",
      background: {
        mode: "video",
        dimming: 999,
        assetUrl: "/media/uploads/u/a.mp4",
      },
      colors: { primary: "#ABCDEF", secondary: 12 },
      effects: [{ id: "glitch", enabled: true, intensity: 80 }, { id: "nope" }],
      textLayers: [
        { text: "Ciao", x: 10, y: 20, size: 40, color: "#ffffff" },
        { text: "rotto" },
      ],
    });
    expect(params.preset).toBe("mirror");
    expect(params.aspect).toBe("9:16");
    expect(params.background).toEqual({
      mode: "video",
      seed: 0,
      assetUrl: "/media/uploads/u/a.mp4",
      dimming: 60,
    });
    expect(params.colors).toEqual({ primary: "#abcdef", secondary: "#2ee6d6" });
    expect(params.effects).toHaveLength(6);
    expect(params.effects.find((e) => e.id === "glitch")).toEqual({
      id: "glitch",
      enabled: true,
      intensity: 80,
    });
    expect(params.textLayers).toEqual([
      { text: "Ciao", x: 10, y: 20, size: 40, color: "#ffffff" },
    ]);
    expect(VisualizerParamsSchema.safeParse(params).success).toBe(true);
    expect(normalizeVisualizerParams(null)).toEqual(defaultVisualizerParams());
    expect(normalizeVisualizerParams("garbage")).toEqual(
      defaultVisualizerParams(),
    );
  });

  it("links uploads through /media and reads the stored path back", () => {
    const url = uploadUrlOf("abc/def 1.png");
    expect(url).toBe("/media/uploads/abc/def%201.png");
    expect(uploadPathOf(url)).toBe("abc/def 1.png");
    expect(uploadPathOf("/media/previews/x.mp4")).toBeNull();
    expect(uploadPathOf(null)).toBeNull();
  });

  it("re-rolls Casuale to a different stock picture every time", () => {
    let seed = 0;
    for (let i = 0; i < 50; i++) {
      const next = rerollSeed(seed);
      expect(stockBackground(next)).not.toBe(stockBackground(seed));
      expect(Number.isInteger(next) && next >= 0).toBe(true);
      seed = next;
    }
    expect(STOCK_BACKGROUNDS).toContain(stockBackground(123456));
    const params = defaultVisualizerParams();
    expect(backgroundAsset(params)).toBe(
      `/media/uploads/${STOCK_BACKGROUNDS[0]}`,
    );
    params.background = { ...params.background, mode: "image", assetUrl: null };
    expect(backgroundAsset(params)).toBeNull();
  });

  it("names the colour preset the colours match, else none", () => {
    const params = defaultVisualizerParams();
    expect(colorPresetOf(params)).toBe("mellodifai");
    params.colors = { ...CLASSICO_COLORS };
    expect(colorPresetOf(params)).toBeNull();
  });

  it("stacks the Classico text in one order and drops empty lines", () => {
    const params = defaultVisualizerParams();
    expect(classicoLines(params, "Astri lounge").map((l) => l.text)).toEqual([
      "SONG: ASTRI LOUNGE",
      "by AIMELODIA",
      "STEFANDSL.COM",
    ]);
    params.classico.album = "Italian rap";
    params.classico.website = "";
    expect(classicoLines(params, "").map((l) => l.text)).toEqual([
      "by AIMELODIA",
      "ALBUM: ITALIAN RAP",
    ]);
  });
});

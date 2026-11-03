import { describe, expect, it } from "vitest";
import {
  ASPECT_SIZE,
  backgroundAsset,
  CLASSICO_COLORS,
  COLOR_PRESETS,
  CROWN_TEETH,
  classicoLines,
  colorPresetOf,
  defaultVisualizerParams,
  LOGO_POSITIONS,
  LOGO_SIZE,
  MAX_LOGOS,
  newLogo,
  normalizeVisualizerParams,
  PARTICLE_SHAPES,
  renderSize,
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

  it("adds the thirteen catalogue looks, each once", () => {
    const looks = [
      "dotline",
      "burst",
      "crown",
      "wirering",
      "lens",
      "pills",
      "edgebars",
      "coverframe",
      "playercard",
      "contours",
      "synthwave",
      "editorial",
      "shaped",
    ];
    for (const id of looks) expect(VISUALIZER_PRESETS).toContain(id);
    expect(new Set(VISUALIZER_PRESETS).size).toBe(VISUALIZER_PRESETS.length);
    expect(CROWN_TEETH).toHaveLength(5);
    expect(PARTICLE_SHAPES).toHaveLength(8);
  });

  it("reads rows saved before the catalogue looks with the default look and no badges", () => {
    const { look, badges, ...old } = defaultVisualizerParams();
    const parsed = VisualizerParamsSchema.parse(old);
    expect(parsed.look).toEqual(look);
    expect(parsed.badges).toEqual({ enabled: false, text: "" });
    expect(normalizeVisualizerParams(old)).toEqual(defaultVisualizerParams());
    const kept = normalizeVisualizerParams({
      preset: "crown",
      look: { teeth: "pin", mirrored: false, shape: "nope" },
      badges: { enabled: true, text: "Nuovo singolo" },
    });
    expect(kept.look).toMatchObject({
      teeth: "pin",
      mirrored: false,
      shape: "circle",
    });
    expect(kept.badges).toEqual({ enabled: true, text: "Nuovo singolo" });
    expect(
      VisualizerParamsSchema.safeParse({
        ...kept,
        badges: { enabled: true, text: "x".repeat(41) },
      }).success,
    ).toBe(false);
  });

  it("reads rows saved before the cover fit and the contour line options", () => {
    const d = defaultVisualizerParams();
    const { fit, ...centerImage } = d.centerImage;
    const { contourWeight, contourOpacity, ...look } = d.look;
    const old = { ...d, centerImage, look };
    const parsed = VisualizerParamsSchema.parse(old);
    expect(parsed.centerImage.fit).toBe("cover");
    expect(parsed.look.contourOpacity).toBe(contourOpacity);
    expect(parsed.look.contourWeight).toBe(contourWeight);
    expect(normalizeVisualizerParams(old)).toEqual(d);
    const kept = normalizeVisualizerParams({
      centerImage: { mode: "cover", assetUrl: null, fit: "contain" },
      look: { contourWeight: 4, contourOpacity: 20 },
    });
    expect(kept.centerImage.fit).toBe("contain");
    expect(kept.look.contourWeight).toBe(4);
    // Below 60 the lines could not hold their contrast: back to the default.
    expect(kept.look.contourOpacity).toBe(contourOpacity);
    expect(fit).toBe("cover");
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

  it("reads older settings as 1080p and sizes both 4K aspects", () => {
    expect(normalizeVisualizerParams({ aspect: "9:16" }).quality).toBe("1080p");
    expect(normalizeVisualizerParams({ quality: "4K" }).quality).toBe("4K");
    expect(normalizeVisualizerParams({ quality: "8K" }).quality).toBe("1080p");
    expect(renderSize("16:9", "4K")).toEqual({ width: 3840, height: 2160 });
    expect(renderSize("9:16", "4K")).toEqual({ width: 2160, height: 3840 });
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
    ]);
    params.classico.artist = "Lucia";
    params.classico.website = "lucia.example";
    expect(classicoLines(params, "Astri lounge").map((l) => l.text)).toEqual([
      "SONG: ASTRI LOUNGE",
      "by LUCIA",
      "LUCIA.EXAMPLE",
    ]);
    params.classico.album = "Italian rap";
    params.classico.website = "";
    expect(classicoLines(params, "").map((l) => l.text)).toEqual([
      "by LUCIA",
      "ALBUM: ITALIAN RAP",
    ]);
  });
});

describe("no built-in branding (Task 28)", () => {
  it("starts with no artist, website or album line, and no logos", () => {
    const d = defaultVisualizerParams();
    expect(d.classico).toEqual({
      artist: "",
      website: "",
      album: "",
      cards: true,
    });
    expect(d.logos).toEqual([]);
    expect(JSON.stringify(d)).not.toMatch(/AIMELODIA|STEFANDSL|MELLODIFAI/u);
    expect("gramophone" in d.classico).toBe(false);
  });

  it("reads the old default lines of a set saved before the logos as empty", () => {
    const saved = {
      ...defaultVisualizerParams(),
      classico: {
        artist: "AIMELODIA",
        website: "STEFANDSL.COM",
        album: "Lampioni",
        gramophone: "black",
        cards: false,
      },
    } as Record<string, unknown>;
    delete saved.logos;
    const read = normalizeVisualizerParams(saved);
    expect(read.classico).toEqual({
      artist: "",
      website: "",
      album: "Lampioni",
      cards: false,
    });
    expect(read.logos).toEqual([]);
    // Anything else the user typed stays, even an old set.
    for (const [artist, website] of [
      ["Aimelodia", "stefandsl.com"],
      ["AIMELODIA ", "WWW.STEFANDSL.COM"],
      ["Lucia", "lucia.example"],
    ] as const) {
      const kept = normalizeVisualizerParams({
        ...saved,
        classico: { artist, website, album: "", cards: true },
      });
      expect(kept.classico.artist).toBe(artist);
      expect(kept.classico.website).toBe(website);
    }
    // A set saved after the logos keeps the old words: the user typed them.
    const typed = normalizeVisualizerParams({
      ...saved,
      logos: [],
      classico: { artist: "AIMELODIA", website: "STEFANDSL.COM" },
    });
    expect(typed.classico.artist).toBe("AIMELODIA");
    expect(typed.classico.website).toBe("STEFANDSL.COM");
  });

  it("keeps up to two logos, reading each field by field", () => {
    const url = "/media/uploads/u/0b4f9c1e-1111-4b7a-9c2e-123456789abc.png";
    const read = normalizeVisualizerParams({
      logos: [
        { assetUrl: url, position: "bottom-left", size: 20, opacity: 70 },
        { assetUrl: url, position: "middle", size: 99, opacity: -5 },
        { assetUrl: "https://evil.example/logo.png", position: "top-left" },
        { assetUrl: url },
      ],
    });
    expect(read.logos).toEqual([
      { assetUrl: url, position: "bottom-left", size: 20, opacity: 70 },
      {
        assetUrl: url,
        position: "top-right",
        size: LOGO_SIZE.default,
        opacity: 100,
      },
    ]);
    expect(normalizeVisualizerParams({ logos: "nope" }).logos).toEqual([]);
    expect(
      normalizeVisualizerParams({ logos: [null, 3, { size: 10 }] }).logos,
    ).toEqual([]);
    expect(VisualizerParamsSchema.safeParse(read).success).toBe(true);
    const base = defaultVisualizerParams();
    const logo = {
      assetUrl: url,
      position: "top-left",
      size: 12,
      opacity: 100,
    };
    for (const bad of [
      [logo, logo, logo],
      [{ ...logo, size: 3 }],
      [{ ...logo, size: 31 }],
      [{ ...logo, opacity: 101 }],
      [{ ...logo, position: "centre" }],
      [{ ...logo, assetUrl: "/media/uploads/../previews/x.png" }],
    ])
      expect(
        VisualizerParamsSchema.safeParse({ ...base, logos: bad }).success,
      ).toBe(false);
    expect(LOGO_POSITIONS).toHaveLength(4);
    expect(MAX_LOGOS).toBe(2);
  });

  it("puts a new logo in the first free corner, top right first", () => {
    const url = "/media/uploads/u/a.png";
    const first = newLogo(url);
    expect(first).toEqual({
      assetUrl: url,
      position: "top-right",
      size: 12,
      opacity: 100,
    });
    expect(newLogo(url, [first]).position).toBe("top-left");
  });
});

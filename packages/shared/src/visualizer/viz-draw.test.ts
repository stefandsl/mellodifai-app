import { describe, expect, it } from "vitest";
import { BAND_COUNT, WAVE_POINTS } from "./viz-audio.js";
import {
  barValues,
  type Canvas2D,
  centerLayout,
  classicoLayout,
  createVisualizerRenderer,
  particleAt,
  particleCount,
  type ScratchCanvas,
  stackLine,
  subscribeWindow,
  type VisualizerScene,
} from "./viz-draw.js";
import {
  COVER_FITS,
  contrastRatio,
  focusOfPixels,
  lineBackdrop,
  type Rgb,
  safeArea,
  shapedBars,
  typeScale,
  withFocus,
} from "./viz-kit.js";
import {
  CONTOUR_CONTRAST,
  contourInk,
  LOOK_PRESETS,
  shapedParticleAt,
} from "./viz-looks.js";
import {
  COLOR_PRESETS,
  CROWN_TEETH,
  defaultVisualizerParams,
  PARTICLE_SHAPES,
  VISUALIZER_EFFECTS,
  VISUALIZER_PRESETS,
  type VisualizerParams,
} from "./viz-params.js";

type Call = [string, ...unknown[]];

// A context that records what it is asked to draw, with the state at each fill.
function recorder(width: number, height: number) {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    shadowBlur: 0,
    shadowColor: "transparent",
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
  };
  const stack: Record<string, unknown>[] = [];
  const canvas: ScratchCanvas = { width, height, getContext: () => ctx };
  const gradient = (kind: string, args: unknown[]) => {
    const stops: [number, string][] = [];
    return {
      kind,
      args,
      stops,
      addColorStop: (o: number, c: string) => stops.push([o, c]),
    };
  };
  const method =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const ctx = new Proxy(
    {
      canvas,
      save: () => {
        stack.push({ ...state });
        calls.push(["save"]);
      },
      restore: () => {
        Object.assign(state, stack.pop());
        calls.push(["restore"]);
      },
      fillRect: (...args: unknown[]) =>
        calls.push([
          "fillRect",
          ...args,
          state.fillStyle,
          state.globalAlpha,
          state.globalCompositeOperation,
        ]),
      fill: () => calls.push(["fill", state.fillStyle, state.globalAlpha]),
      stroke: () =>
        calls.push([
          "stroke",
          state.strokeStyle,
          state.globalAlpha,
          state.lineWidth,
        ]),
      fillText: (...args: unknown[]) =>
        calls.push(["fillText", ...args, state.font]),
      measureText: (text: string) => ({ width: text.length * 10 }),
      createLinearGradient: (...args: unknown[]) => gradient("linear", args),
      createRadialGradient: (...args: unknown[]) => gradient("radial", args),
      createImageData: (w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
      }),
    } as Record<string, unknown>,
    {
      get(target, key: string) {
        if (key in target) return target[key];
        if (key in state) return state[key];
        return method(key);
      },
      set(_target, key: string, value) {
        state[key] = value;
        return true;
      },
    },
  ) as unknown as Canvas2D;
  return { ctx, calls };
}

const pic = (width = 512, height = 512) => ({
  source: { id: "pic" },
  width,
  height,
});

function scene(
  params: VisualizerParams,
  over: Partial<VisualizerScene> = {},
): VisualizerScene {
  const { width, height } =
    params.aspect === "16:9"
      ? { width: 1920, height: 1080 }
      : { width: 1080, height: 1920 };
  return {
    params,
    width,
    height,
    time: 12.5,
    duration: 200,
    bands: Float32Array.from(
      { length: BAND_COUNT },
      (_, i) => 0.3 + 0.5 * Math.abs(Math.sin(i)),
    ),
    wave: Float32Array.from({ length: WAVE_POINTS }, (_, i) => Math.sin(i / 7)),
    title: "Astri",
    images: {
      background: pic(1920, 1080),
      center: pic(),
    },
    ...over,
  };
}

function draw(params: VisualizerParams, over: Partial<VisualizerScene> = {}) {
  const s = scene(params, over);
  const { ctx, calls } = recorder(s.width, s.height);
  const scratch = (w: number, h: number): ScratchCanvas => {
    const r = recorder(w, h);
    return { width: w, height: h, getContext: () => r.ctx };
  };
  createVisualizerRenderer(scratch)(ctx, s);
  return calls;
}

describe("drawVisualizer", () => {
  it("draws every preset in both aspects, the same way for the same scene", () => {
    for (const preset of VISUALIZER_PRESETS)
      for (const aspect of ["16:9", "9:16"] as const) {
        const params = { ...defaultVisualizerParams(), preset, aspect };
        const a = draw(params);
        const b = draw(params);
        expect(a.length).toBeGreaterThan(20);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      }
  });

  it("dims the background by the dimming percentage", () => {
    const params = defaultVisualizerParams();
    params.background.dimming = 35;
    const calls = draw(params);
    expect(
      calls.some((c) => c[0] === "fillRect" && c[5] === "rgba(0,0,0,0.35)"),
    ).toBe(true);
    params.background.dimming = 0;
    expect(
      draw(params).some(
        (c) => c[0] === "fillRect" && String(c[5]).startsWith("rgba(0,0,0,"),
      ),
    ).toBe(false);
  });

  it("reacts to the audio: louder bands draw longer bars", () => {
    const params = {
      ...defaultVisualizerParams(),
      preset: "spectrum" as const,
    };
    const quiet = draw(params, {
      bands: new Float32Array(BAND_COUNT).fill(0.1),
    });
    const loud = draw(params, {
      bands: new Float32Array(BAND_COUNT).fill(0.9),
    });
    expect(JSON.stringify(quiet)).not.toBe(JSON.stringify(loud));
    expect(
      barValues(new Float32Array(BAND_COUNT).fill(0.5), 120).every(
        (v) => v === 0.5,
      ),
    ).toBe(true);
  });

  it("recolours with the chosen colours", () => {
    const params = { ...defaultVisualizerParams(), preset: "mirror" as const };
    params.colors = { primary: "#112233", secondary: "#445566" };
    const text = JSON.stringify(draw(params));
    expect(text).toContain("rgb(17,34,51)");
  });

  it("draws the centre image only when one is chosen", () => {
    const params = defaultVisualizerParams();
    const withImage = draw(params).filter((c) => c[0] === "drawImage").length;
    params.centerImage.mode = "none";
    const without = draw(params).filter((c) => c[0] === "drawImage").length;
    expect(withImage).toBe(without + 1);
  });

  it("places text layers at their percentage of the frame", () => {
    const params = defaultVisualizerParams();
    params.textLayers = [
      { text: "Ciao", x: 25, y: 80, size: 50, color: "#ff0000" },
    ];
    const text = draw(params).find(
      (c) => c[0] === "fillText" && c[1] === "Ciao",
    );
    expect(text?.slice(2, 4)).toEqual([480, 864]);
    expect(String(text?.[4])).toContain("50px");
  });

  it("adds particles by the particles amount, at the same place for the same time", () => {
    expect(particleCount(0)).toBe(0);
    expect(particleCount(100)).toBe(140);
    const a = particleAt(5, 3.2, 1920, 1080);
    expect(a).toEqual(particleAt(5, 3.2, 1920, 1080));
    for (let i = 0; i < 50; i++) {
      const p = particleAt(i, i * 1.7, 1920, 1080);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1920);
    }
    const params = defaultVisualizerParams();
    params.particles = 0;
    const none = draw(params).filter((c) => c[0] === "arc").length;
    params.particles = 100;
    expect(draw(params).filter((c) => c[0] === "arc").length).toBe(none + 140);
  });

  it("applies only the enabled effects, stronger with more intensity", () => {
    const base = defaultVisualizerParams();
    const plain = draw(base).length;
    for (const id of VISUALIZER_EFFECTS) {
      const params = defaultVisualizerParams();
      params.effects = params.effects.map((e) =>
        e.id === id ? { ...e, enabled: true, intensity: 100 } : e,
      );
      // Glitch skips some frames by design; pick one where it fires.
      const calls = draw(
        params,
        id === "glitch"
          ? { time: 0, bands: new Float32Array(BAND_COUNT).fill(1) }
          : {},
      );
      if (id !== "glitch") expect(calls.length).toBeGreaterThan(plain);
    }
    const scan = (intensity: number) => {
      const params = defaultVisualizerParams();
      params.effects = params.effects.map((e) =>
        e.id === "scanlines" ? { ...e, enabled: true, intensity } : e,
      );
      return draw(params).find(
        (c) =>
          c[0] === "fillRect" &&
          String(c[5]).startsWith("rgba(0,0,0,0.") &&
          c[4] !== 1080,
      )?.[5];
    };
    expect(scan(0)).toBe("rgba(0,0,0,0.12)");
    expect(scan(100)).toBe("rgba(0,0,0,0.52)");
  });
});

describe("MellodifAI Classico", () => {
  it("follows the channel template in 16:9", () => {
    const L = classicoLayout(1920, 1080);
    expect(L.wave.y).toBeCloseTo(1080 * 0.72);
    expect(L.badge).toMatchObject({ x: 960, y: 1080 * 0.2 });
    expect(L.badge.d).toBeCloseTo(1080 * 0.15);
    // One centred column top to bottom: badge, text, ruler, wave (no side marks any more).
    expect(L.badge.y + L.badge.d / 2).toBeLessThan(L.textTop);
    expect(L.textTop).toBeLessThan(L.ruler.y);
    expect(L.ruler.y).toBeLessThan(L.wave.y - L.wave.amp);
    const tall = classicoLayout(1080, 1920);
    expect(tall.badge.y + tall.badge.d / 2).toBeLessThan(tall.textTop);
    expect(tall.wave.y + tall.wave.amp).toBeLessThan(tall.ruler.y);
    expect(tall.ruler.y).toBeLessThan(tall.intro.y);
    // In 9:16 the column sits in the middle, clear of a Short's top bar and bottom captions.
    expect(tall.badge.y - tall.badge.d / 2).toBeGreaterThan(1920 * 0.15);
    expect(tall.intro.y + 112).toBeLessThan(1920 * 0.85);
  });

  it("lays itself out again for full-frame 9:16, inside the frame", () => {
    const L = classicoLayout(1080, 1920);
    expect(L.tall).toBe(true);
    for (const item of [L.badge]) {
      expect(item.x).toBeGreaterThan(0);
      expect(item.x).toBeLessThan(1080);
      expect(item.y).toBeLessThan(1920);
    }
    // No letterbox: nothing fills black bars above and below a 16:9 picture.
    const params = {
      ...defaultVisualizerParams(),
      preset: "classico" as const,
      aspect: "9:16" as const,
    };
    params.background.dimming = 0;
    const bars = draw(params).filter(
      (c) =>
        c[0] === "fillRect" &&
        c[3] === 1080 &&
        (c[4] as number) > 300 &&
        (c[4] as number) < 1920,
    );
    expect(bars).toHaveLength(0);
  });

  it("shows the intro, the subscribe callout and the end card at their times", () => {
    const params = {
      ...defaultVisualizerParams(),
      preset: "classico" as const,
    };
    params.classico.artist = "Lucia";
    const texts = (time: number) =>
      draw(params, { time, duration: 200 })
        .filter((c) => c[0] === "fillText")
        .map((c) => c[1]);
    expect(texts(2)).toContain("PRESENTS");
    expect(texts(10)).not.toContain("PRESENTS");
    expect(subscribeWindow(200)).toEqual([90, 96]);
    expect(subscribeWindow(60)[0]).toBeCloseTo(27);
    expect(texts(92)).toContain("SUBSCRIBE");
    expect(texts(197)).toContain("SUBSCRIBE");
    expect(texts(150)).not.toContain("SUBSCRIBE");
    params.classico.cards = false;
    expect(texts(2)).not.toContain("PRESENTS");
  });

  it("draws the text stack on a backdrop", () => {
    const params = {
      ...defaultVisualizerParams(),
      preset: "classico" as const,
    };
    const calls = draw(params, { time: 30 });
    const plate = calls.findIndex(
      (c) => c[0] === "fill" && c[1] === "rgba(0,0,0,0.42)",
    );
    const song = calls.findIndex(
      (c) => c[0] === "fillText" && c[1] === "SONG: ASTRI",
    );
    expect(plate).toBeGreaterThan(-1);
    expect(song).toBeGreaterThan(plate);
  });

  it("puts the round image where each preset expects it", () => {
    for (const preset of VISUALIZER_PRESETS) {
      const { cx, cy, r } = centerLayout(
        { ...defaultVisualizerParams(), preset },
        1080,
        1920,
      );
      expect(cx).toBe(540);
      expect(cy - r).toBeGreaterThan(0);
      expect(cy + r).toBeLessThan(1920);
    }
  });
});

describe("Classico text stack", () => {
  const measured = {
    font: "",
    measureText: (t: string) => ({ width: t.length * 20 }),
  } as unknown as Canvas2D;
  const sc = { fontFamily: "Oswald" } as VisualizerScene;
  it("keeps a short line, shrinks a slightly long one and breaks a long one over two lines", () => {
    expect(stackLine(measured, sc, "SONG: ASTRI", 60, 400)).toEqual([
      { text: "SONG: ASTRI", px: 60, width: 220 },
    ]);
    expect(
      stackLine(
        measured,
        sc,
        "SONG: CIVICO TREDICI, VIA DEI LAMPIONI",
        60,
        440,
      ).map((l) => l.text),
    ).toEqual(["SONG: CIVICO TREDICI,", "VIA DEI LAMPIONI"]);
  });
});

describe("catalogue looks", () => {
  const look = (
    preset: (typeof LOOK_PRESETS)[number],
    aspect: "16:9" | "9:16" = "16:9",
  ): VisualizerParams => ({ ...defaultVisualizerParams(), preset, aspect });
  const flat = (v: number) => new Float32Array(BAND_COUNT).fill(v);
  const peaky = Float32Array.from({ length: BAND_COUNT }, (_, i) =>
    i % 8 < 2 ? 0.95 : 0.35,
  );

  it("every look moves with the music", () => {
    for (const preset of LOOK_PRESETS) {
      const quiet = draw(look(preset), { bands: flat(0.05) });
      const loud = draw(look(preset), { bands: peaky });
      expect(JSON.stringify(quiet), preset).not.toBe(JSON.stringify(loud));
    }
  });

  it("keeps every line of text inside the frame, in both aspects", () => {
    for (const preset of LOOK_PRESETS)
      for (const aspect of ["16:9", "9:16"] as const) {
        const params = look(preset, aspect);
        params.classico.album = "Lampioni";
        const s = scene(params, {
          title: "Civico tredici, via dei Lampioni e delle stelle cadenti",
        });
        for (const call of draw(params, s).filter((c) => c[0] === "fillText")) {
          const [x, y] = [call[2] as number, call[3] as number];
          expect(x, `${preset} ${aspect} ${call[1]}`).toBeGreaterThanOrEqual(0);
          expect(x, `${preset} ${aspect} ${call[1]}`).toBeLessThanOrEqual(
            s.width,
          );
          expect(y, `${preset} ${aspect} ${call[1]}`).toBeGreaterThan(0);
          expect(y, `${preset} ${aspect} ${call[1]}`).toBeLessThan(s.height);
        }
      }
  });

  it("draws the centre image only when one is chosen", () => {
    for (const preset of LOOK_PRESETS) {
      const params = look(preset);
      const images = (p: VisualizerParams) =>
        draw(p).filter((c) => c[0] === "drawImage").length;
      const withImage = images(params);
      params.centerImage.mode = "none";
      expect(withImage, preset).toBe(images(params) + 1);
    }
  });

  it("trails the music: peaks, echoes and contours read the frames before this one", () => {
    const history = Array.from({ length: 36 }, (_, k) => ({
      bands: flat(k % 3 === 0 ? 0.9 : 0.2),
      wave: new Float32Array(WAVE_POINTS),
    }));
    for (const preset of ["dotline", "burst", "pills", "contours"] as const) {
      const now = draw(look(preset), { history: [] });
      const trailed = draw(look(preset), { history });
      expect(JSON.stringify(now), preset).not.toBe(JSON.stringify(trailed));
    }
  });

  it("draws each Corona tooth, each particle shape and both Contorni styles differently", () => {
    const variants = (patches: Partial<VisualizerParams["look"]>[]) =>
      new Set(
        patches.map((patch) => {
          const params = look(
            "teeth" in patch
              ? "crown"
              : "shape" in patch
                ? "shaped"
                : "contours",
          );
          params.look = { ...params.look, ...patch };
          return JSON.stringify(draw(params));
        }),
      ).size;
    expect(variants(CROWN_TEETH.map((teeth) => ({ teeth })))).toBe(5);
    expect(variants(PARTICLE_SHAPES.map((shape) => ({ shape })))).toBe(8);
    expect(variants([{ contour: "rings" }, { contour: "ridges" }])).toBe(2);
  });

  it("puts the rotating badges over any preset, in the safe corners", () => {
    for (const aspect of ["16:9", "9:16"] as const) {
      const params = { ...defaultVisualizerParams(), aspect };
      const off = draw(params);
      params.badges = { enabled: true, text: "Nuovo singolo" };
      const on = draw(params);
      const glyphs = (calls: Call[]) =>
        calls.filter((c) => c[0] === "fillText" && c[1] === "N").length;
      expect(glyphs(off)).toBe(0);
      expect(glyphs(on)).toBeGreaterThan(1);
      const centres = on
        .filter((c) => c[0] === "translate" && c[1] !== 0)
        .map((c) => [c[1] as number, c[2] as number]);
      const s = scene(params);
      for (const [x, y] of centres) {
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(s.width);
        // In 9:16 both badges stay in the top fifth, away from the Shorts buttons.
        if (aspect === "9:16") expect(y).toBeLessThan(s.height * 0.2);
      }
    }
  });

  it("keeps peaks visible on a loud, dense master", () => {
    const dense = Float32Array.from({ length: BAND_COUNT }, (_, i) =>
      i === 20 ? 1 : 0.8,
    );
    const values = shapedBars(dense, BAND_COUNT);
    expect(Math.max(...values)).toBeGreaterThan(0.9);
    expect(values[5] as number).toBeLessThan(0.6);
    expect(shapedBars(flat(0.05), 16).every((v) => v < 0.1)).toBe(true);
  });

  it("gives each shaped particle a life that fades in and out, the same at the same time", () => {
    expect(shapedParticleAt(7, 12.3)).toEqual(shapedParticleAt(7, 12.3));
    for (let i = 0; i < 40; i++) {
      const p = shapedParticleAt(i, i * 0.37);
      expect(p.age).toBeGreaterThanOrEqual(0);
      expect(p.age).toBeLessThan(3.5);
      expect(p.alpha).toBeGreaterThanOrEqual(0);
      expect(p.alpha).toBeLessThanOrEqual(1);
    }
  });
});

describe("type scale", () => {
  const withTitle = (
    preset: VisualizerParams["preset"],
    aspect: "16:9" | "9:16",
  ) => {
    const params = { ...defaultVisualizerParams(), preset, aspect };
    params.classico.album = "Lampioni";
    const s = scene(params, { title: "Astri" });
    const texts = draw(params, s).filter(
      (c) =>
        c[0] === "fillText" &&
        (String(c[1]).includes("ASTRI") ||
          (String(c[1]).length === 1 && "ASTRI".includes(String(c[1])))),
    );
    return { s, texts };
  };
  const px = (call: unknown[]) =>
    Number(/(\d+)px/u.exec(String(call[call.length - 1]))?.[1]);

  it("draws the song title at the shared size in every preset, both aspects", () => {
    for (const preset of VISUALIZER_PRESETS) {
      if (preset === "classico") continue;
      for (const aspect of ["16:9", "9:16"] as const) {
        const { s, texts } = withTitle(preset, aspect);
        expect(texts.length, `${preset} ${aspect}`).toBeGreaterThan(0);
        const biggest = Math.max(...texts.map(px));
        // The shared title size, which is at least 3.2% of a 1080 px frame height.
        expect(biggest, `${preset} ${aspect}`).toBeGreaterThanOrEqual(
          Math.round(typeScale(s).title),
        );
        expect(biggest, `${preset} ${aspect}`).toBeGreaterThanOrEqual(
          0.032 * 1080,
        );
      }
    }
  });

  it("keeps the title inside the 5% safe area", () => {
    for (const preset of VISUALIZER_PRESETS) {
      if (preset === "classico") continue;
      for (const aspect of ["16:9", "9:16"] as const) {
        const { s, texts } = withTitle(preset, aspect);
        const safe = safeArea(s);
        for (const call of texts) {
          const y = call[3] as number;
          const size = px(call);
          expect(y - size / 2, `${preset} ${aspect}`).toBeGreaterThanOrEqual(
            safe.top - 1,
          );
          expect(y + size / 2, `${preset} ${aspect}`).toBeLessThanOrEqual(
            safe.bottom + 1,
          );
        }
      }
    }
  });

  it("scales from the short side, so 16:9 and 9:16 read alike", () => {
    expect(typeScale({ width: 1920, height: 1080 })).toEqual(
      typeScale({ width: 1080, height: 1920 }),
    );
    expect(typeScale({ width: 1920, height: 1080 }).title).toBeGreaterThan(
      0.032 * 1080,
    );
  });
});

describe("Contorni contrast", () => {
  const rgbOf = (color: unknown): Rgb => {
    const m = /^rgb\((\d+),(\d+),(\d+)\)$/u.exec(String(color));
    return [Number(m?.[1]), Number(m?.[2]), Number(m?.[3])];
  };
  const inkStrokes = (params: VisualizerParams) =>
    draw(params).filter(
      (c) => c[0] === "stroke" && /^rgb\(/u.test(String(c[1])),
    );

  it("holds 3:1 against the brightest picture in every colour preset, dimming and style", () => {
    for (const colors of COLOR_PRESETS)
      for (const mode of ["random", "image", "video"] as const)
        for (const dimming of [0, 40, 60, 100])
          for (const contour of ["rings", "ridges"] as const)
            for (const aspect of ["16:9", "9:16"] as const) {
              const params = defaultVisualizerParams();
              params.preset = "contours";
              params.aspect = aspect;
              params.colors = {
                primary: colors.primary,
                secondary: colors.secondary,
              };
              params.background.mode = mode;
              params.background.dimming = dimming;
              params.look.contour = contour;
              const ink = inkStrokes(params);
              expect(
                ink.length,
                `${colors.id} ${contour}`,
              ).toBeGreaterThanOrEqual(12);
              const back = lineBackdrop(params);
              for (const call of ink) {
                const alpha = call[2] as number;
                const c = rgbOf(call[1]);
                const seen = c.map((v, i) =>
                  Math.round(v * alpha + (back[i] as number) * (1 - alpha)),
                ) as Rgb;
                expect(
                  contrastRatio(seen, back),
                  `${colors.id} ${contour} ${mode} dim ${dimming}`,
                ).toBeGreaterThanOrEqual(3);
              }
            }
  });

  it("takes opacity and weight from the params, never below the contrast", () => {
    const params = defaultVisualizerParams();
    params.preset = "contours";
    const strokes = (weight: number, opacity: number) => {
      const p = structuredClone(params);
      p.look.contourWeight = weight;
      p.look.contourOpacity = opacity;
      return inkStrokes(p).map((c) => [c[2], c[3]] as [number, number]);
    };
    const thin = strokes(1, 60);
    const thick = strokes(5, 100);
    expect(Math.max(...thick.map((t) => t[1]))).toBeGreaterThan(
      Math.max(...thin.map((t) => t[1])),
    );
    expect(Math.max(...thick.map((t) => t[0]))).toBeGreaterThan(
      Math.max(...thin.map((t) => t[0])),
    );
    const low = defaultVisualizerParams();
    low.look.contourOpacity = 60;
    for (let k = 0; k < 14; k++) {
      const ink = contourInk(low, k, 14);
      const back = lineBackdrop(low);
      const seen = ink.rgb.map((v, i) =>
        Math.round(v * ink.alpha + (back[i] as number) * (1 - ink.alpha)),
      ) as Rgb;
      expect(contrastRatio(seen, back)).toBeGreaterThanOrEqual(3);
    }
    expect(CONTOUR_CONTRAST).toBeGreaterThanOrEqual(3);
  });
});

describe("centre picture fit", () => {
  const drawn = (
    preset: VisualizerParams["preset"],
    fit: "cover" | "contain",
    center: { source: unknown; width: number; height: number } = pic(
      1920,
      1080,
    ),
  ) => {
    const params = { ...defaultVisualizerParams(), preset };
    params.centerImage.fit = fit;
    const s = scene(params, {
      images: { background: null, center },
    });
    return draw(params, s).filter((c) => c[0] === "drawImage");
  };

  it("crops a 16:9 picture square, never stretching it", () => {
    for (const preset of [
      "circle",
      "dotline",
      "crown",
      "contours",
      "coverframe",
    ] as const) {
      const [call] = drawn(preset, "cover");
      expect(call, preset).toBeDefined();
      const [w, h] = [call?.[4] as number, call?.[5] as number];
      expect(w / h, preset).toBeCloseTo(1920 / 1080, 3);
    }
  });

  it("follows the subject: a picture with a focus is cropped there", () => {
    const left = { ...pic(1920, 1080), focus: { x: 0.2, y: 0.5 } };
    const x = (c: { source: unknown; width: number; height: number }) =>
      drawn("coverframe", "cover", c)[0]?.[2] as number;
    // Further to the right means more of the picture's left side shows.
    expect(x(left)).toBeGreaterThan(x(pic(1920, 1080)));
  });

  it("contain shows the whole picture over a blurred copy of itself", () => {
    for (const preset of ["circle", "coverframe"] as const) {
      const calls = drawn(preset, "contain");
      expect(calls.length, preset).toBe(2);
      const whole = calls[1] as unknown[];
      expect((whole[4] as number) / (whole[5] as number), preset).toBeCloseTo(
        1920 / 1080,
        3,
      );
      // The blurred fill is bigger than the whole picture.
      expect(calls[0]?.[4] as number).toBeGreaterThan(whole[4] as number);
    }
  });

  it("a square picture is the same in both fits", () => {
    const square = pic(800, 800);
    expect(JSON.stringify(drawn("circle", "contain", square))).toBe(
      JSON.stringify(drawn("circle", "cover", square)),
    );
  });

  it("knows both fits", () => {
    expect([...COVER_FITS]).toEqual(["cover", "contain"]);
  });
});

describe("subject focus", () => {
  // A dark picture with a bright block whose centre column is `at`.
  const blockAt = (at: number, w = 64, h = 36) => {
    const data = new Uint8ClampedArray(w * h * 4).fill(10);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        data[i + 3] = 255;
        if (Math.abs(x - at) < 6 && y > h / 4 && y < (h * 3) / 4) {
          data[i] = 240;
          data[i + 1] = 30;
          data[i + 2] = 30;
        }
      }
    return data;
  };

  it("centres a square picture", () => {
    expect(focusOfPixels(blockAt(16, 36, 36), 36, 36)).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });

  it("finds a subject off to one side, and keeps a central one central", () => {
    expect(focusOfPixels(blockAt(14), 64, 36).x).toBeLessThan(0.35);
    expect(focusOfPixels(blockAt(52), 64, 36).x).toBeGreaterThan(0.65);
    expect(focusOfPixels(blockAt(32), 64, 36).x).toBeCloseTo(0.5, 1);
  });

  it("finds a subject in a tall picture", () => {
    const w = 36;
    const h = 64;
    const data = new Uint8ClampedArray(w * h * 4).fill(10);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        data[i + 3] = 255;
        if (y > 4 && y < 20 && x > 8 && x < 28) {
          data[i] = 250;
          data[i + 1] = 250;
        }
      }
    const f = focusOfPixels(data, w, h);
    expect(f.x).toBe(0.5);
    expect(f.y).toBeLessThan(0.35);
  });

  it("reads a picture through a canvas, and leaves one it cannot read", () => {
    const read = (w: number, h: number) => ({
      width: w,
      height: h,
      getContext: () => ({
        drawImage: () => {},
        getImageData: () => ({ data: blockAt(14, w, h) }),
      }),
    });
    const base = { source: {}, width: 1920, height: 1080 };
    expect(withFocus(base, read).focus?.x).toBeLessThan(0.35);
    expect(
      withFocus({ ...base, width: 800, height: 800 }, read).focus,
    ).toBeUndefined();
    const tainted = () => ({
      width: 1,
      height: 1,
      getContext: () => {
        throw new Error("tainted");
      },
    });
    expect(withFocus(base, tainted)).toBe(base);
  });

  it("reads the focus from the picture drawn 1:1, never from a browser-scaled copy", () => {
    const draws: number[][] = [];
    const sizes: number[][] = [];
    const read = (w: number, h: number) => {
      sizes.push([w, h]);
      return {
        width: w,
        height: h,
        getContext: () => ({
          drawImage: (_: never, ...box: number[]) => draws.push(box),
          getImageData: (_x: number, _y: number, gw: number, gh: number) => ({
            data: blockAt(1500, gw, gh),
          }),
        }),
      };
    };
    const focus = withFocus(
      { source: {}, width: 1920, height: 1080 },
      read,
    ).focus;
    expect(sizes).toEqual([[1920, 1080]]);
    expect(draws).toEqual([[0, 0, 1920, 1080]]);
    expect(focus?.x).toBeGreaterThan(0.65);
  });
});

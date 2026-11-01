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
  defaultVisualizerParams,
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
      trumpet: pic(),
      gramophone: pic(),
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
    expect(L.badge).toMatchObject({ x: 960, y: 1080 * 0.13 });
    expect(L.badge.d).toBeCloseTo(1080 * 0.15);
    expect(L.trumpet.x).toBeCloseTo(1920 * 0.18);
    expect(L.gramophone.x).toBeCloseTo(1920 * 0.88);
  });

  it("lays itself out again for full-frame 9:16, inside the frame", () => {
    const L = classicoLayout(1080, 1920);
    expect(L.tall).toBe(true);
    for (const item of [L.badge, L.trumpet, L.gramophone]) {
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

import { describe, expect, it } from "vitest";
import { BAND_COUNT, WAVE_POINTS } from "./viz-audio.js";
import {
  type Canvas2D,
  createVisualizerRenderer,
  type ScratchCanvas,
  type VisualizerScene,
} from "./viz-draw.js";
import { safeArea } from "./viz-kit.js";
import {
  type Box,
  logoLayout,
  overlaps,
  overlayCorner,
  textProbe,
} from "./viz-logos.js";
import { badgeSlots } from "./viz-looks.js";
import {
  defaultVisualizerParams,
  LOGO_POSITIONS,
  type LogoPosition,
  normalizeVisualizerParams,
  VISUALIZER_PRESETS,
  type VisualizerLogo,
  type VisualizerParams,
} from "./viz-params.js";

// Task 28: no built-in brand text or marks, and the user's logos in every preset.

type Text = {
  text: string;
  x: number;
  y: number;
  px: number;
  align: string;
  baseline: string;
  transformed: boolean;
};
type Image = {
  source: unknown;
  x: number;
  y: number;
  w: number;
  h: number;
  alpha: number;
  order: number;
};

// A context that keeps what text and pictures it is asked to draw, with the state at the time.
// Text is measured at 0.55 of its size per character, a narrow face like the frame's Oswald.
function recorder(width: number, height: number) {
  const texts: Text[] = [];
  const images: Image[] = [];
  const order: string[] = [];
  const state = {
    globalAlpha: 1,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    moved: false,
    fillStyle: "#000" as unknown,
  };
  const stack: (typeof state)[] = [];
  const px = () => Number(/(\d+(?:\.\d+)?)px/u.exec(state.font)?.[1] ?? 10);
  const text = (t: string, x: number, y: number) => {
    order.push("text");
    texts.push({
      text: t,
      x,
      y,
      px: px(),
      align: state.textAlign,
      baseline: state.textBaseline,
      transformed: state.moved,
    });
  };
  const canvas: ScratchCanvas = { width, height, getContext: () => ctx };
  const gradient = { addColorStop: () => {} };
  const ctx = new Proxy(
    {
      canvas,
      save: () => stack.push({ ...state }),
      restore: () => Object.assign(state, stack.pop()),
      translate: () => {
        state.moved = true;
      },
      rotate: () => {
        state.moved = true;
      },
      fillText: text,
      strokeText: text,
      measureText: (t: string) => ({ width: t.length * px() * 0.55 }),
      drawImage: (source: unknown, ...args: number[]) => {
        if (args.length !== 4) return;
        const [x, y, w, h] = args as [number, number, number, number];
        order.push("image");
        images.push({
          source,
          x,
          y,
          w,
          h,
          alpha: state.globalAlpha,
          order: order.length - 1,
        });
      },
      fillRect: () => {
        order.push(`rect ${String(state.fillStyle)}`);
      },
      createLinearGradient: () => gradient,
      createRadialGradient: () => gradient,
      createImageData: (w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
      }),
    } as Record<string, unknown>,
    {
      get(target, key: string) {
        if (key in target) return target[key];
        if (key in state) return state[key as keyof typeof state];
        return () => {};
      },
      set(_target, key: string, value) {
        (state as Record<string, unknown>)[key] = value;
        return true;
      },
    },
  ) as unknown as Canvas2D;
  return { ctx, texts, images, order };
}

const LOGO = { source: { id: "logo" }, width: 400, height: 100 };
const SQUARE = { source: { id: "square" }, width: 300, height: 300 };
const URL = "/media/uploads/u/0b4f9c1e-1111-4b7a-9c2e-123456789abc.png";

function scene(
  params: VisualizerParams,
  over: Partial<VisualizerScene> = {},
): VisualizerScene {
  const tall = params.aspect === "9:16";
  return {
    params,
    width: tall ? 1080 : 1920,
    height: tall ? 1920 : 1080,
    time: 30,
    duration: 200,
    bands: Float32Array.from(
      { length: BAND_COUNT },
      (_, i) => 0.3 + 0.5 * Math.abs(Math.sin(i)),
    ),
    wave: Float32Array.from({ length: WAVE_POINTS }, (_, i) => Math.sin(i / 7)),
    title: "Civico tredici, via dei Lampioni",
    images: {
      background: { source: { id: "bg" }, width: 1920, height: 1080 },
      center: { source: { id: "center" }, width: 512, height: 512 },
      logos: [LOGO, SQUARE],
    },
    ...over,
  };
}

function draw(params: VisualizerParams, over: Partial<VisualizerScene> = {}) {
  const s = scene(params, over);
  const r = recorder(s.width, s.height);
  const scratch = (w: number, h: number): ScratchCanvas => {
    const x = recorder(w, h);
    return { width: w, height: h, getContext: () => x.ctx };
  };
  createVisualizerRenderer(scratch)(r.ctx, s);
  return { ...r, scene: s };
}

// The box a recorded line of text covers, worked out here on its own (not with the probe).
function boxOf(t: Text): Box {
  const w = t.text.length * t.px * 0.55;
  const left =
    t.align === "center"
      ? t.x - w / 2
      : t.align === "right" || t.align === "end"
        ? t.x - w
        : t.x;
  const top =
    t.baseline === "top"
      ? t.y
      : t.baseline === "middle"
        ? t.y - t.px / 2
        : t.baseline === "bottom"
          ? t.y - t.px
          : t.y - t.px * 0.8;
  return { left, top, right: left + w, bottom: top + t.px };
}

const with1 = (
  base: VisualizerParams,
  position: LogoPosition,
  size = 12,
  opacity = 100,
): VisualizerParams => ({
  ...base,
  logos: [{ assetUrl: URL, position, size, opacity }],
});

const BRAND = /AIMELODIA|STEFANDSL|MELLODIFAI/iu;

describe("no built-in branding", () => {
  it("no preset draws a brand name the user did not type, at any moment", () => {
    const old = normalizeVisualizerParams({
      classico: { artist: "AIMELODIA", website: "STEFANDSL.COM", album: "" },
    });
    for (const params of [defaultVisualizerParams(), old])
      for (const preset of VISUALIZER_PRESETS)
        for (const aspect of ["16:9", "9:16"] as const)
          for (const time of [2, 30, 92, 197])
            for (const title of ["Astri", ""]) {
              const p = {
                ...params,
                preset,
                aspect,
                badges: { enabled: true, text: "" },
              };
              const { texts, images } = draw(p, { time, title });
              const all = texts.map((t) => t.text).join("");
              expect(all, `${preset} ${aspect} ${time}`).not.toMatch(BRAND);
              // Only the background and the centre picture: no brand marks.
              for (const image of images)
                expect(["bg", "center"]).toContain(
                  (image.source as { id: string }).id,
                );
            }
  });

  it("skips the Classico intro without an artist, and the artist line of the end card", () => {
    const params = {
      ...defaultVisualizerParams(),
      preset: "classico" as const,
    };
    const words = (p: VisualizerParams, time: number) =>
      draw(p, { time }).texts.map((t) => t.text);
    expect(words(params, 2)).not.toContain("PRESENTS");
    expect(words(params, 197)).toEqual(
      expect.arrayContaining([
        "SUBSCRIBE",
        "SONG: CIVICO TREDICI, VIA DEI LAMPIONI",
      ]),
    );
    const end = draw(params, { time: 197 }).texts;
    expect(end.filter((t) => t.text === "SUBSCRIBE")).toHaveLength(1);
    expect(end.some((t) => t.text === "")).toBe(false);
    params.classico.artist = "Lucia";
    expect(words(params, 2)).toEqual(
      expect.arrayContaining(["LUCIA", "PRESENTS"]),
    );
    expect(words(params, 197)).toContain("LUCIA");
  });

  it("closes up the Classico stack when a line is empty", () => {
    const params = {
      ...defaultVisualizerParams(),
      preset: "classico" as const,
    };
    params.classico.album = "Lampioni";
    const ys = (p: VisualizerParams) =>
      draw(p, { title: "Astri" }).texts.map((t) => [t.text, t.y] as const);
    const without = ys(params);
    const song = without.find(([t]) => t === "SONG: ASTRI");
    const album = without.find(([t]) => t === "ALBUM: LAMPIONI");
    expect(song && album).toBeTruthy();
    params.classico.artist = "Lucia";
    const withArtist = ys(params);
    const by = withArtist.find(([t]) => t === "by LUCIA");
    // The album line takes the artist line's place.
    expect(album?.[1]).toBeCloseTo(by?.[1] as number);
  });

  it("leaves no gap where the artist line of a player look would be", () => {
    const lines = (preset: VisualizerParams["preset"], artist: string) => {
      const params = { ...defaultVisualizerParams(), preset };
      params.classico = { ...params.classico, artist, album: "Lampioni" };
      const { texts } = draw(params, { title: "Astri" });
      // Looks space their letters one by one: find the first glyph of each line.
      const glyphY = (line: string) => {
        const at = texts.findIndex(
          (t, i) =>
            t.text === line[0] &&
            [...line].every((c, k) => texts[i + k]?.text === c),
        );
        return at < 0 ? null : (texts[at] as Text);
      };
      return {
        artist: glyphY("LUCIA"),
        title: glyphY("ASTRI") ?? glyphY("SONG: ASTRI"),
        album: glyphY("LAMPIONI") ?? glyphY("ALBUM: LAMPIONI"),
      };
    };
    for (const preset of ["edgebars", "coverframe"] as const) {
      const full = lines(preset, "Lucia");
      const bare = lines(preset, "");
      expect(full.artist, preset).not.toBeNull();
      expect(bare.artist, preset).toBeNull();
      const a = full.artist as Text;
      const t = bare.title as Text;
      // The title starts where the artist line started.
      expect(t.y - t.px / 2, preset).toBeCloseTo(a.y - a.px / 2, 0);
      // And the album keeps its distance under the title.
      expect((bare.album as Text).y - t.y, preset).toBeCloseTo(
        (full.album as Text).y - (full.title as Text).y,
        3,
      );
    }
    // Scheda Player's column rests on the card: it closes up towards the card.
    const full = lines("playercard", "Lucia");
    const bare = lines("playercard", "");
    expect((bare.album as Text).y).toBeCloseTo((full.album as Text).y, 3);
    expect((bare.title as Text).y).toBeCloseTo((full.title as Text).y, 3);
    const noAlbum = (() => {
      const params = {
        ...defaultVisualizerParams(),
        preset: "playercard" as const,
      };
      const { texts } = draw(params, { title: "Astri" });
      return texts.find((t) => t.text === "A") as Text;
    })();
    expect(noAlbum.y).toBeGreaterThan((full.title as Text).y);
  });

  it("draws no badges with no text, no title and no artist", () => {
    const params = {
      ...defaultVisualizerParams(),
      badges: { enabled: true, text: "" },
    };
    expect(badgeSlots(scene(params, { title: "" }))).toEqual([]);
    const empty = draw(params, { title: "" });
    expect(empty.texts.filter((t) => t.transformed)).toHaveLength(0);
    expect(badgeSlots(scene(params, { title: "Astri" }))).toHaveLength(2);
    expect(
      draw(params, { title: "Astri" }).texts.filter((t) => t.transformed)
        .length,
    ).toBeGreaterThan(4);
  });
});

describe("user logos", () => {
  it("draws a logo in every preset, whole, in its corner inside the safe area", () => {
    for (const preset of VISUALIZER_PRESETS)
      for (const aspect of ["16:9", "9:16"] as const)
        for (const position of LOGO_POSITIONS) {
          const params = with1(
            { ...defaultVisualizerParams(), preset, aspect },
            position,
          );
          const { images, scene: s } = draw(params, { title: "Astri" });
          const logo = images.filter((i) => i.source === LOGO.source);
          const tag = `${preset} ${aspect} ${position}`;
          expect(logo, tag).toHaveLength(1);
          const [l] = logo as [Image];
          // Contain fit: the picture's own proportions, never stretched.
          expect(l.w / l.h, tag).toBeCloseTo(LOGO.width / LOGO.height, 6);
          const safe = safeArea(s);
          expect(l.x, tag).toBeGreaterThanOrEqual(safe.left - 0.01);
          expect(l.y, tag).toBeGreaterThanOrEqual(safe.top - 0.01);
          expect(l.x + l.w, tag).toBeLessThanOrEqual(safe.right + 0.01);
          expect(l.y + l.h, tag).toBeLessThanOrEqual(safe.bottom + 0.01);
          // The side the user picked.
          if (position.endsWith("left"))
            expect(l.x, tag).toBeCloseTo(safe.left);
          else expect(l.x + l.w, tag).toBeCloseTo(safe.right);
          const corner = overlayCorner(position, s);
          if (corner.startsWith("top"))
            expect(l.y + l.h / 2, tag).toBeLessThan(s.height / 2);
          else expect(l.y + l.h / 2, tag).toBeGreaterThan(s.height / 2);
        }
  });

  it("sizes a logo by the short side of the frame and draws it at its opacity", () => {
    for (const aspect of ["16:9", "9:16"] as const) {
      const base = { ...defaultVisualizerParams(), preset: "minimal" as const };
      const params = with1({ ...base, aspect }, "top-left", 20, 40);
      const [l] = draw(params, { title: "" }).images.filter(
        (i) => i.source === LOGO.source,
      ) as [Image];
      expect(Math.max(l.w, l.h)).toBeCloseTo(1080 * 0.2);
      expect(l.alpha).toBeCloseTo(0.4);
    }
  });

  it("keeps a 9:16 logo out of the bottom of a Short, as the badges do", () => {
    for (const position of ["bottom-left", "bottom-right"] as const) {
      const params = with1(
        {
          ...defaultVisualizerParams(),
          preset: "minimal",
          aspect: "9:16",
        },
        position,
        30,
      );
      const [l] = draw(params, { title: "" }).images.filter(
        (i) => i.source === LOGO.source,
      ) as [Image];
      expect(l.y + l.h).toBeLessThan(1920 * 0.25);
    }
    expect(overlayCorner("bottom-left", { width: 1080, height: 1920 })).toBe(
      "top-left",
    );
    expect(overlayCorner("bottom-right", { width: 1920, height: 1080 })).toBe(
      "bottom-right",
    );
  });

  it("draws the logos over the preset and the badges, under the effects", () => {
    const base = defaultVisualizerParams();
    const params = {
      ...with1(base, "top-left"),
      effects: base.effects.map((e) =>
        e.id === "scanlines" ? { ...e, enabled: true } : e,
      ),
      badges: { enabled: true, text: "Nuovo" },
    };
    const { images, order } = draw(params, { title: "Astri" });
    const logo = images.find((i) => i.source === LOGO.source) as Image;
    const lastText = order.lastIndexOf("text");
    const scan = order.findIndex((o) => o.startsWith("rect rgba(0,0,0,0.3"));
    expect(logo.order).toBeGreaterThan(lastText);
    expect(scan).toBeGreaterThan(logo.order);
  });

  it("skips a logo whose picture is not there, and draws the other", () => {
    const base = defaultVisualizerParams();
    const params = {
      ...base,
      logos: [
        {
          assetUrl: URL,
          position: "top-left" as const,
          size: 12,
          opacity: 100,
        },
        {
          assetUrl: URL,
          position: "top-right" as const,
          size: 12,
          opacity: 100,
        },
      ],
    };
    const { images } = draw(params, {
      images: { background: null, center: null, logos: [null, SQUARE] },
    });
    expect(images.map((i) => (i.source as { id: string }).id)).toEqual([
      "square",
    ]);
    expect(
      draw(base, { images: { background: null, center: null } }).images,
    ).toEqual([]);
  });

  it("never covers the badges or any text of a preset: a taken corner moves the logo along its side", () => {
    const moved: string[] = [];
    for (const preset of VISUALIZER_PRESETS)
      for (const aspect of ["16:9", "9:16"] as const)
        for (const position of LOGO_POSITIONS)
          for (const size of [12, 30])
            for (const time of [2.7, 30, 93]) {
              const base = defaultVisualizerParams();
              const params: VisualizerParams = {
                ...with1({ ...base, preset, aspect }, position, size),
                classico: {
                  artist: "Lucia Benedetti",
                  website: "lucia.example",
                  album: "Lampioni",
                  cards: true,
                },
                badges: { enabled: true, text: "Nuovo singolo" },
              };
              const { texts, images, scene: s } = draw(params, { time });
              const l = images.find((i) => i.source === LOGO.source);
              const tag = `${preset} ${aspect} ${position} ${size}% t=${time}`;
              expect(l, tag).toBeDefined();
              const box = {
                left: (l as Image).x,
                top: (l as Image).y,
                right: (l as Image).x + (l as Image).w,
                bottom: (l as Image).y + (l as Image).h,
              };
              for (const t of texts.filter((x) => !x.transformed))
                expect(overlaps(box, boxOf(t)), `${tag} "${t.text}"`).toBe(
                  false,
                );
              // The badges: a ring of R*1.35 round each centre, pulsing up to 5%.
              const R = Math.min(s.width, s.height) * 0.075;
              for (const b of badgeSlots(s)) {
                const near = Math.max(
                  Math.abs(
                    Math.max(box.left, Math.min(b.cx, box.right)) - b.cx,
                  ),
                  0,
                );
                const nearY = Math.abs(
                  Math.max(box.top, Math.min(b.cy, box.bottom)) - b.cy,
                );
                expect(Math.hypot(near, nearY), tag).toBeGreaterThan(
                  R * 1.05 * 1.35,
                );
              }
              const safe = safeArea(s);
              const corner = overlayCorner(position, s);
              const atCorner = corner.startsWith("top")
                ? box.top === safe.top
                : Math.abs(box.bottom - safe.bottom) < 0.01;
              if (!atCorner && time === 30) moved.push(tag);
            }
    // Most corners are free; the taken ones (the badges' corners, and at 30% a long title near
    // the top or bottom edge) moved and were checked above.
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.length).toBeLessThan(
      VISUALIZER_PRESETS.length * 2 * LOGO_POSITIONS.length * 2,
    );
  });

  it("stacks two logos in one corner without overlap", () => {
    const base = { ...defaultVisualizerParams(), preset: "minimal" as const };
    const params = {
      ...base,
      logos: [
        {
          assetUrl: URL,
          position: "top-left" as const,
          size: 20,
          opacity: 100,
        },
        {
          assetUrl: URL,
          position: "top-left" as const,
          size: 20,
          opacity: 100,
        },
      ],
    };
    const [a, b] = draw(params, { title: "" }).images.filter(
      (i) => i.source === LOGO.source || i.source === SQUARE.source,
    ) as [Image, Image];
    expect(a.x).toBeCloseTo(b.x);
    expect(b.y).toBeGreaterThan(a.y + a.h);
    // In 9:16 a bottom-left logo goes up to the top left and stacks under a top-left one.
    const [one, two] = params.logos as [VisualizerLogo, VisualizerLogo];
    const tall = {
      ...params,
      aspect: "9:16" as const,
      logos: [
        { ...one, position: "top-left" as const },
        { ...two, position: "bottom-left" as const },
      ],
    };
    const [c, d] = draw(tall, { title: "" }).images.filter(
      (i) => i.source === LOGO.source || i.source === SQUARE.source,
    ) as [Image, Image];
    expect(d.y).toBeGreaterThan(c.y + c.h);
  });

  it("moves a logo below the title that takes its corner", () => {
    // Specchio puts its title near the top in 16:9: a long one reaches the top corners.
    const params = with1(
      { ...defaultVisualizerParams(), preset: "mirror" },
      "top-left",
    );
    const title = "Civico tredici, via dei Lampioni e delle stelle";
    const { texts, images } = draw(params, { title });
    const line = texts.find((t) => t.text.startsWith("CIVICO")) as Text;
    const l = images.find((i) => i.source === LOGO.source) as Image;
    expect(l.y).toBeGreaterThan(boxOf(line).bottom);
    const free = draw(params, { title: "Astri" }).images.find(
      (i) => i.source === LOGO.source,
    ) as Image;
    expect(free.y).toBeCloseTo(1080 * 0.05);
  });

  it("lays logos out from the boxes it is given, shrinking when a side is full", () => {
    const size = { width: 1920, height: 1080 };
    const logo = {
      assetUrl: URL,
      position: "top-left" as const,
      size: 30,
      opacity: 100,
    };
    const [free] = logoLayout(size, [logo], [SQUARE], []);
    expect(free).toMatchObject({ left: 96, top: 54 });
    // A wall down the left side with a gap too small for the full size.
    const wall: Box[] = [
      { left: 0, top: 0, right: 400, bottom: 300 },
      { left: 0, top: 580, right: 400, bottom: 1080 },
    ];
    const [squeezed] = logoLayout(size, [logo], [SQUARE], wall);
    expect(squeezed).not.toBeNull();
    const s = squeezed as Box;
    expect(s.bottom - s.top).toBeLessThan(1080 * 0.3);
    for (const b of wall) expect(overlaps(s, b)).toBe(false);
    // No room anywhere: no logo rather than one on top of the text.
    const [none] = logoLayout(
      size,
      [logo],
      [SQUARE],
      [{ left: 0, top: 0, right: 1920, bottom: 1080 }],
    );
    expect(none).toBeNull();
  });
});

describe("text probe", () => {
  it("boxes text through the transforms, by alignment and baseline", () => {
    const probe = textProbe((_font, text) => text.length * 10);
    const c = probe.ctx;
    c.font = "500 20px Oswald";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("ABCD", 100, 50);
    c.save();
    c.translate(300, 300);
    c.rotate(Math.PI / 2);
    c.textAlign = "left";
    c.textBaseline = "top";
    c.fillText("AB", 0, 0);
    c.restore();
    c.fillText("A", 10, 10);
    expect(probe.boxes[0]).toEqual({
      left: 80,
      top: 40,
      right: 120,
      bottom: 60,
    });
    // Turned a quarter: 20 wide becomes 20 tall, the line height goes left.
    const turned = probe.boxes[1] as Box;
    expect(turned.left).toBeCloseTo(280);
    expect(turned.right).toBeCloseTo(300);
    expect(turned.top).toBeCloseTo(300);
    expect(turned.bottom).toBeCloseTo(320);
    // restore() brings back the centre alignment.
    expect(probe.boxes[2]).toEqual({ left: 5, top: 0, right: 15, bottom: 20 });
  });
});

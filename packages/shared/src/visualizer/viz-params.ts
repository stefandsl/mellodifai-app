import { z } from "zod";
import { COVER_FITS } from "./viz-kit.js";

// One parameter set drives both the live preview in the browser (a <canvas> fed by the Web Audio
// analyser of the playing track) and the MP4 the render PC makes with Remotion
// (packages/visualizer). Everything that decides what a frame looks like lives in this folder as
// pure functions, so the two cannot drift.

export const VISUALIZER_PRESETS = [
  "classico",
  "circle",
  "spectrum",
  "mirror",
  "waveform",
  "particles",
  "minimal",
  // Looks recreated from the owner's VideoHive catalogue (research/videohive), drawn from
  // scratch in viz-looks.ts.
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
] as const;
export type VisualizerPreset = (typeof VISUALIZER_PRESETS)[number];

// The presets that show the artist and album lines of the Testo tab (stored with Classico's).
export const PRESETS_WITH_SONG_LINES: readonly VisualizerPreset[] = [
  "classico",
  "lens",
  "coverframe",
  "playercard",
  "synthwave",
  "editorial",
];

// Variants of the catalogue looks, each read only by its preset.
// Corona: the shape of the teeth round the ring.
export const CROWN_TEETH = ["wedge", "bar", "fin", "pin", "tick"] as const;
export type CrownTeeth = (typeof CROWN_TEETH)[number];
// Particelle a Forme: the outline each particle draws, and where they flow.
export const PARTICLE_SHAPES = [
  "circle",
  "square",
  "heart",
  "diamond",
  "triangle",
  "hexagon",
  "plus",
  "star",
] as const;
export type ParticleShape = (typeof PARTICLE_SHAPES)[number];
export const PARTICLE_FLOWS = ["up", "down", "both", "radial"] as const;
export type ParticleFlow = (typeof PARTICLE_FLOWS)[number];
// Contorni: concentric rings or ridge lines.
export const CONTOUR_STYLES = ["rings", "ridges"] as const;
export type ContourStyle = (typeof CONTOUR_STYLES)[number];

export const VISUALIZER_ASPECTS = ["16:9", "9:16"] as const;
export type VisualizerAspect = (typeof VISUALIZER_ASPECTS)[number];

// Render size per aspect. 9:16 is a true full-frame Short: every preset lays itself out again
// for the tall frame instead of letterboxing the wide one.
export const ASPECT_SIZE: Record<
  VisualizerAspect,
  { width: number; height: number }
> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
};
export const VISUALIZER_FPS = 30;

export const BACKGROUND_MODES = ["random", "image", "video"] as const;
export type BackgroundMode = (typeof BACKGROUND_MODES)[number];
export const CENTER_IMAGE_MODES = ["cover", "upload", "none"] as const;
export type CenterImageMode = (typeof CENTER_IMAGE_MODES)[number];
// How the centre picture sits in a round or square frame: the square crop on its subject, or
// the whole picture over a blurred copy of itself.
export { COVER_FITS, type CoverFit } from "./viz-kit.js";

// The visual effects, in the order they are applied on top of the frame.
export const VISUALIZER_EFFECTS = [
  "grain",
  "vhs",
  "scanlines",
  "vignette",
  "aberration",
  "glitch",
] as const;
export type VisualizerEffect = (typeof VISUALIZER_EFFECTS)[number];

// Ten two-colour swatches; the first is built from the MellodifAI red (globals.css --brand) and
// the teal glow of the channel's play badge.
export const COLOR_PRESETS = [
  { id: "mellodifai", primary: "#f2333d", secondary: "#2ee6d6" },
  { id: "neon", primary: "#ff2e93", secondary: "#7a5cff" },
  { id: "cyber", primary: "#00e5ff", secondary: "#2f6bff" },
  { id: "sunset", primary: "#ff7a3d", secondary: "#ff2e63" },
  { id: "matrix", primary: "#39ff6a", secondary: "#0b8f3a" },
  { id: "fire", primary: "#ffb000", secondary: "#ff3d00" },
  { id: "ocean", primary: "#1fb6ff", secondary: "#0a3d91" },
  { id: "violet", primary: "#b44cff", secondary: "#5b2bff" },
  { id: "gold", primary: "#ffd166", secondary: "#c08a1e" },
  { id: "mono", primary: "#ffffff", secondary: "#8a8a8a" },
] as const;
export type ColorPresetId = (typeof COLOR_PRESETS)[number]["id"];

// The channel's house waveform: blue to magenta (channel-report.md section 3).
export const CLASSICO_COLORS = { primary: "#3a4bff", secondary: "#ff2bd6" };

// Royalty-free backgrounds for "Casuale", drawn for this app and stored in the private uploads
// bucket (apps/worker/scripts/visualizer-stock.ts uploads them). A seed picks one.
export const STOCK_BACKGROUNDS = Array.from(
  { length: 12 },
  (_, i) => `stock/visualizer/bg-${String(i + 1).padStart(2, "0")}.jpg`,
);
export const UPLOADS_BUCKET = "uploads";
// Upload limits of the studio (item G); the uploads bucket allows up to the video limit.
export const UPLOAD_LIMITS = {
  image: 10 * 1024 * 1024,
  video: 100 * 1024 * 1024,
} as const;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const VIDEO_TYPES = ["video/mp4", "video/webm"] as const;

export const MAX_TEXT_LAYERS = 6;
export const TEXT_SIZE = { min: 12, max: 200, default: 64 } as const;

// The owner's own logos, uploaded in the Stile tab: up to two, each in a corner of the frame.
// Size is a share of the frame's short side (the logo's longer side), opacity a percentage.
export const MAX_LOGOS = 2;
export const LOGO_POSITIONS = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
] as const;
export type LogoPosition = (typeof LOGO_POSITIONS)[number];
export const LOGO_SIZE = { min: 4, max: 30, default: 12 } as const;

const hexInput = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/u)
  .transform((value) => value.toLowerCase());
const percent = z.number().int().min(0).max(100);
// A stored file as the page links it: /media/uploads/<path>. The path, not a signed link, so
// saved parameters never expire; the worker reads the same file from the bucket.
const assetUrl = z
  .string()
  .max(300)
  .regex(/^\/media\/uploads\/[A-Za-z0-9_./-]+$/u)
  .refine((value) => !value.includes(".."));

export const TextLayerSchema = z.object({
  text: z.string().max(80),
  x: percent,
  y: percent,
  size: z.number().int().min(TEXT_SIZE.min).max(TEXT_SIZE.max),
  color: hexInput,
});
export type TextLayer = z.infer<typeof TextLayerSchema>;

export const LogoSchema = z.object({
  assetUrl,
  position: z.enum(LOGO_POSITIONS),
  size: z.number().int().min(LOGO_SIZE.min).max(LOGO_SIZE.max),
  opacity: percent,
});
export type VisualizerLogo = z.infer<typeof LogoSchema>;

export function newLogo(
  assetUrl: string,
  taken: readonly VisualizerLogo[] = [],
): VisualizerLogo {
  // The first corner no other logo uses, top right first (the usual place of a channel mark).
  const order: LogoPosition[] = [
    "top-right",
    "top-left",
    "bottom-right",
    "bottom-left",
  ];
  const position =
    order.find((p) => !taken.some((logo) => logo.position === p)) ??
    "top-right";
  return { assetUrl, position, size: LOGO_SIZE.default, opacity: 100 };
}

export const EffectSchema = z.object({
  id: z.enum(VISUALIZER_EFFECTS),
  enabled: z.boolean(),
  intensity: percent,
});
export type EffectSetting = z.infer<typeof EffectSchema>;

export const LookSchema = z.object({
  teeth: z.enum(CROWN_TEETH),
  // Corona: bass at the top mirrored left and right, or the spectrum once round the ring.
  mirrored: z.boolean(),
  shape: z.enum(PARTICLE_SHAPES),
  flow: z.enum(PARTICLE_FLOWS),
  contour: z.enum(CONTOUR_STYLES),
  // Contorni: line weight in units of 1/1080 of the short side, and opacity in percent. The
  // colours are lifted to hold 3:1 against the picture whatever these are, so the opacity
  // cannot go below 60.
  contourWeight: z.number().min(1).max(6).default(2.5),
  contourOpacity: z.number().int().min(60).max(100).default(90),
});
export type VisualizerLook = z.infer<typeof LookSchema>;

// Badge Rotanti: an overlay of two text rings turning in the corners, over any preset.
export const BadgesSchema = z.object({
  enabled: z.boolean(),
  // Empty: the song title and the artist.
  text: z.string().max(40),
});
export type VisualizerBadges = z.infer<typeof BadgesSchema>;

export function defaultLook(): VisualizerLook {
  return {
    teeth: "wedge",
    mirrored: true,
    shape: "circle",
    flow: "up",
    contour: "rings",
    contourWeight: 2.5,
    contourOpacity: 90,
  };
}

export function defaultBadges(): VisualizerBadges {
  return { enabled: false, text: "" };
}

export const VisualizerParamsSchema = z.object({
  preset: z.enum(VISUALIZER_PRESETS),
  aspect: z.enum(VISUALIZER_ASPECTS),
  background: z.object({
    mode: z.enum(BACKGROUND_MODES),
    seed: z.number().int().min(0).max(2147483647),
    assetUrl: assetUrl.nullable(),
    dimming: percent,
  }),
  colors: z.object({ primary: hexInput, secondary: hexInput }),
  particles: percent,
  centerImage: z.object({
    mode: z.enum(CENTER_IMAGE_MODES),
    assetUrl: assetUrl.nullable(),
    fit: z.enum(COVER_FITS).default("cover"),
  }),
  textLayers: z.array(TextLayerSchema).max(MAX_TEXT_LAYERS),
  effects: z
    .array(EffectSchema)
    .max(VISUALIZER_EFFECTS.length)
    .refine(
      (list) => new Set(list.map((effect) => effect.id)).size === list.length,
      "duplicate effect",
    ),
  // The Testo tab's lines: artist and album (the player-style presets show them too) and the
  // website line of MellodifAI Classico. Empty by default: no preset shows a name nobody typed.
  classico: z.object({
    artist: z.string().max(40),
    website: z.string().max(40),
    album: z.string().max(40),
    // Intro "ARTIST / PRESENTS", the subscribe callout at 1:30 and the end card.
    cards: z.boolean(),
  }),
  // Added with the catalogue looks: rows saved before them read the defaults.
  look: LookSchema.default(defaultLook),
  badges: BadgesSchema.default(defaultBadges),
  // Added with the owner's logos (Task 28): rows saved before them have none.
  logos: z.array(LogoSchema).max(MAX_LOGOS).default([]),
});
export type VisualizerParams = z.infer<typeof VisualizerParamsSchema>;

export function defaultEffects(): EffectSetting[] {
  return VISUALIZER_EFFECTS.map((id) => ({
    id,
    enabled: false,
    intensity: 50,
  }));
}

export function defaultVisualizerParams(): VisualizerParams {
  const [first] = COLOR_PRESETS;
  return {
    preset: "circle",
    aspect: "16:9",
    background: { mode: "random", seed: 0, assetUrl: null, dimming: 60 },
    colors: { primary: first.primary, secondary: first.secondary },
    particles: 30,
    centerImage: { mode: "cover", assetUrl: null, fit: "cover" },
    textLayers: [],
    effects: defaultEffects(),
    classico: { artist: "", website: "", album: "", cards: true },
    look: defaultLook(),
    badges: defaultBadges(),
    logos: [],
  };
}

// The artist and website lines every saved set carried before Task 28, when they were the
// defaults. A set saved before the logos (no `logos` field) that still holds them exactly was
// never typed by the user, so it reads as empty; anything else is kept.
export const LEGACY_DEFAULT_LINES = {
  artist: "AIMELODIA",
  website: "STEFANDSL.COM",
} as const;

function pick<T>(schema: z.ZodType<T>, value: unknown, fallback: T): T {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

// Reads saved parameters (localStorage, an older render) field by field: a missing or broken
// value falls back to its default instead of losing the whole set. Effects always come back
// once each, in the order they are applied.
export function normalizeVisualizerParams(input: unknown): VisualizerParams {
  const d = defaultVisualizerParams();
  const shape = VisualizerParamsSchema.shape;
  const bg = field(input, "background");
  const colors = field(input, "colors");
  const center = field(input, "centerImage");
  const classico = field(input, "classico");
  const look = field(input, "look");
  const badges = field(input, "badges");
  const savedEffects = Array.isArray(field(input, "effects"))
    ? (field(input, "effects") as unknown[])
    : [];
  const effects = d.effects.map((base) => {
    const found = savedEffects.find((item) => field(item, "id") === base.id);
    return pick(EffectSchema, found, base);
  });
  const layers = Array.isArray(field(input, "textLayers"))
    ? (field(input, "textLayers") as unknown[])
        .map((item) => TextLayerSchema.safeParse(item))
        .flatMap((item) => (item.success ? [item.data] : []))
        .slice(0, MAX_TEXT_LAYERS)
    : [];
  const bgShape = shape.background.shape;
  const centerShape = shape.centerImage.shape;
  const classicoShape = shape.classico.shape;
  // Saved before the logos: the old default artist and website lines were never typed.
  const legacy = !(
    input &&
    typeof input === "object" &&
    "logos" in (input as Record<string, unknown>)
  );
  const line = (key: "artist" | "website") => {
    const value = pick(
      classicoShape[key],
      field(classico, key),
      d.classico[key],
    );
    return legacy && value === LEGACY_DEFAULT_LINES[key] ? "" : value;
  };
  const savedLogos = field(input, "logos");
  const logos = (Array.isArray(savedLogos) ? savedLogos : [])
    .flatMap((item): VisualizerLogo[] => {
      // Field by field: a logo without a readable file goes, a broken corner, size or opacity
      // falls back to its default.
      const url = LogoSchema.shape.assetUrl.safeParse(field(item, "assetUrl"));
      if (!url.success) return [];
      const base = newLogo(url.data);
      return [
        {
          assetUrl: url.data,
          position: pick(
            LogoSchema.shape.position,
            field(item, "position"),
            base.position,
          ),
          size: pick(LogoSchema.shape.size, field(item, "size"), base.size),
          opacity: pick(
            LogoSchema.shape.opacity,
            field(item, "opacity"),
            base.opacity,
          ),
        },
      ];
    })
    .slice(0, MAX_LOGOS);
  return {
    preset: pick(shape.preset, field(input, "preset"), d.preset),
    aspect: pick(shape.aspect, field(input, "aspect"), d.aspect),
    background: {
      mode: pick(bgShape.mode, field(bg, "mode"), d.background.mode),
      seed: pick(bgShape.seed, field(bg, "seed"), d.background.seed),
      assetUrl: pick(
        bgShape.assetUrl,
        field(bg, "assetUrl"),
        d.background.assetUrl,
      ),
      dimming: pick(
        bgShape.dimming,
        field(bg, "dimming"),
        d.background.dimming,
      ),
    },
    colors: {
      primary: pick(hexInput, field(colors, "primary"), d.colors.primary),
      secondary: pick(hexInput, field(colors, "secondary"), d.colors.secondary),
    },
    particles: pick(shape.particles, field(input, "particles"), d.particles),
    centerImage: {
      mode: pick(centerShape.mode, field(center, "mode"), d.centerImage.mode),
      assetUrl: pick(
        centerShape.assetUrl,
        field(center, "assetUrl"),
        d.centerImage.assetUrl,
      ),
      fit: pick(centerShape.fit, field(center, "fit"), d.centerImage.fit),
    },
    textLayers: layers,
    effects,
    classico: {
      artist: line("artist"),
      website: line("website"),
      album: pick(
        classicoShape.album,
        field(classico, "album"),
        d.classico.album,
      ),
      cards: pick(
        classicoShape.cards,
        field(classico, "cards"),
        d.classico.cards,
      ),
    },
    look: {
      teeth: pick(LookSchema.shape.teeth, field(look, "teeth"), d.look.teeth),
      mirrored: pick(
        LookSchema.shape.mirrored,
        field(look, "mirrored"),
        d.look.mirrored,
      ),
      shape: pick(LookSchema.shape.shape, field(look, "shape"), d.look.shape),
      flow: pick(LookSchema.shape.flow, field(look, "flow"), d.look.flow),
      contour: pick(
        LookSchema.shape.contour,
        field(look, "contour"),
        d.look.contour,
      ),
      contourWeight: pick(
        LookSchema.shape.contourWeight,
        field(look, "contourWeight"),
        d.look.contourWeight,
      ),
      contourOpacity: pick(
        LookSchema.shape.contourOpacity,
        field(look, "contourOpacity"),
        d.look.contourOpacity,
      ),
    },
    badges: {
      enabled: pick(
        BadgesSchema.shape.enabled,
        field(badges, "enabled"),
        d.badges.enabled,
      ),
      text: pick(BadgesSchema.shape.text, field(badges, "text"), d.badges.text),
    },
    logos,
  };
}

// The stored path inside the uploads bucket of an asset link, or null for anything else.
export function uploadPathOf(url: string | null): string | null {
  const prefix = "/media/uploads/";
  if (!url?.startsWith(prefix)) return null;
  const path = url
    .slice(prefix.length)
    .split("/")
    .map((part) => decodeURIComponent(part))
    .join("/");
  return path && !path.includes("..") ? path : null;
}

export function uploadUrlOf(path: string): string {
  return `/media/uploads/${path.split("/").map(encodeURIComponent).join("/")}`;
}

// The "Casuale" background for a seed.
export function stockBackground(seed: number): string {
  const n = STOCK_BACKGROUNDS.length;
  return STOCK_BACKGROUNDS[((Math.trunc(seed) % n) + n) % n] as string;
}

// A new seed that shows a different stock picture than `seed`.
export function rerollSeed(seed: number, random = Math.random): number {
  const n = STOCK_BACKGROUNDS.length;
  const step = 1 + Math.floor(random() * (n - 1));
  return (
    (((Math.trunc(seed) % n) + n + step) % n) + n * Math.floor(random() * 1000)
  );
}

// The background picture or video the frame uses: the stock picture for "Casuale", else the
// upload (null until one is chosen, which draws the colour gradient).
export function backgroundAsset(params: VisualizerParams): string | null {
  if (params.background.mode === "random")
    return uploadUrlOf(stockBackground(params.background.seed));
  return params.background.assetUrl;
}

export function colorPresetOf(params: VisualizerParams): ColorPresetId | null {
  return (
    COLOR_PRESETS.find(
      (item) =>
        item.primary === params.colors.primary.toLowerCase() &&
        item.secondary === params.colors.secondary.toLowerCase(),
    )?.id ?? null
  );
}

export function effectOf(
  params: VisualizerParams,
  id: VisualizerEffect,
): EffectSetting {
  return (
    params.effects.find((item) => item.id === id) ?? {
      id,
      enabled: false,
      intensity: 50,
    }
  );
}

// The text stack of MellodifAI Classico, in the one order the channel settled on (report
// section 6.1): song title large, "by ARTIST", album, then the website line. Empty lines go.
export function classicoLines(
  params: VisualizerParams,
  title: string,
): { text: string; size: number }[] {
  const c = params.classico;
  const up = (value: string) => value.trim().toUpperCase();
  return [
    { text: up(title) ? `SONG: ${up(title)}` : "", size: 1 },
    { text: up(c.artist) ? `by ${up(c.artist)}` : "", size: 0.62 },
    { text: up(c.album) ? `ALBUM: ${up(c.album)}` : "", size: 0.5 },
    { text: up(c.website), size: 0.5 },
  ].filter((line) => line.text);
}

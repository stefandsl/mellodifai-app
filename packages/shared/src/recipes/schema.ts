import { z } from "zod";
import { REMAKE_COUNTRIES } from "../remake/workflow.js";
import { BPM_RANGE, SONG_KEYS, TIME_SIGNATURES } from "../song-settings.js";
import {
  licenceForbidsDerivatives,
  SOURCE_LICENCES,
  SOURCE_MODES,
} from "../song-source.js";
import { LANGS } from "../stages.js";

// Data model for MellodifAI song recipes (C14 / RECIPES-MODEL.md).
// Content lives in content/recipes/<slug>/recipe.json; media lives under
// apps/web/public/site/recipes/<slug>/ and is indexed by assets.manifest.json.

export const RECIPE_SCHEMA_VERSION = 1 as const;
export const RECIPE_PREVIEW_MAX_BYTES = 3 * 1024 * 1024;

export const RECIPE_KINDS = ["remix", "cover", "pantomime", "satire"] as const;
export type RecipeKind = (typeof RECIPE_KINDS)[number];

export const RECIPE_FORMS = ["hook", "full"] as const;
export type RecipeForm = (typeof RECIPE_FORMS)[number];

export const RECIPE_OUTPUTS = ["audio", "lyric-video", "visualizer"] as const;
export type RecipeOutput = (typeof RECIPE_OUTPUTS)[number];

export const RECIPE_FORMATS = ["16:9", "9:16", "1:1", "4:5"] as const;
export type RecipeFormat = (typeof RECIPE_FORMATS)[number];

export const RECIPE_SURFACES = ["web", "desktop", "agent"] as const;
export type RecipeSurface = (typeof RECIPE_SURFACES)[number];

export const RECIPE_STATUSES = ["draft", "published"] as const;
export type RecipeStatus = (typeof RECIPE_STATUSES)[number];

export const RECIPE_INPUT_KINDS = [
  "link",
  "audio",
  "lyrics",
  "text",
  "select",
] as const;
export type RecipeInputKind = (typeof RECIPE_INPUT_KINDS)[number];

export const RECIPE_MEDIA_ACCEPT = ["audio", "video", "link"] as const;
export type RecipeMediaAccept = (typeof RECIPE_MEDIA_ACCEPT)[number];

export const RECIPE_REWRITE_MODES = [
  "faithful",
  "pantomime",
  "satire",
] as const;
export type RecipeRewriteMode = (typeof RECIPE_REWRITE_MODES)[number];

export const RECIPE_TARGETS = [
  "tiktok",
  "reels",
  "shorts",
  "instagram",
  "youtube",
  "linkedin",
  "spotify",
  "apple-music",
] as const;
export type RecipeTarget = (typeof RECIPE_TARGETS)[number];

export const RECIPE_LINK_BINDS = ["remake_start.url"] as const;
export const RECIPE_AUDIO_BINDS = ["song_create.settings.source"] as const;
export const RECIPE_LYRICS_BINDS = ["song_create.lyrics"] as const;
export const RECIPE_TEXT_BINDS = [
  "song_create.prompt",
  "song_create.styles",
  "song_create.settings.title",
  "song_create.settings.exclude",
  "rewrite.target",
  "rewrite.angle",
] as const;
export const RECIPE_SELECT_BINDS = [
  "song_create.vocalGender",
  "song_create.languages",
  "remake_start.country",
  "song_create.settings.keyscale",
  "song_create.settings.timeSignature",
] as const;

export const RECIPE_BINDS_TO = [
  ...RECIPE_LINK_BINDS,
  ...RECIPE_AUDIO_BINDS,
  ...RECIPE_LYRICS_BINDS,
  ...RECIPE_TEXT_BINDS,
  ...RECIPE_SELECT_BINDS,
] as const;
export type RecipeBindsTo = (typeof RECIPE_BINDS_TO)[number];

const EM_DASH = String.fromCodePoint(0x2014);
const noEmDash = (text: string) => !text.includes(EM_DASH);

function plainText(min: number, max: number) {
  return z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine(noEmDash, { message: "Em dash is not allowed" });
}

export function localizedText(min: number, max: number) {
  return z.object({
    it: plainText(min, max),
    en: plainText(min, max),
  });
}

export type LocalizedText = { it: string; en: string };
export type RecipeLocale = "it" | "en";

const KEBAB_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CAMEL_ID = /^[a-z][a-zA-Z0-9]*$/u;
const COVER_FILE = /^[a-z0-9][a-z0-9._-]*\.(?:webp|jpe?g)$/u;
const MEDIA_FILE = /^[a-z0-9][a-z0-9._-]*\.(?:mp4|mp3|wav|ogg)$/u;

const SELECT_ENUM_ALLOWLIST: Record<
  (typeof RECIPE_SELECT_BINDS)[number],
  readonly string[]
> = {
  "song_create.vocalGender": ["m", "f"],
  "song_create.languages": LANGS,
  "remake_start.country": REMAKE_COUNTRIES,
  "song_create.settings.keyscale": SONG_KEYS,
  "song_create.settings.timeSignature": TIME_SIGNATURES,
};

const BaseInputFields = {
  id: z.string().min(2).max(40).regex(CAMEL_ID, "Input id must be camelCase"),
  label: localizedText(4, 40),
  hint: localizedText(4, 140).nullable(),
  placeholder: localizedText(2, 120).optional(),
  optional: z.boolean().default(false),
};

export const LinkInputSchema = z.object({
  ...BaseInputFields,
  kind: z.literal("link"),
  maxLength: z.number().int().min(10).max(500).nullable().optional(),
  bindsTo: z.enum(RECIPE_LINK_BINDS),
});

export const AudioInputSchema = z
  .object({
    ...BaseInputFields,
    kind: z.literal("audio"),
    accept: z.array(z.enum(RECIPE_MEDIA_ACCEPT)).min(1),
    min: z.number().int().min(0).max(1),
    max: z.number().int().min(1).max(1),
    bindsTo: z.enum(RECIPE_AUDIO_BINDS),
  })
  .refine((v) => v.min <= v.max, {
    message: "min must be less than or equal to max",
    path: ["min"],
  });

export const LyricsInputSchema = z.object({
  ...BaseInputFields,
  kind: z.literal("lyrics"),
  maxLength: z.number().int().min(20).max(5000).nullable().optional(),
  bindsTo: z.enum(RECIPE_LYRICS_BINDS),
});

export const TextInputSchema = z.object({
  ...BaseInputFields,
  kind: z.literal("text"),
  maxLength: z.number().int().min(4).max(500).nullable().optional(),
  bindsTo: z.enum(RECIPE_TEXT_BINDS),
});

export const SelectOptionSchema = z.object({
  value: z.string().trim().min(1).max(60),
  label: localizedText(2, 50),
});

export const SelectInputSchema = z
  .object({
    ...BaseInputFields,
    kind: z.literal("select"),
    options: z.array(SelectOptionSchema).min(2).max(20),
    default: z.string().trim().min(1).max(60),
    bindsTo: z.enum(RECIPE_SELECT_BINDS),
  })
  .superRefine((input, ctx) => {
    const values = new Set<string>();
    const allowed = new Set(SELECT_ENUM_ALLOWLIST[input.bindsTo]);
    for (const [i, opt] of input.options.entries()) {
      if (values.has(opt.value)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate select option value "${opt.value}"`,
          path: ["options", i, "value"],
        });
      }
      values.add(opt.value);
      if (!allowed.has(opt.value)) {
        ctx.addIssue({
          code: "custom",
          message: `Option "${opt.value}" is not allowed for ${input.bindsTo}`,
          path: ["options", i, "value"],
        });
      }
    }
    if (!values.has(input.default)) {
      ctx.addIssue({
        code: "custom",
        message: `Default "${input.default}" must match one of the select options`,
        path: ["default"],
      });
    }
  });

export const RecipeInputSchema = z.discriminatedUnion("kind", [
  LinkInputSchema,
  AudioInputSchema,
  LyricsInputSchema,
  TextInputSchema,
  SelectInputSchema,
]);
export type RecipeInput = z.infer<typeof RecipeInputSchema>;

export const RecipeMediaSchema = z.object({
  cover: z
    .string()
    .regex(COVER_FILE, "cover must be a safe relative .webp or .jpg filename"),
  preview: z
    .string()
    .regex(
      MEDIA_FILE,
      "preview must be a safe relative .mp4, .mp3, .wav or .ogg filename",
    ),
  example: z
    .string()
    .regex(
      MEDIA_FILE,
      "example must be a safe relative .mp4, .mp3, .wav or .ogg filename",
    ),
  startAt: z.number().min(0).max(30),
});
export type RecipeMedia = z.infer<typeof RecipeMediaSchema>;

export const RecipePresetSchema = z
  .object({
    styles: plainText(2, 1000).optional(),
    vocalGender: z.enum(["m", "f"]).nullable().optional(),
    sourceMode: z.enum(SOURCE_MODES).optional(),
    audioWeight: z.number().min(0).max(1).optional(),
    styleWeight: z.number().min(0).max(1).optional(),
    weirdness: z.number().min(0).max(1).optional(),
    bpm: z.number().int().min(BPM_RANGE.min).max(BPM_RANGE.max).optional(),
    keyscale: z.enum(SONG_KEYS as [string, ...string[]]).optional(),
    timeSignature: z.enum(TIME_SIGNATURES).optional(),
    duration: z.number().int().min(10).max(360).nullable().optional(),
    video: z.enum(["lyric", "off", "visualizer"]).optional(),
    rewriteMode: z.enum(RECIPE_REWRITE_MODES).optional(),
  })
  .strict();
export type RecipePreset = z.infer<typeof RecipePresetSchema>;

export const RecipeRightsSchema = z
  .object({
    owner: plainText(2, 120),
    clearedOn: z.iso.date(),
    note: plainText(5, 300),
    licence: z.enum(SOURCE_LICENCES).default("own"),
  })
  .superRefine((rights, ctx) => {
    if (rights.licence === "unknown") {
      ctx.addIssue({
        code: "custom",
        message: "Recipe rights licence cannot be unknown",
        path: ["licence"],
      });
    }
    if (licenceForbidsDerivatives(rights.licence)) {
      ctx.addIssue({
        code: "custom",
        message: `Licence "${rights.licence}" forbids derivatives`,
        path: ["licence"],
      });
    }
  });
export type RecipeRights = z.infer<typeof RecipeRightsSchema>;

export const RecipeEstimateSchema = z.object({
  credits: z.number().min(0).max(100),
  seconds: z.number().int().min(0).max(3600),
});
export type RecipeEstimate = z.infer<typeof RecipeEstimateSchema>;

export const RecipeTempoSchema = z.object({
  bpm: z.number().int().min(BPM_RANGE.min).max(BPM_RANGE.max).optional(),
  feel: plainText(2, 40).optional(),
});
export type RecipeTempo = z.infer<typeof RecipeTempoSchema>;

export const RecipeSchema = z
  .object({
    id: z.uuid(),
    slug: z
      .string()
      .min(3)
      .max(40)
      .regex(KEBAB_SLUG, "slug must be kebab-case"),
    schemaVersion: z.literal(RECIPE_SCHEMA_VERSION),
    kind: z.enum(RECIPE_KINDS),
    title: localizedText(3, 40),
    summary: localizedText(40, 130),
    highlights: z.array(localizedText(15, 50)).max(3),
    body: localizedText(10, 4000).optional(),
    inputs: z.array(RecipeInputSchema).min(1).max(6),
    languages: z.array(z.enum(LANGS)).min(1),
    genre: plainText(2, 40),
    tempo: RecipeTempoSchema.optional(),
    form: z.enum(RECIPE_FORMS),
    output: z.enum(RECIPE_OUTPUTS),
    format: z.enum(RECIPE_FORMATS).optional(),
    featured: z.boolean(),
    surfaces: z.array(z.enum(RECIPE_SURFACES)).min(1),
    media: RecipeMediaSchema,
    preset: RecipePresetSchema,
    fixture: z
      .string()
      .min(3)
      .max(40)
      .regex(KEBAB_SLUG, "fixture must be kebab-case"),
    rights: RecipeRightsSchema,
    estimate: RecipeEstimateSchema,
    status: z.enum(RECIPE_STATUSES),
  })
  .strict()
  .superRefine((recipe, ctx) => {
    const seenInputIds = new Set<string>();
    for (const [i, item] of recipe.inputs.entries()) {
      const id = item.id;
      if (seenInputIds.has(id)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate input id "${id}"`,
          path: ["inputs", i, "id"],
        });
      }
      seenInputIds.add(id);
    }

    if (new Set(recipe.languages).size !== recipe.languages.length) {
      ctx.addIssue({
        code: "custom",
        message: "languages must not contain duplicates",
        path: ["languages"],
      });
    }

    if (new Set(recipe.surfaces).size !== recipe.surfaces.length) {
      ctx.addIssue({
        code: "custom",
        message: "surfaces must not contain duplicates",
        path: ["surfaces"],
      });
    }

    if (recipe.output === "audio" && recipe.format !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "audio output must not set a video format",
        path: ["format"],
      });
    }

    if (recipe.output !== "audio" && recipe.format === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "video outputs require a format",
        path: ["format"],
      });
    }
  });

export type Recipe = z.infer<typeof RecipeSchema>;

export {
  AUDIO_TARGETS,
  TARGETS_BY_FORMAT,
  targetsForRecipe,
} from "./search.js";

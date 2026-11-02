import { z } from "zod";

// Video blueprint schema v1 (master design section 9.1): the source video's timing and
// style descriptors, which a remake keeps while every graphic is new. It records style
// only: no source text, no source frames, no font or brand names of the source.

export const BLUEPRINT_SECTION_LABELS = [
  "intro",
  "verse",
  "pre",
  "chorus",
  "hook",
  "bridge",
  "outro",
  "other",
] as const;
export const BLUEPRINT_VOCALS = [
  "male",
  "female",
  "duet",
  "choir",
  "none",
] as const;
export const SHOT_LAYOUTS = [
  "full_bleed",
  "centered_title",
  "lower_third",
  "split",
  "grid",
  "visualizer_center",
  "text_only",
] as const;
export const TYPOGRAPHY_ROLES = [
  "title",
  "lyric",
  "caption",
  "credit",
] as const;
export const TYPE_WEIGHTS = ["light", "regular", "bold", "black"] as const;
export const TYPE_CASES = ["upper", "title", "sentence"] as const;
export const TYPE_POSITIONS = [
  "top",
  "center",
  "bottom",
  "left",
  "right",
] as const;
export const CAMERA_MOVES = [
  "static",
  "push_in",
  "pull_out",
  "pan",
  "shake",
] as const;
export const KINETIC_TEXT = [
  "none",
  "word_pop",
  "line_slide",
  "typewriter",
  "scale_pulse",
] as const;
export const TRANSITIONS = [
  "cut",
  "crossfade",
  "whip",
  "zoom",
  "glitch",
] as const;
export const OVERLAY_KINDS = ["lyric", "title", "logo_slot", "shape"] as const;
export const IMAGE_NEEDS = ["none", "background", "subject"] as const;

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

export const BlueprintSectionSchema = z.object({
  id: z.string(),
  label: z.enum(BLUEPRINT_SECTION_LABELS),
  startS: z.number(),
  endS: z.number(),
  energy: z.number().min(0).max(1),
  bars: z.number().int(),
});

export const BlueprintShotSchema = z.object({
  id: z.string(),
  sectionId: z.string(),
  startS: z.number(),
  endS: z.number(),
  offsetInSection: z.number().min(0).max(1),
  layout: z.enum(SHOT_LAYOUTS),
  typographyRoles: z
    .array(
      z.object({
        role: z.enum(TYPOGRAPHY_ROLES),
        weight: z.enum(TYPE_WEIGHTS),
        case: z.enum(TYPE_CASES),
        position: z.enum(TYPE_POSITIONS),
      }),
    )
    .max(4),
  palette: z.array(hex).max(6),
  motion: z.object({
    camera: z.enum(CAMERA_MOVES),
    cutOnBeat: z.boolean(),
    kineticText: z.enum(KINETIC_TEXT),
    visualizer: z.string().nullable(),
  }),
  transition: z.enum(TRANSITIONS),
  overlays: z
    .array(z.object({ kind: z.enum(OVERLAY_KINDS), position: z.string() }))
    .max(6),
  imageNeed: z.enum(IMAGE_NEEDS),
});
export type BlueprintShot = z.infer<typeof BlueprintShotSchema>;

export const BlueprintSchema = z
  .object({
    schemaVersion: z.literal(1),
    source: z.object({
      videoId: z.string(),
      url: z.string().url(),
      durationS: z.number(),
      analysedAt: z.string(),
    }),
    music: z.object({
      bpm: z.number(),
      key: z.string(),
      timeSig: z.string(),
      sections: z.array(BlueprintSectionSchema),
      downbeatsS: z.array(z.number()),
      vocal: z.enum(BLUEPRINT_VOCALS),
      instrumentation: z.array(z.string()).max(12),
    }),
    shots: z.array(BlueprintShotSchema).max(200),
    global: z.object({
      palette: z.array(z.string()).max(8),
      aspect: z.enum(["16:9", "9:16"]),
      typeScale: z.object({ basePx: z.number(), ratio: z.number() }),
    }),
  })
  // Beyond 9.1: the cross-checks a consumer would otherwise repeat.
  .superRefine((bp, ctx) => {
    const ids = new Set(bp.music.sections.map((s) => s.id));
    for (const [i, s] of bp.music.sections.entries()) {
      const previous = bp.music.sections[i - 1];
      if (s.endS <= s.startS || (previous && s.startS < previous.endS - 1e-6))
        ctx.addIssue({
          code: "custom",
          path: ["music", "sections", i],
          message: "sections must be sorted, positive and must not overlap",
        });
    }
    for (const [i, shot] of bp.shots.entries()) {
      const previous = bp.shots[i - 1];
      if (
        shot.endS <= shot.startS ||
        (previous && shot.startS < previous.endS - 1e-6)
      )
        ctx.addIssue({
          code: "custom",
          path: ["shots", i],
          message: "shots must be sorted, positive and must not overlap",
        });
      if (shot.endS > bp.source.durationS + 0.5)
        ctx.addIssue({
          code: "custom",
          path: ["shots", i, "endS"],
          message: "shot ends after the video",
        });
      if (!ids.has(shot.sectionId))
        ctx.addIssue({
          code: "custom",
          path: ["shots", i, "sectionId"],
          message: `unknown section ${shot.sectionId}`,
        });
    }
  });
export type Blueprint = z.infer<typeof BlueprintSchema>;

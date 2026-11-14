// Agent operations on a music-video storyboard (ops.music_video_* in the database). The web
// registry mounts them like the other token operations.
import { z } from "zod";
import { TAKE_PHASES } from "./prices.js";
import {
  AssetId,
  MAX_ELEMENT_REFS,
  SHOT_ANGLES,
  SHOT_LENSES,
  SHOT_MOVEMENTS,
  SHOT_SIZES,
  StoryboardSchema,
} from "./storyboard.js";

const Id = z.string().uuid();

export const MusicVideoStoryboardInput = z.object({ version_id: Id });
// An object like every other operation answer: null before the plan exists.
export const MusicVideoStoryboardOutput = z.object({
  storyboard: StoryboardSchema.nullable(),
});

export const MusicVideoElementPatch = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000),
    // Storage paths in the owner's folder (`<owner id>/...`); the database checks the owner.
    ref_asset_ids: z.array(AssetId).max(MAX_ELEMENT_REFS),
  })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: "nothing to save" });
export const MusicVideoElementUpdateInput = z.object({
  element_id: Id,
  patch: MusicVideoElementPatch,
});

export const MusicVideoShotPatch = z
  .object({
    size: z.enum(SHOT_SIZES),
    angle: z.enum(SHOT_ANGLES),
    movement: z.enum(SHOT_MOVEMENTS),
    lens: z.enum(SHOT_LENSES),
    mood: z.string().trim().max(200),
    // Lyrics are not editable: they come from the cut plan and must match the song audio.
    cast_ids: z.array(Id).max(12),
    location_id: Id.nullable(),
  })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: "nothing to save" });
export const MusicVideoShotUpdateInput = z.object({
  shot_id: Id,
  patch: MusicVideoShotPatch,
});

export const MusicVideoTakeRequestInput = z.object({
  shot_id: Id,
  phase: z.enum(TAKE_PHASES),
});
// A requested take is only quoted: the approval step (F4) starts it.
export const MusicVideoTakeQuote = z.object({
  take_id: Id,
  shot_id: Id,
  phase: z.enum(TAKE_PHASES),
  model: z.string(),
  status: z.literal("quoted"),
  price: z.object({ credits: z.number().min(0), seconds: z.number().int() }),
});

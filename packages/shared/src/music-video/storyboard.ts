// The storyboard of a music video, after the Cinema model of Parallax (github.com/nickvasilescu/
// parallax, MIT; idea only, no code copied): one project per song version, scenes (the song's
// sections in order), shots (one per cut-plan segment), elements (characters, locations, props
// with reference images) and takes (draft or final generations of one shot).
//
// Rows use the database's snake_case names. A plan (`MvPlan`) is what the worker writes in one
// call (public.mv_save_plan): elements and shots there name elements by `key`, the database
// resolves keys to ids.
import { z } from "zod";
import { type CutPlan, CutPlanSchema } from "./cut-plan.js";
import { TAKE_PHASES } from "./prices.js";
import {
  CAMERAS,
  type Camera,
  SECTION_KINDS,
  SHOT_KINDS,
  type ShotList,
  ShotListSchema,
  type ShotSectionKind,
} from "./shot-list.js";

export const ELEMENT_KINDS = ["character", "location", "prop"] as const;
export const SHOT_SIZES = [
  "extreme-close-up",
  "close-up",
  "medium-close-up",
  "medium",
  "wide",
  "extreme-wide",
] as const;
export const SHOT_ANGLES = ["eye-level", "low", "high", "overhead"] as const;
export const SHOT_MOVEMENTS = [
  "static",
  "push-in",
  "pull-out",
  "dolly",
  "orbit",
  "handheld",
  "crane",
] as const;
export const SHOT_LENSES = ["24mm", "35mm", "50mm", "85mm", "135mm"] as const;
export const TAKE_STATUSES = [
  "quoted",
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
] as const;
export const MV_ASPECTS = ["16:9", "9:16", "1:1"] as const;
export const MAX_ELEMENT_REFS = 8;

export type ShotSize = (typeof SHOT_SIZES)[number];
export type ShotAngle = (typeof SHOT_ANGLES)[number];
export type ShotMovement = (typeof SHOT_MOVEMENTS)[number];
export type ShotLens = (typeof SHOT_LENSES)[number];
export type ElementKind = (typeof ELEMENT_KINDS)[number];

const Id = z.string().uuid();
const Timestamp = z.iso.datetime({ offset: true });
const Key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/u);
// A storage object path or another asset id the worker can resolve to a file.
export const AssetId = z.string().min(1).max(300);

export const MvLookSchema = z
  .object({
    style: z.string().max(200).default(""),
    grade: z.string().max(200).default(""),
    lighting: z.string().max(200).default(""),
  })
  .strict();
export type MvLook = z.infer<typeof MvLookSchema>;

export const ShotFramingSchema = z.object({
  size: z.enum(SHOT_SIZES),
  angle: z.enum(SHOT_ANGLES),
  movement: z.enum(SHOT_MOVEMENTS),
  lens: z.enum(SHOT_LENSES),
});
export type ShotFraming = z.infer<typeof ShotFramingSchema>;

export const MvProjectSchema = z.object({
  id: Id,
  owner_id: Id,
  version_id: Id,
  title: z.string().min(1).max(200),
  language: z.string().min(1).max(40),
  genre: z.string().min(1).max(80),
  aspect: z.enum(MV_ASPECTS),
  fps: z.number().int().positive(),
  frames: z.number().int().positive(),
  look: MvLookSchema,
  cut_plan: CutPlanSchema,
  created_at: Timestamp,
  updated_at: Timestamp,
});
export type MvProject = z.infer<typeof MvProjectSchema>;

export const MvSceneSchema = z.object({
  id: Id,
  project_id: Id,
  position: z.number().int().min(0),
  section: z.string().max(80),
  section_kind: z.enum(SECTION_KINDS),
  start_frame: z.number().int().min(0),
  end_frame: z.number().int().positive(),
});
export type MvScene = z.infer<typeof MvSceneSchema>;

export const MvElementSchema = z.object({
  id: Id,
  project_id: Id,
  key: Key,
  kind: z.enum(ELEMENT_KINDS),
  name: z.string().min(1).max(120),
  description: z.string().max(1000),
  ref_asset_ids: z.array(AssetId).max(MAX_ELEMENT_REFS),
  updated_at: Timestamp,
});
export type MvElement = z.infer<typeof MvElementSchema>;

export const MvShotSchema = ShotFramingSchema.extend({
  id: Id,
  project_id: Id,
  scene_id: Id,
  position: z.number().int().min(0),
  segment: z.number().int().min(0),
  start_frame: z.number().int().min(0),
  end_frame: z.number().int().positive(),
  kind: z.enum(SHOT_KINDS),
  // The cameras of a burst's cuts in order; empty for other kinds.
  burst: z.array(z.enum(CAMERAS)),
  mood: z.string().max(200),
  lyrics: z.string().max(2000),
  energy: z.number().min(0).max(1),
  cast_ids: z.array(Id).max(12),
  location_id: Id.nullable(),
  updated_at: Timestamp,
});
export type MvShot = z.infer<typeof MvShotSchema>;

export const MvTakeSchema = z.object({
  id: Id,
  shot_id: Id,
  phase: z.enum(TAKE_PHASES),
  model: z.string().min(1),
  prompt: z.string().nullable(),
  // Reference assets in the order they are sent.
  refs: z.array(AssetId),
  params: z.record(z.string(), z.unknown()),
  cost_credits: z.number().min(0),
  // The draft gates' result (GateResult of gates.ts) once measured.
  gates: z.unknown().nullable(),
  status: z.enum(TAKE_STATUSES),
  chosen: z.boolean(),
  created_at: Timestamp,
});
export type MvTake = z.infer<typeof MvTakeSchema>;

export const StoryboardSchema = z.object({
  project: MvProjectSchema,
  elements: z.array(MvElementSchema),
  scenes: z.array(
    MvSceneSchema.extend({
      shots: z.array(MvShotSchema.extend({ takes: z.array(MvTakeSchema) })),
    }),
  ),
});
export type Storyboard = z.infer<typeof StoryboardSchema>;

// What the worker writes for one song version.
export const MvPlanSchema = z
  .object({
    project: MvProjectSchema.pick({
      title: true,
      language: true,
      genre: true,
      aspect: true,
      fps: true,
      frames: true,
      look: true,
      cut_plan: true,
    }),
    elements: z.array(
      MvElementSchema.pick({
        key: true,
        kind: true,
        name: true,
        description: true,
        ref_asset_ids: true,
      }),
    ),
    scenes: z.array(
      MvSceneSchema.pick({
        position: true,
        section: true,
        section_kind: true,
        start_frame: true,
        end_frame: true,
      }),
    ),
    shots: z.array(
      MvShotSchema.pick({
        position: true,
        segment: true,
        start_frame: true,
        end_frame: true,
        kind: true,
        size: true,
        angle: true,
        movement: true,
        lens: true,
        burst: true,
        mood: true,
        lyrics: true,
        energy: true,
      }).extend({
        scene_position: z.number().int().min(0),
        cast_keys: z.array(Key).max(12),
        location_key: Key.nullable(),
      }),
    ),
  })
  .superRefine((plan, ctx) => {
    const kinds = new Map(plan.elements.map((e) => [e.key, e.kind]));
    if (kinds.size !== plan.elements.length)
      ctx.addIssue({ code: "custom", message: "two elements share a key" });
    const scenes = new Set(plan.scenes.map((s) => s.position));
    plan.shots.forEach((shot, i) => {
      if (shot.position !== i)
        ctx.addIssue({ code: "custom", message: `shot ${i} is out of order` });
      if (!scenes.has(shot.scene_position))
        ctx.addIssue({ code: "custom", message: `shot ${i} has no scene` });
      for (const key of shot.cast_keys) {
        const kind = kinds.get(key);
        if (kind !== "character" && kind !== "prop")
          ctx.addIssue({
            code: "custom",
            message: `shot ${i}: bad cast ${key}`,
          });
      }
      if (shot.location_key && kinds.get(shot.location_key) !== "location")
        ctx.addIssue({ code: "custom", message: `shot ${i}: bad location` });
    });
  });
export type MvPlan = z.infer<typeof MvPlanSchema>;

// The shot list's camera presets as storyboard framing.
export const CAMERA_FRAMING: Record<Camera, ShotFraming> = {
  "close-up": {
    size: "close-up",
    angle: "eye-level",
    movement: "static",
    lens: "85mm",
  },
  medium: {
    size: "medium",
    angle: "eye-level",
    movement: "static",
    lens: "50mm",
  },
  wide: { size: "wide", angle: "eye-level", movement: "static", lens: "24mm" },
  overhead: {
    size: "wide",
    angle: "overhead",
    movement: "static",
    lens: "24mm",
  },
  orbit: {
    size: "medium",
    angle: "eye-level",
    movement: "orbit",
    lens: "35mm",
  },
  dolly: {
    size: "medium",
    angle: "eye-level",
    movement: "dolly",
    lens: "35mm",
  },
};

export const SECTION_MOOD: Record<ShotSectionKind, string> = {
  intro: "expectant",
  verse: "intimate",
  prechorus: "building",
  chorus: "euphoric",
  bridge: "reflective",
  outro: "fading",
  other: "",
};

export type PlanOptions = {
  title: string;
  language: string;
  aspect?: (typeof MV_ASPECTS)[number];
  look?: Partial<MvLook>;
  // Elements by key (the shot list's set and costume ids). Missing keys get a plain element.
  elements?: MvPlan["elements"];
};

// The storyboard plan of rung 1's cut plan and shot list. Each shot's costume is its cast (a
// character element) and its set its location; a song section run is one scene.
export function planFromShotList(
  cutPlan: CutPlan,
  shotList: ShotList,
  options: PlanOptions,
): MvPlan {
  const cut = CutPlanSchema.parse(cutPlan);
  const list = ShotListSchema.parse(shotList);
  const given = new Map((options.elements ?? []).map((e) => [e.key, e]));
  const elements: MvPlan["elements"] = [...given.values()];
  const element = (key: string, kind: ElementKind) => {
    if (given.has(key) || elements.some((e) => e.key === key)) return;
    elements.push({
      key,
      kind,
      name:
        kind === "location"
          ? `the ${key.replace(/^set-/u, "")} set`
          : `the singer in ${key}`,
      description: "",
      ref_asset_ids: [],
    });
  };
  const scenes: MvPlan["scenes"] = [];
  const shots: MvPlan["shots"] = list.shots.map((shot) => {
    const last = scenes.at(-1);
    if (!last || last.section !== shot.section) {
      scenes.push({
        position: scenes.length,
        section: shot.section,
        section_kind: shot.sectionKind,
        start_frame: shot.startFrame,
        end_frame: shot.endFrame,
      });
    } else last.end_frame = shot.endFrame;
    element(shot.costume, "character");
    element(shot.set, "location");
    return {
      position: shot.index,
      scene_position: scenes.length - 1,
      segment: shot.segment,
      start_frame: shot.startFrame,
      end_frame: shot.endFrame,
      kind: shot.kind,
      ...CAMERA_FRAMING[shot.camera],
      burst: shot.burst,
      mood: SECTION_MOOD[shot.sectionKind],
      lyrics: shot.lyrics,
      energy: shot.energy,
      // B-roll keeps the singer in the picture, as in rung 2.
      cast_keys: [shot.costume],
      location_key: shot.set,
    };
  });
  return MvPlanSchema.parse({
    project: {
      title: options.title,
      language: options.language,
      genre: list.genre,
      aspect: options.aspect ?? "16:9",
      fps: cut.fps,
      frames: cut.frames,
      look: MvLookSchema.parse(options.look ?? {}),
      cut_plan: cut,
    },
    // Key order, as the database lists them.
    elements: elements.sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
    ),
    scenes,
    shots,
  });
}

// Old rung-1 folders hold cutplan.json and shotlist.json; this reads their contents.
export function planFromFiles(
  files: { cutplan: unknown; shotlist: unknown },
  options: PlanOptions,
): MvPlan {
  return planFromShotList(
    CutPlanSchema.parse(files.cutplan),
    ShotListSchema.parse(files.shotlist),
    options,
  );
}

// The take the storyboard uses for a shot: the chosen one, else the newest done final, else
// the newest done draft.
export function selectedTake(takes: MvTake[]): MvTake | null {
  const chosen = takes.find((t) => t.chosen);
  if (chosen) return chosen;
  const done = takes
    .filter((t) => t.status === "done")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return done.find((t) => t.phase === "final") ?? done[0] ?? null;
}

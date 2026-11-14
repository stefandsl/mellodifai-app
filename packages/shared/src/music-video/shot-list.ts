// The shot list: one typed shot per cut-plan segment, chosen by rules from the song's sections
// and energy (no model call). It says what a video model must make for the segment and how the
// previz frames it.
import { z } from "zod";
import type { CutPlan, Segment } from "./cut-plan.js";

export const SHOT_KINDS = [
  "lipsync-single",
  "burst",
  "instrumental-broll",
] as const;
export type ShotKind = (typeof SHOT_KINDS)[number];

export const CAMERAS = [
  "close-up",
  "medium",
  "wide",
  "overhead",
  "orbit",
  "dolly",
] as const;
export type Camera = (typeof CAMERAS)[number];

export const SECTION_KINDS = [
  "intro",
  "verse",
  "prechorus",
  "chorus",
  "bridge",
  "outro",
  "other",
] as const;
export type ShotSectionKind = (typeof SECTION_KINDS)[number];

// A burst asks the video model for this many cuts in one generation.
export const BURST_CUTS = 5;

export const ShotSchema = z
  .object({
    index: z.number().int().min(0),
    segment: z.number().int().min(0),
    start: z.number().min(0),
    end: z.number().positive(),
    startFrame: z.number().int().min(0),
    endFrame: z.number().int().positive(),
    section: z.string(),
    sectionKind: z.enum(SECTION_KINDS),
    kind: z.enum(SHOT_KINDS),
    camera: z.enum(CAMERAS),
    // The cameras of a burst's cuts in order (the first is `camera`); empty otherwise.
    burst: z.array(z.enum(CAMERAS)),
    set: z.string().min(1),
    costume: z.string().min(1),
    // 0..1, the segment's loudness rank within the song.
    energy: z.number().min(0).max(1),
    lyrics: z.string(),
    prompt: z.string().min(1),
  })
  .superRefine((shot, ctx) => {
    if (shot.end <= shot.start)
      ctx.addIssue({ code: "custom", message: "shot ends before it starts" });
    if (shot.kind === "burst" && shot.burst.length !== BURST_CUTS)
      ctx.addIssue({ code: "custom", message: "a burst has 5 cuts" });
    if (shot.kind !== "burst" && shot.burst.length !== 0)
      ctx.addIssue({ code: "custom", message: "only a burst has cuts" });
    if (shot.kind === "instrumental-broll" && shot.lyrics !== "")
      ctx.addIssue({ code: "custom", message: "b-roll has no lyrics" });
    if (shot.kind !== "instrumental-broll" && shot.lyrics === "")
      ctx.addIssue({ code: "custom", message: "a sung shot needs its lyrics" });
  });
export type Shot = z.infer<typeof ShotSchema>;

export const ShotListSchema = z
  .object({
    version: z.literal(1),
    genre: z.string().min(1),
    fps: z.number().int().positive(),
    frames: z.number().int().positive(),
    shots: z.array(ShotSchema).min(1),
  })
  .superRefine((list, ctx) => {
    list.shots.forEach((shot, i) => {
      const prev = list.shots[i - 1];
      if (shot.index !== i)
        ctx.addIssue({ code: "custom", message: `shot ${i} is out of order` });
      if (prev && prev.endFrame !== shot.startFrame)
        ctx.addIssue({ code: "custom", message: `shot ${i} leaves a gap` });
    });
    if (list.shots[0]?.startFrame !== 0)
      ctx.addIssue({ code: "custom", message: "the first shot starts late" });
    if (list.shots.at(-1)?.endFrame !== list.frames)
      ctx.addIssue({ code: "custom", message: "the last shot ends early" });
  });
export type ShotList = z.infer<typeof ShotListSchema>;

export function sectionKind(name: string): ShotSectionKind {
  const n = name.toLowerCase();
  if (/pre[- ]?chorus|pre[- ]?ritornell/u.test(n)) return "prechorus";
  if (/chorus|ritornell|refrain|hook|post[- ]?chorus|shout|gang/u.test(n))
    return "chorus";
  if (/bridge|ponte|breakdown/u.test(n)) return "bridge";
  if (/verse|strofa|rap/u.test(n)) return "verse";
  if (/intro/u.test(n)) return "intro";
  if (/outro|spoken|coda|ending/u.test(n)) return "outro";
  return "other";
}

const SETS: Record<ShotSectionKind, string> = {
  intro: "set-establishing",
  verse: "set-verse",
  prechorus: "set-verse",
  chorus: "set-chorus",
  bridge: "set-bridge",
  outro: "set-establishing",
  other: "set-establishing",
};

const COSTUMES: Record<ShotSectionKind, string> = {
  intro: "costume-a",
  verse: "costume-a",
  prechorus: "costume-a",
  chorus: "costume-b",
  bridge: "costume-c",
  outro: "costume-c",
  other: "costume-a",
};

const CAMERA_TEXT: Record<Camera, string> = {
  "close-up": "close-up on the singer's face",
  medium: "medium shot of the singer from the waist up",
  wide: "wide shot of the whole stage and band",
  overhead: "high overhead shot looking down on the stage",
  orbit: "the camera orbits around the singer",
  dolly: "slow dolly move toward the singer",
};

export type ShotListOptions = {
  genre: string;
  // Loudness envelope of the song, `fps` values per second (timing.json `energy`).
  energy?: { values: number[]; fps: number };
};

function meanEnergy(
  segment: Segment,
  energy: ShotListOptions["energy"],
): number {
  if (!energy?.values.length) return 0;
  const from = Math.max(0, Math.floor(segment.start * energy.fps));
  const to = Math.min(
    energy.values.length,
    Math.ceil(segment.end * energy.fps),
  );
  if (to <= from) return 0;
  let sum = 0;
  for (let i = from; i < to; i++) sum += energy.values[i] ?? 0;
  return sum / (to - from);
}

// Each segment's energy as its rank among the song's segments, so a quiet master still has loud
// and quiet parts.
function energyRanks(plan: CutPlan, energy: ShotListOptions["energy"]) {
  const means = plan.segments.map((s) => meanEnergy(s, energy));
  const sorted = [...means].sort((a, b) => a - b);
  const n = Math.max(1, sorted.length - 1);
  return means.map((m) =>
    energy?.values.length ? sorted.indexOf(m) / n : 0.5,
  );
}

function pick(order: readonly Camera[], turn: number, avoid?: Camera): Camera {
  for (let k = 0; k < order.length; k++) {
    const camera = order[(turn + k) % order.length] as Camera;
    if (camera !== avoid) return camera;
  }
  return order[0] as Camera;
}

export function shotPrompt(
  shot: Pick<Shot, "kind" | "camera" | "burst" | "lyrics" | "set" | "costume">,
  genre: string,
): string {
  const refs = `The performer wears ${shot.costume} in ${shot.set}.`;
  if (shot.kind === "instrumental-broll")
    return [
      `${genre} music video, instrumental passage.`,
      `${CAMERA_TEXT[shot.camera]}.`,
      "The band plays; nobody sings, mouths stay closed.",
      refs,
    ].join(" ");
  const lyrics = `The singer sings exactly these lyrics, in order, and nothing else: "${shot.lyrics.replace(/\n/gu, " / ")}"`;
  if (shot.kind === "burst")
    return [
      `${genre} music video performance.`,
      `${BURST_CUTS} shots with different cuts; first shot: ${CAMERA_TEXT[shot.camera]};`,
      `then ${shot.burst
        .slice(1)
        .map((c) => CAMERA_TEXT[c])
        .join("; ")}.`,
      refs,
      lyrics,
    ].join(" ");
  return [
    `${genre} music video performance.`,
    "A single continuous shot without cuts.",
    `${CAMERA_TEXT[shot.camera]}.`,
    refs,
    lyrics,
  ].join(" ");
}

export function planShots(plan: CutPlan, options: ShotListOptions): ShotList {
  const genre = options.genre.trim() || "pop";
  const ranks = energyRanks(plan, options.energy);
  const turns = { broll: 0, verse: 0, burst: 0 };
  const shots: Shot[] = [];
  for (const segment of plan.segments) {
    const kindOfSection = sectionKind(segment.section);
    const energy = Math.round((ranks[segment.index] ?? 0.5) * 1000) / 1000;
    const prev = shots.at(-1)?.camera;
    let kind: ShotKind;
    let camera: Camera;
    let burst: Camera[] = [];
    if (!segment.sung) {
      kind = "instrumental-broll";
      camera = pick(["wide", "dolly", "overhead"], turns.broll++, prev);
    } else if (
      (kindOfSection === "chorus" && energy >= 0.5) ||
      (kindOfSection === "bridge" && energy >= 0.75)
    ) {
      kind = "burst";
      camera = pick(["wide", "overhead", "orbit"], turns.burst++, prev);
      const rest: Camera[] = [
        "close-up",
        "orbit",
        "medium",
        "overhead",
        "dolly",
        "wide",
      ];
      burst = [camera, ...rest.filter((c) => c !== camera)].slice(
        0,
        BURST_CUTS,
      );
    } else {
      kind = "lipsync-single";
      const order: readonly Camera[] =
        kindOfSection === "bridge"
          ? ["orbit", "close-up"]
          : kindOfSection === "prechorus"
            ? ["dolly", "medium"]
            : kindOfSection === "intro" || kindOfSection === "outro"
              ? ["medium", "dolly", "close-up"]
              : ["close-up", "medium"];
      camera = pick(order, turns.verse++, prev);
    }
    const set = SETS[kindOfSection];
    const costume = COSTUMES[kindOfSection];
    const lyrics = segment.text;
    shots.push({
      index: shots.length,
      segment: segment.index,
      start: segment.start,
      end: segment.end,
      startFrame: segment.startFrame,
      endFrame: segment.endFrame,
      section: segment.section,
      sectionKind: kindOfSection,
      kind,
      camera,
      burst,
      set,
      costume,
      energy,
      lyrics,
      prompt: shotPrompt({ kind, camera, burst, lyrics, set, costume }, genre),
    });
  }
  return ShotListSchema.parse({
    version: 1,
    genre,
    fps: plan.fps,
    frames: plan.frames,
    shots,
  });
}

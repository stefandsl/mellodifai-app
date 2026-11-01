import { z } from "zod";

// Models offered by the studio model selector, as kie names them.
export const SONG_MODELS = [
  "V6",
  "V6_WILD",
  "V6_MINI",
  "V5",
  "V4_5PLUS",
  "V4_5",
] as const;
export type SongModel = (typeof SONG_MODELS)[number];

// kie is the paid Suno service; the others run on the worker PC through ComfyUI (admin only).
export const SONG_ENGINES = ["kie", "ace-step", "yue2"] as const;
export type SongEngine = (typeof SONG_ENGINES)[number];
export type LocalSongEngine = Exclude<SongEngine, "kie">;

// Musical controls of the create form. Absent means Auto: the engine decides.
export const BPM_RANGE = { min: 40, max: 240 } as const;
export const KEY_ROOTS = [
  "C",
  "C#",
  "Db",
  "D",
  "D#",
  "Eb",
  "E",
  "F",
  "F#",
  "Gb",
  "G",
  "G#",
  "Ab",
  "A",
  "A#",
  "Bb",
  "B",
] as const;
// The exact keys the ACE-Step text encoder accepts ("C major", "Eb minor", ...).
export const SONG_KEYS = (["major", "minor"] as const).flatMap((quality) =>
  KEY_ROOTS.map((root) => `${root} ${quality}` as const),
);
// The numerator the ACE-Step text encoder takes: 2/4, 3/4, 4/4 and 6/8.
export const TIME_SIGNATURES = ["2", "3", "4", "6"] as const;
export type TimeSignature = (typeof TIME_SIGNATURES)[number];
export const TIME_SIGNATURE_LABELS: Record<TimeSignature, string> = {
  "2": "2/4",
  "3": "3/4",
  "4": "4/4",
  "6": "6/8",
};
// Local engines only. A fixed seed is used by take 1 and take 2 adds one, so a stored seed stays
// below 2^48 - 1 (the take column is a bigint and JavaScript is exact up to 2^53). The form
// stops at SEED_MAX, which leaves room for the extra songs of one click (two seeds each).
export const MAX_SONGS_PER_CLICK = 4;
export const SEED_LIMIT = 2 ** 48 - 2;
export const SEED_MAX = SEED_LIMIT - 2 * MAX_SONGS_PER_CLICK;
// ACE-Step "Esperto": sampler steps and guidance (the sampler's cfg).
export const ACE_STEPS = { min: 10, max: 100, default: 30 } as const;
export const ACE_GUIDANCE = {
  min: 1,
  max: 15,
  step: 0.5,
  default: 7,
} as const;

// What the studio create form stores on a project for the worker.
// duration null means Auto (no target length sent to kie).
export const SongSettingsSchema = z.object({
  model: z.enum(SONG_MODELS).default("V6"),
  title: z.string().trim().max(80).optional(),
  exclude: z.string().trim().max(1000).optional(),
  weirdness: z.number().min(0).max(1).optional(),
  styleWeight: z.number().min(0).max(1).optional(),
  variety: z.number().int().min(0).max(4).optional(),
  duration: z.number().int().min(10).max(360).nullable().optional(),
  // "off" makes Keep audio only the suggested choice when picking the take.
  video: z.enum(["lyric", "off"]).optional(),
  engine: z.enum(SONG_ENGINES).default("kie"),
  bpm: z.number().int().min(BPM_RANGE.min).max(BPM_RANGE.max).optional(),
  keyscale: z.enum(SONG_KEYS as [string, ...string[]]).optional(),
  timeSignature: z.enum(TIME_SIGNATURES).optional(),
  seed: z.number().int().min(0).max(SEED_LIMIT).optional(),
  steps: z.number().int().min(ACE_STEPS.min).max(ACE_STEPS.max).optional(),
  guidance: z
    .number()
    .min(ACE_GUIDANCE.min)
    .max(ACE_GUIDANCE.max)
    .multipleOf(ACE_GUIDANCE.step)
    .optional(),
});
export type SongSettings = z.infer<typeof SongSettingsSchema>;

export type MusicChoice = Pick<
  SongSettings,
  "bpm" | "keyscale" | "timeSignature"
>;

// The chosen tempo, key and time signature as style tags, in the words both the style
// prompts of kie and YuE2 and the worker's own reader (bpmAndKey) understand.
export function musicTags(music: MusicChoice): string[] {
  return [
    ...(music.bpm ? [`${music.bpm} BPM`] : []),
    ...(music.keyscale ? [music.keyscale] : []),
    ...(music.timeSignature
      ? [`${TIME_SIGNATURE_LABELS[music.timeSignature]} time`]
      : []),
  ];
}

const TEMPO_TAG = /^\d{2,3}\s*bpm$/iu;
const KEY_TAG = /^[A-G][#b]?\s+(?:major|minor)$/iu;
const SIGNATURE_TAG = /^\d\/\d(?:\s*time(?:\s*signature)?)?$/iu;

function dropPatterns(music: MusicChoice): RegExp[] {
  return [
    ...(music.bpm ? [TEMPO_TAG] : []),
    ...(music.keyscale ? [KEY_TAG] : []),
    ...(music.timeSignature ? [SIGNATURE_TAG] : []),
  ];
}

// The style without a tempo, key or signature it already names, for the fields the user chose.
// With nothing chosen the very same string comes back.
export function styleWithout(style: string, music: MusicChoice): string {
  const drop = dropPatterns(music);
  if (drop.length === 0) return style;
  return style
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && !drop.some((pattern) => pattern.test(part)))
    .join(", ");
}

// The style with the chosen tags added. A tempo, key or signature the drafted style already
// names is replaced, but only for the fields the user chose. When the tags would push the
// style past the limit they are left out, never the user's words.
export function withMusicTags(
  style: string,
  music: MusicChoice,
  limit = 1000,
): string {
  const tags = musicTags(music);
  if (tags.length === 0) return style;
  const result = [styleWithout(style, music), ...tags]
    .filter(Boolean)
    .join(", ");
  return result.length <= limit ? result : style;
}

export type SongControls = Pick<
  SongSettings,
  "bpm" | "keyscale" | "timeSignature" | "seed" | "steps" | "guidance"
>;

// The musical controls, seed and ACE-Step extras stored on a project, each read on its own: a
// value that is out of range (a project written by hand) is ignored, never an error, because
// the engine's own Auto is always a safe answer.
export function readControls(raw: unknown): SongControls {
  const source =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const result: SongControls = {};
  for (const key of [
    "bpm",
    "keyscale",
    "timeSignature",
    "seed",
    "steps",
    "guidance",
  ] as const) {
    const parsed = SongSettingsSchema.shape[key].safeParse(source[key]);
    if (parsed.success && parsed.data !== undefined)
      Object.assign(result, { [key]: parsed.data });
  }
  return result;
}

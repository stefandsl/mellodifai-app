import { z } from "zod";

// Songs made from other audio (T12): where the audio came from and under which licence, for the
// "Fonti" lines and the remix credits (T17 reads the same record for YouTube descriptions).

export const SOURCE_KINDS = [
  // Imported from the owner's suno.com account (a downloaded file or a share link).
  "suno",
  // Any other uploaded recording.
  "upload",
  // Made from another song: a cover keeps its melody, a reference only takes inspiration from
  // it, an extension continues it.
  "cover",
  "reference",
  "extend",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_LICENCES = [
  "own",
  "cc-by",
  "cc-by-sa",
  "cc-by-nc",
  "cc-by-nc-sa",
  "cc-by-nd",
  "cc-by-nc-nd",
  "cc0",
  "public-domain",
  "licensed",
  "unknown",
] as const;
export type SourceLicence = (typeof SOURCE_LICENCES)[number];

// How each licence is written in a credit line; "own" and "unknown" add nothing.
export const LICENCE_SHORT: Record<SourceLicence, string | null> = {
  own: null,
  "cc-by": "CC BY 4.0",
  "cc-by-sa": "CC BY-SA 4.0",
  "cc-by-nc": "CC BY-NC 4.0",
  "cc-by-nc-sa": "CC BY-NC-SA 4.0",
  "cc-by-nd": "CC BY-ND 4.0",
  "cc-by-nc-nd": "CC BY-NC-ND 4.0",
  cc0: "CC0 1.0",
  "public-domain": null,
  licensed: null,
  unknown: null,
};

// No derivatives allowed: a cover, extension or rewrite of it needs the author's permission.
export function licenceForbidsDerivatives(licence: SourceLicence): boolean {
  return licence === "cc-by-nd" || licence === "cc-by-nc-nd";
}
export function licenceNonCommercial(licence: SourceLicence): boolean {
  return licence.includes("-nc");
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);

export const SongSourceSchema = z.object({
  kind: z.enum(SOURCE_KINDS),
  title: optionalText(200),
  author: optionalText(200),
  url: z
    .union([z.literal(""), z.url({ protocol: /^https?$/u }).max(500)])
    .optional()
    .transform((value) => value || undefined),
  licence: z.enum(SOURCE_LICENCES).default("unknown"),
  // The library song the audio came from (cover, reference, extension of one of the owner's).
  versionId: z.uuid().optional(),
  // The uploaded file, in the uploads bucket (<owner>/audio/<uuid>.<ext>).
  upload: optionalText(300),
});
export type SongSource = {
  kind: SourceKind;
  title?: string | undefined;
  author?: string | undefined;
  url?: string | undefined;
  licence: SourceLicence;
  versionId?: string | undefined;
  upload?: string | undefined;
};

export function parseSongSource(raw: unknown): SongSource | null {
  const parsed = SongSourceSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// The audio a new song starts from, stored in song_settings.source by the create form.
export const SOURCE_MODES = ["cover", "reference", "extend"] as const;
export type SourceMode = (typeof SOURCE_MODES)[number];
export const AUDIO_TYPES = {
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/flac": "flac",
} as const;
export type AudioType = keyof typeof AUDIO_TYPES;
// What the local Supabase accepts today (its global limit; the bucket allows more).
export const AUDIO_UPLOAD_LIMIT = 50 * 1024 * 1024;
// kie refuses source audio longer than 8 minutes (upload-and-cover / upload-and-extend).
export const KIE_SOURCE_MAX_SECONDS = 480;

export const AudioSourceSchema = z
  .object({
    mode: z.enum(SOURCE_MODES),
    // Exactly one of: an uploaded file, or a take of one of the owner's songs.
    upload: z
      .string()
      .regex(/^[0-9a-f-]{36}\/audio\/[0-9a-f-]{36}\.(mp3|wav|flac)$/u)
      .optional(),
    takeId: z.uuid().optional(),
    versionId: z.uuid().optional(),
    // Where an extension starts, seconds into the source; absent = at its end.
    continueAt: z.number().min(0).max(KIE_SOURCE_MAX_SECONDS).optional(),
    // Optional kie audio_weight override for cover/reference; absent = KIE_AUDIO_WEIGHT[mode].
    audioWeight: z.number().min(0).max(1).optional(),
    // Shown in "Fonti": the source song's title or the file name.
    title: z.string().trim().max(200).optional(),
    duration: z.number().positive().max(3600).optional(),
  })
  .refine((value) => Boolean(value.upload) !== Boolean(value.takeId), {
    message: "an upload or a take, not both",
  });
export type AudioSource = z.infer<typeof AudioSourceSchema>;

// Which engine can start from audio, and how (the worker implements exactly these): kie's
// upload-and-cover-audio (cover, and reference with a low audio weight) and
// upload-and-extend-audio. ACE-Step is offered none: with the installed ComfyUI nodes
// ReferenceTimbreAudio sang no words, and audio-to-audio kept the words on a one-minute excerpt
// but came out as saturated noise on whole songs (281 s, four settings, T12 tests in
// E:/mellodifai/research/t12/ace-cover). YuE2 takes no audio.
export function sourceModesFor(engine: string): readonly SourceMode[] {
  if (engine === "kie") return SOURCE_MODES;
  return [];
}

// kie's audio_weight for each mode: a cover follows the source closely, a reference loosely.
export const KIE_AUDIO_WEIGHT: Record<"cover" | "reference", number> = {
  cover: 0.75,
  reference: 0.3,
};

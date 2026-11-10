import {
  LANGS,
  REMAKE_COUNTRIES,
  SongSettingsSchema,
  VisualizerParamsSchema,
  youtubeVideoId,
} from "@mellodifai/shared";
import { z } from "zod";

// The link of a remake as the database takes it: a bare video id becomes the watch URL and a
// link without a scheme gets https. Null when the text names no YouTube video.
export function remakeLink(
  input: string,
): { url: string; videoId: string } | null {
  const text = input.trim();
  const videoId = youtubeVideoId(text);
  if (!videoId) return null;
  if (/^[\w-]{11}$/u.test(text))
    return { url: `https://www.youtube.com/watch?v=${videoId}`, videoId };
  return {
    url: /^https?:\/\//iu.test(text) ? text : `https://${text}`,
    videoId,
  };
}

// One rewritten line as the review saves it: one line, and never the em dash (owner rule).
export const RemakeLineText = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (text) =>
      !/[\r\n]/u.test(text) && !text.includes(String.fromCodePoint(0x2014)),
  );

// Token inputs of the remake (design 7.3b): snake_case, the remake named by the path.
const RemakeRef = z.object({ remake_id: z.string().uuid() });
const RemakeRevision = z.number().int().nonnegative();
export const RemakesListInput = z.object({
  limit: z.number().int().min(1).max(100).default(20),
});
export const RemakeGetInput = RemakeRef;
export const RemakeStartInput = z.object({
  url: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((url) => remakeLink(url) !== null, {
      message: "A YouTube link or video id is needed",
    }),
  lang: z.enum(LANGS),
  country: z.enum(REMAKE_COUNTRIES).nullable().default(null),
});
export const RemakeEditInput = RemakeRef.extend({
  revision: RemakeRevision,
  lines: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        text: RemakeLineText,
      }),
    )
    .max(200),
  title: z.string().trim().min(1).max(100).nullable().default(null),
});
export const RemakeRegenerateSectionInput = RemakeRef.extend({
  section_id: z.string().min(1).max(40),
  revision: RemakeRevision,
});
export const RemakeAcceptInput = RemakeRef.extend({
  revision: RemakeRevision,
  // Exactly the lyrics_text remake_get returned: the database refuses any other text.
  lyrics_text: z.string().min(1).max(20000),
  // The studio's title limit (create panel and song settings).
  title: z.string().trim().min(1).max(80),
  style: z.string().trim().min(1).max(1000),
  vocal_gender: z.enum(["m", "f"]).nullable().default(null),
  settings: SongSettingsSchema.prefault({}),
});

export const RequestVisualizerInput = z.object({
  versionId: z.string().uuid(),
  params: VisualizerParamsSchema,
});

export const KeepAudioVisualizerInput = RequestVisualizerInput.extend({
  takeId: z.string().uuid(),
});

export const ResolveKieInput = z.object({
  versionId: z.string().uuid(),
  charged: z.boolean(),
  taskId: z.string().trim().max(200).optional(),
  editId: z.string().uuid().optional(),
});

export const ResolveUploadInput = z
  .object({
    publicationId: z.string().uuid(),
    uploaded: z.boolean(),
    videoId: z
      .string()
      .trim()
      .regex(/^[\w-]+$/u)
      .max(200)
      .optional(),
  })
  .refine((v) => !v.uploaded || Boolean(v.videoId));

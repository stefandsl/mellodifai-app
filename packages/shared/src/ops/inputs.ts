import { z } from "zod";
import { LyricPackSchema } from "../lyric-pack.js";
import { PROMPT_MAX_LENGTH } from "../prompt-limits.js";
import { MAX_SONGS_PER_CLICK, SongSettingsSchema } from "../song-settings.js";
import { LANGS } from "../stages.js";
import { VisualizerParamsSchema } from "../visualizer/viz-params.js";

const Id = z.string().uuid();
export const CookieCreateSongInput = z
  .object({
    mode: z.enum(["simple", "advanced"]),
    prompt: z.string().trim().max(PROMPT_MAX_LENGTH),
    lyrics: z.string().trim().max(5000),
    styles: z.string().trim().max(1000),
    languages: z.array(z.enum(LANGS)).min(1),
    vocalGender: z.enum(["m", "f"]).nullable(),
    settings: SongSettingsSchema,
    // Songs made by one click: each is its own project (and one song per language).
    count: z.number().int().min(1).max(MAX_SONGS_PER_CLICK).default(1),
  })
  .refine(
    (v) =>
      v.mode === "simple"
        ? v.prompt.length > 0
        : Boolean(
            v.prompt ||
              v.lyrics ||
              v.styles ||
              v.settings.title ||
              v.settings.source,
          ),
    { message: "Describe the song or add lyrics, styles or a title" },
  );

// The cookie UI keeps upload sources; token transports never accept them.
export const CreateSongInput = CookieCreateSongInput.refine(
  (value) => !value.settings.source?.upload,
  { message: "Upload sources are not supported", path: ["settings", "source"] },
);
export const SongsListInput = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
  include_trashed: z.boolean().default(false),
});
export const SongGetInput = z.object({ version_id: Id });
export const JobStatusInput = z.object({
  job_id: Id,
  events_after: z.number().int().nonnegative().optional(),
});
export const CostsGetInput = z
  .object({ from: z.iso.date().optional(), to: z.iso.date().optional() })
  .refine(
    (value) =>
      !value.from ||
      !value.to ||
      (Date.parse(value.to) >= Date.parse(value.from) &&
        Date.parse(value.to) - Date.parse(value.from) <= 30 * 86400000),
    { message: "Invalid date range" },
  );
export const LyricsApproveInput = SongGetInput.extend({
  lyric_pack: LyricPackSchema,
});
export const LyricsBackInput = SongGetInput;
export const SongGenerateAgainInput = SongGetInput.extend({
  generation: z.number().int().positive(),
});
export const TakePickInput = SongGetInput.extend({ take_id: Id });
export const VideoMakeInput = SongGetInput;
export const VideoRerenderInput = SongGetInput;
export const VideoApproveInput = SongGetInput;
export const StageRetryInput = z.object({ job_id: Id });
export const JobCancelInput = StageRetryInput;
export const StemsRequestInput = SongGetInput;
export const VisualizerInput = SongGetInput.extend({
  params: VisualizerParamsSchema,
});
export const IdempotencyKey = z.string().min(8).max(100);

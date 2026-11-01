import {
  LANGS,
  LyricPackSchema,
  MAX_SONGS_PER_CLICK,
  SongSettingsSchema,
} from "@mellodifai/shared";
import { z } from "zod";

const Id = z.string().uuid();

export const CreateProjectInput = z.object({
  topic: z.string().trim().min(1).max(250),
  brief: z.string().trim().max(5000).optional().default(""),
  languages: z.array(z.enum(LANGS)).min(1),
  style: z.string().trim().min(1).max(1000),
  mood: z.string().trim().max(250).optional().default(""),
  vocalGender: z.enum(["m", "f"]),
});

export const CreateSongInput = z
  .object({
    mode: z.enum(["simple", "advanced"]),
    prompt: z.string().trim().max(500),
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
        : Boolean(v.prompt || v.lyrics || v.styles || v.settings.title),
    { message: "Describe the song or add lyrics, styles or a title" },
  );

export const FormatStyleInput = z.object({
  styles: z.string().trim().min(1).max(1000),
});

export const UpdateLyricsInput = z.object({
  versionId: Id,
  pack: LyricPackSchema,
});
export const VersionIdInput = z.object({ versionId: Id });
export const ReactionInput = z.object({
  versionId: Id,
  reaction: z.enum(["like", "dislike", "none"]),
});
export const RenameInput = z.object({
  versionId: Id,
  title: z.string().trim().min(1).max(100),
});
export const VersionIdsInput = z.object({
  versionIds: z.array(Id).min(1).max(500),
});
export const GenerateAgainInput = z.object({
  versionId: Id,
  generation: z.number().int().positive(),
});
export const RetryInput = z.object({ versionId: Id, jobId: Id });
export const PickTakeInput = z.object({ versionId: Id, takeId: Id });
export const VideoApprovalInput = z.object({
  versionId: Id,
  overrideReason: z.string().trim().max(1000).optional(),
});
export const RerenderInput = z.object({
  versionId: Id,
  overrideReason: z.string().trim().min(3).max(1000),
});
export const PublicationInput = z.object({
  renderId: Id,
  metadata: z.object({
    title: z.string().min(1).max(100),
    description: z.string().max(5000),
    tags: z.string().max(1000),
    chapters: z.string().max(5000),
  }),
});
export const SetPrivacyInput = z
  .object({
    publicationId: Id,
    privacy: z.enum(["public", "unlisted", "scheduled", "private"]),
    publishAt: z.iso.datetime().optional(),
  })
  .refine(
    (value) =>
      value.privacy !== "scheduled" ||
      Boolean(value.publishAt && Date.parse(value.publishAt) > Date.now()),
    {
      message: "Scheduled publication requires a future publishAt",
      path: ["publishAt"],
    },
  );

export const PlaylistNameInput = z.object({
  name: z.string().trim().min(1).max(100),
});
export const PlaylistIdInput = z.object({ playlistId: Id });
export const PlaylistRenameInput = z.object({
  playlistId: Id,
  name: z.string().trim().min(1).max(100),
});
export const PlaylistSongsInput = z.object({
  playlistId: Id,
  versionIds: z.array(Id).min(1).max(500),
});
export const PlaylistReorderInput = z.object({
  playlistId: Id,
  versionIds: z.array(Id).min(1).max(1000),
});
export const MembershipInput = z.object({
  versionIds: z.array(Id).min(1).max(500),
});
// The audio editor's upload, as save_edited_take checks it again: edits/<owner>/<song>/<uuid>.mp3.
export const SaveEditInput = z.object({
  versionId: Id,
  path: z
    .string()
    .regex(
      /^edits\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.mp3$/u,
      "invalid edit path",
    ),
});

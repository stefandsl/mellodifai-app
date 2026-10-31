import { LANGS, LyricPackSchema } from "@mellodifai/shared";
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

export const UpdateLyricsInput = z.object({
  versionId: Id,
  pack: LyricPackSchema,
});
export const VersionIdInput = z.object({ versionId: Id });
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
    privacy: z.enum(["public", "unlisted", "scheduled"]),
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

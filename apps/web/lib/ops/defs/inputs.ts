import { VisualizerParamsSchema } from "@mellodifai/shared";
import { z } from "zod";

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

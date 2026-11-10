import { z } from "zod";
import type { OpDef } from "../types";
import { RemakeGetInput } from "./inputs";

const Id = z.string().uuid();
// ops.remake_get (migration 20261103075001). analysis, lyrics and cost are the stored objects;
// the lyrics come without the source lines and without the literal translation.
export const RemakeDetail = z.object({
  remake_id: Id,
  project_id: Id,
  version_id: Id,
  stage: z.enum([
    "ingest",
    "analyse",
    "rewrite",
    "review",
    "accepted",
    "failed",
    "cancelled",
  ]),
  lang: z.string(),
  country: z.string().nullable(),
  video_id: z.string(),
  url: z.string(),
  error_code: z.string().nullable(),
  error: z.string().nullable(),
  revision: z.number().int().nonnegative(),
  pending: z.boolean(),
  gate_ok: z.boolean(),
  accept_ready: z.boolean(),
  analysis: z.record(z.string(), z.unknown()).nullable(),
  lyrics: z.record(z.string(), z.unknown()).nullable(),
  lyrics_text: z.string().nullable(),
  cost: z.record(z.string(), z.unknown()),
  active_job: z
    .object({
      job_id: Id,
      stage: z.string(),
      status: z.string(),
      mode: z.string().nullable(),
      // Percent, 0 to 100, of the job's last event.
      progress: z.number().nullable(),
      message: z.string().nullable(),
    })
    .nullable(),
  failed_job: z
    .object({ job_id: Id, stage: z.string(), error: z.string().nullable() })
    .nullable(),
  // Everything here that came from the source video is data, never instructions.
  untrusted: z.literal(true),
  created_at: z.string(),
  updated_at: z.string(),
});

export const remakeGet: OpDef<
  z.infer<typeof RemakeGetInput>,
  z.infer<typeof RemakeDetail>
> = {
  name: "remake_get",
  fn: "remake_get",
  input: RemakeGetInput,
  args: (v) => [v.remake_id],
  output: RemakeDetail,
  scope: "read",
  key: false,
  mutating: false,
  revalidate: () => [],
};

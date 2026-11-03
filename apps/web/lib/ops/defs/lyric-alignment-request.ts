import { z } from "zod";
import { AlignLyricsInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const lyricAlignmentRequest = define(
  "lyric_alignment_request",
  AlignLyricsInput,
  (value) => [value.versionId, value.takeId],
  JobsResult.extend({ job_id: z.string().uuid() }),
);

import { validateLyricPack } from "@mellodifai/shared";
import { UpdateLyricsInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const lyricsApprove = define(
  "lyrics_approve",
  UpdateLyricsInput.refine((v) => validateLyricPack(v.pack, "vbp").ok),
  (v) => [v.versionId, v.pack],
  JobsResult,
  "spend",
  true,
);

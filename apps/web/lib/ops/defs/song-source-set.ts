import { SongSourceInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const songSourceSet = define(
  "song_source_set",
  SongSourceInput,
  (v) => [v.versionId, v.source],
  JobsResult,
  "create",
  false,
);

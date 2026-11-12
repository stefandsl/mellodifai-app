import { VersionIdInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const playCount = define(
  "play_count",
  VersionIdInput,
  (v) => [v.versionId],
  JobsResult,
  "create",
  false,
);

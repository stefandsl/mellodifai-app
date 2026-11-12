import { VersionIdInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const videoMake = define(
  "video_make",
  VersionIdInput,
  (v) => [v.versionId],
  JobsResult,
  "create",
  true,
);

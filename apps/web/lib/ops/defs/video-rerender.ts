import { VersionIdInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const videoRerender = define(
  "video_rerender",
  VersionIdInput,
  (v) => [v.versionId],
  JobsResult,
  "create",
  true,
);

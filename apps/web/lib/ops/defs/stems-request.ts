import { VersionIdInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const stemsRequest = define(
  "stems_request",
  VersionIdInput,
  (v) => [v.versionId],
  JobsResult,
  "create",
  false,
);

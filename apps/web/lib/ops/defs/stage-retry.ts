import { RetryInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const stageRetry = define(
  "stage_retry",
  RetryInput,
  (v) => [v.jobId],
  JobsResult,
  "create",
  true,
);

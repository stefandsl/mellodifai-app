import { JobCancelInput, JobStatus } from "@mellodifai/shared";
import { z } from "zod";
import { define } from "./base";
export const jobCancel = define(
  "job_cancel",
  JobCancelInput,
  (v) => [v.job_id],
  z.object({ job: JobStatus }),
);

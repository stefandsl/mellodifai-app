import { JobEvent, JobStatus, JobStatusInput } from "@mellodifai/shared";
import { z } from "zod";
import type { OpDef } from "../types";

const output = z.object({ job: JobStatus, events: z.array(JobEvent) });
export const jobStatus: OpDef<
  z.infer<typeof JobStatusInput>,
  z.infer<typeof output>
> = {
  name: "job_status",
  fn: "job_status",
  input: JobStatusInput,
  args: (v) => [v.job_id, v.events_after ?? null],
  output,
  scope: "read",
  key: false,
  mutating: false,
  revalidate: () => [],
};

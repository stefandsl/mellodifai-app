import { z } from "zod";
import { VersionIdInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const stemsRequest = define(
  "stems_request",
  VersionIdInput,
  (v) => [v.versionId],
  JobsResult.extend({ job_id: z.string().uuid() }),
  "create",
  false,
);

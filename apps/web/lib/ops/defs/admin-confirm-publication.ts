import { z } from "zod";
import { SetPrivacyInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const adminConfirmPublication = define(
  "admin_confirm_publication",
  SetPrivacyInput,
  (v) => [v.publicationId, v.privacy, v.publishAt ?? null],
  JobsResult.extend({ job_id: z.string().uuid() }),
  "admin",
  false,
);

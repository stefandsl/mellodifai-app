import { define, JobsResult } from "./base";
import { ResolveKieInput } from "./inputs";

export const adminResolveKieSubmission = define(
  "admin_resolve_kie_submission",
  ResolveKieInput,
  (v) => [v.versionId, v.charged, v.taskId ?? null, v.editId ?? null],
  JobsResult,
  "admin",
  false,
);

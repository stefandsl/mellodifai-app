import { define, JobsResult } from "./base";
import { ResolveUploadInput } from "./inputs";

export const adminResolveUpload = define(
  "admin_resolve_upload",
  ResolveUploadInput,
  (v) => [v.publicationId, v.uploaded, v.videoId ?? null],
  JobsResult,
  "admin",
  false,
);

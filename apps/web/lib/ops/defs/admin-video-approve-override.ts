import { VideoApprovalInput } from "@/app/actions/schemas";
import { define, VideoApprovalResult } from "./base";

export const adminVideoApproveOverride = define(
  "admin_video_approve_override",
  VideoApprovalInput,
  (v) => [v.versionId, v.overrideReason],
  VideoApprovalResult,
  "admin",
  false,
);

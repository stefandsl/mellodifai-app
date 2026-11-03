import { VideoApprovalInput } from "@/app/actions/schemas";
import { define, VideoApprovalResult } from "./base";

export const videoApprove = define(
  "video_approve",
  VideoApprovalInput,
  (v) => [v.versionId],
  VideoApprovalResult,
  "create",
  false,
);

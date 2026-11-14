import { tokenRoute } from "@/lib/ops/http";
import { tokenOps } from "@/lib/ops/registry";

export const runtime = "nodejs";
export const POST = tokenRoute(tokenOps.music_video_plan_request);

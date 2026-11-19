import { tokenRoute } from "@/lib/ops/http";
import { tokenOps } from "@/lib/ops/registry";

export const runtime = "nodejs";
export const POST = tokenRoute(tokenOps.publish_request_approval);

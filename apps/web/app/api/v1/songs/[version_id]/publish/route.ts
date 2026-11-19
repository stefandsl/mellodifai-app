import { tokenRoute } from "@/lib/ops/http";
import { tokenOps } from "@/lib/ops/registry";

export const runtime = "nodejs";
export const GET = tokenRoute(tokenOps.publish_status);

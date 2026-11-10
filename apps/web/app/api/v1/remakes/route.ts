import { tokenRoute } from "@/lib/ops/http";
import { tokenOps } from "@/lib/ops/registry";

export const runtime = "nodejs";
export const GET = tokenRoute(tokenOps.remakes_list);
export const POST = tokenRoute(tokenOps.remake_start);

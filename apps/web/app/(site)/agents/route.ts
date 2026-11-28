import type { NextRequest } from "next/server";
import { parseAgentParam } from "@/lib/site/nav";
import {
  getRequestLocale,
  serveStaticAsset,
} from "@/lib/site/serve-static-site";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const lang = getRequestLocale(request);
  const agent = parseAgentParam(request.nextUrl.searchParams.get("agent"));
  return serveStaticAsset(
    request,
    `agents-${agent}-${lang}.html`,
    "text/html; charset=utf-8",
    {
      cacheControl: "private, no-cache",
      varyCookie: true,
      required: true,
    },
  );
}

import type { NextRequest } from "next/server";
import { serveStaticAsset } from "@/lib/site/serve-static-site";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  return serveStaticAsset(request, "fonts.css", "text/css; charset=utf-8", {
    cacheControl: "public, max-age=3600",
  });
}

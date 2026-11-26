import type { NextRequest } from "next/server";
import {
  getRequestLocale,
  serveStaticAsset,
} from "@/lib/site/serve-static-site";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const lang = getRequestLocale(request);
  return serveStaticAsset(
    request,
    `home-${lang}.html`,
    "text/html; charset=utf-8",
    { cacheControl: "private, no-cache", varyCookie: true, required: true },
  );
}

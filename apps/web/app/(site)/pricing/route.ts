import type { NextRequest } from "next/server";
import {
  getRequestLocale,
  serveStaticAsset,
} from "@/lib/site/serve-static-site";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const lang = getRequestLocale(request);
  return serveStaticAsset(
    request,
    `pricing-${lang}.html`,
    "text/html; charset=utf-8",
    { cacheControl: "public, max-age=0, must-revalidate", varyCookie: true },
  );
}

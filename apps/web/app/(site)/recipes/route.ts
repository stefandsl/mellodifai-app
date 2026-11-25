import type { NextRequest } from "next/server";
import {
  getRequestLocale,
  serveStaticAsset,
} from "@/lib/site/serve-static-site";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const lang = getRequestLocale(request);
  const view =
    request.nextUrl.searchParams.get("view") === "grid" ? "grid" : "canvas";
  const allowFixture =
    process.env.WORKER_FAKE === "1" &&
    request.nextUrl.searchParams.get("fixture") === "24";
  const suffix = allowFixture ? "-24" : "";
  return serveStaticAsset(
    request,
    `recipes-${view}${suffix}-${lang}.html`,
    "text/html; charset=utf-8",
    { cacheControl: "public, max-age=0, must-revalidate", varyCookie: true },
  );
}

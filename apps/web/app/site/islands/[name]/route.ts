import { type NextRequest, NextResponse } from "next/server";
import { serveStaticAsset } from "@/lib/site/serve-static-site";

export const runtime = "nodejs";

const ISLAND_PATTERN =
  /^(home|pricing|recipes|recipe-detail|changelog|agents)\.[0-9a-f]{12}\.js$/u;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ name: string }> },
) {
  const { name } = await context.params;
  if (!ISLAND_PATTERN.test(name)) {
    return new NextResponse("Not Found", { status: 404 });
  }
  return serveStaticAsset(
    request,
    `islands/${name}`,
    "text/javascript; charset=utf-8",
    { cacheControl: "public, max-age=31536000, immutable", required: false },
  );
}

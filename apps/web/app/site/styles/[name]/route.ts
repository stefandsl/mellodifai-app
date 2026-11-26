import { type NextRequest, NextResponse } from "next/server";
import { serveStaticAsset } from "@/lib/site/serve-static-site";

export const runtime = "nodejs";

const FONTS_PATTERN = /^fonts\.[0-9a-f]{12}\.css$/u;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ name: string }> },
) {
  const { name } = await context.params;
  if (!FONTS_PATTERN.test(name)) {
    return new NextResponse("Not Found", { status: 404 });
  }
  return serveStaticAsset(request, name, "text/css; charset=utf-8", {
    cacheControl: "public, max-age=31536000, immutable",
    required: false,
  });
}

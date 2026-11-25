import { type NextRequest, NextResponse } from "next/server";
import { serveStaticAsset } from "@/lib/site/serve-static-site";

export const runtime = "nodejs";

const ALLOWED = new Set(["shell.js", "home.js", "pricing.js", "recipes.js"]);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ name: string }> },
) {
  const { name } = await context.params;
  if (!ALLOWED.has(name)) {
    return new NextResponse("Not Found", { status: 404 });
  }
  return serveStaticAsset(
    request,
    `islands/${name}`,
    "text/javascript; charset=utf-8",
    { cacheControl: "public, max-age=3600" },
  );
}

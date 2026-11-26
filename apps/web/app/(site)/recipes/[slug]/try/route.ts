import type { NextRequest } from "next/server";
import { serveStaticRecipeTry } from "@/lib/site/serve-static-site";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  return serveStaticRecipeTry(request, slug);
}

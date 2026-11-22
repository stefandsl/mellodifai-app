import { type NextRequest, NextResponse } from "next/server";
import { getRecipeBySlug } from "@/lib/site/recipes";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const recipe = getRecipeBySlug(slug);
  if (!recipe) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Recipe not found" } },
      { status: 404 },
    );
  }
  return NextResponse.json(
    { recipe },
    {
      headers: {
        "cache-control": "public, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}

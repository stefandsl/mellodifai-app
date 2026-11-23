import type { RecipeLocale } from "@mellodifai/shared";
import { type NextRequest, NextResponse } from "next/server";
import { getPublishedRecipes, renderRecipesMarkdown } from "@/lib/site/recipes";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const langParam = request.nextUrl.searchParams.get("lang");
  const locale: RecipeLocale = langParam === "it" ? "it" : "en";
  const markdown = renderRecipesMarkdown(getPublishedRecipes(), locale);

  return new NextResponse(markdown, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}

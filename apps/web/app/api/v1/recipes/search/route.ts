import { type RecipeLocale, scoreRecipes } from "@mellodifai/shared";
import { type NextRequest, NextResponse } from "next/server";
import { getPublishedRecipes } from "@/lib/site/recipes";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const langParam = request.nextUrl.searchParams.get("lang");
  const locale: RecipeLocale = langParam === "it" ? "it" : "en";
  const scores = scoreRecipes(getPublishedRecipes(), query, locale);

  return NextResponse.json(
    {
      success: true,
      message: "",
      data: { scores },
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}

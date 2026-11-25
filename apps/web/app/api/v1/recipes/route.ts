import {
  LANGS,
  type Lang,
  RECIPE_KINDS,
  type RecipeKind,
  type RecipeLocale,
  searchRecipesLocal,
} from "@mellodifai/shared";
import { type NextRequest, NextResponse } from "next/server";
import { getPublishedRecipes } from "@/lib/site/recipes";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const kindParam = searchParams.get("kind")?.trim() ?? "";
  const langParam = searchParams.get("lang")?.trim() ?? "";
  const query = searchParams.get("q")?.trim() ?? "";
  const limitParam = searchParams.get("limit")?.trim() ?? "";

  if (kindParam && !(RECIPE_KINDS as readonly string[]).includes(kindParam)) {
    return NextResponse.json(
      { error: { code: "invalid_kind", message: "Unknown recipe kind" } },
      { status: 400 },
    );
  }

  if (langParam && !(LANGS as readonly string[]).includes(langParam)) {
    return NextResponse.json(
      { error: { code: "invalid_lang", message: "Unknown language" } },
      { status: 400 },
    );
  }

  let limit: number | null = null;
  if (limitParam) {
    const parsed = Number(limitParam);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      return NextResponse.json(
        { error: { code: "invalid_limit", message: "limit must be 1..100" } },
        { status: 400 },
      );
    }
    limit = parsed;
  }

  let recipes = getPublishedRecipes();
  if (kindParam) {
    recipes = recipes.filter((r) => r.kind === (kindParam as RecipeKind));
  }
  if (langParam) {
    recipes = recipes.filter((r) => r.languages.includes(langParam as Lang));
  }
  if (query) {
    const locale: RecipeLocale = langParam === "it" ? "it" : "en";
    recipes = searchRecipesLocal(recipes, query, locale).matches;
  }
  if (limit !== null) {
    recipes = recipes.slice(0, limit);
  }

  return NextResponse.json(
    { recipes },
    {
      headers: {
        "cache-control": "public, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}

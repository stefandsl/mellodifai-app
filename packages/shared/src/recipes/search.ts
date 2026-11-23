import {
  type Recipe,
  type RecipeKind,
  type RecipeLocale,
  type RecipeTarget,
  targetsForRecipe,
} from "./schema.js";

const TARGET_ALIASES: Record<string, RecipeTarget> = {
  tiktok: "tiktok",
  reels: "reels",
  reel: "reels",
  shorts: "shorts",
  short: "shorts",
  instagram: "instagram",
  ig: "instagram",
  youtube: "youtube",
  yt: "youtube",
  linkedin: "linkedin",
  spotify: "spotify",
  "apple music": "apple-music",
  applemusic: "apple-music",
  "apple-music": "apple-music",
};

const KIND_ALIASES: Record<RecipeKind, readonly string[]> = {
  remix: ["remix", "remixes"],
  cover: ["cover", "covers"],
  pantomime: ["pantomime", "pantomima", "pantomime"],
  satire: ["satire", "satira", "parodia", "parody"],
};

function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/gu, "")
    .toLowerCase();
}

export function tokenizeRecipeText(text: string): string[] {
  return normalize(text).match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) ?? [];
}

export function resolveTargetFilter(query: string): RecipeTarget | null {
  const cleaned = normalize(query).trim().replaceAll(/\s+/gu, " ");
  if (!cleaned) return null;
  return TARGET_ALIASES[cleaned] ?? null;
}

function recipeWordBag(recipe: Recipe, lang: RecipeLocale): Set<string> {
  const parts: string[] = [
    recipe.title[lang],
    recipe.summary[lang],
    recipe.genre,
    recipe.kind,
    ...KIND_ALIASES[recipe.kind],
    ...recipe.highlights.map((h) => h[lang]),
    ...(recipe.tempo?.feel ? [recipe.tempo.feel] : []),
    ...recipe.languages,
  ];
  return new Set(parts.flatMap(tokenizeRecipeText));
}

export type LocalRecipeSearchResult<T extends Recipe = Recipe> = {
  mode: "all" | "target" | "text";
  target: RecipeTarget | null;
  matches: T[];
};

export function searchRecipesLocal<T extends Recipe>(
  recipes: readonly T[],
  query: string,
  lang: RecipeLocale = "en",
): LocalRecipeSearchResult<T> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { mode: "all", target: null, matches: [...recipes] };
  }

  const target = resolveTargetFilter(trimmed);
  if (target) {
    return {
      mode: "target",
      target,
      matches: recipes.filter((r) => targetsForRecipe(r).includes(target)),
    };
  }

  const queryTokens = tokenizeRecipeText(trimmed);
  if (queryTokens.length === 0) {
    return { mode: "all", target: null, matches: [...recipes] };
  }

  const matches = recipes.filter((recipe) => {
    const bag = recipeWordBag(recipe, lang);
    return queryTokens.every((token) => bag.has(token));
  });
  return { mode: "text", target: null, matches };
}

export function scoreRecipes(
  recipes: readonly Recipe[],
  query: string,
  lang: RecipeLocale = "en",
): Record<string, number> {
  const trimmed = query.trim();
  const scores: Record<string, number> = {};
  if (!trimmed) {
    for (const r of recipes) scores[r.id] = r.featured ? 1 : 0.5;
    return scores;
  }

  const target = resolveTargetFilter(trimmed);
  const queryTokens = tokenizeRecipeText(trimmed);
  const otherLang: RecipeLocale = lang === "it" ? "en" : "it";

  for (const recipe of recipes) {
    if (target) {
      const hit = targetsForRecipe(recipe).includes(target);
      scores[recipe.id] = hit ? 1 : 0;
      continue;
    }

    if (queryTokens.length === 0) {
      scores[recipe.id] = 0;
      continue;
    }

    const titleTokens = new Set(tokenizeRecipeText(recipe.title[lang]));
    const kindGenreTokens = new Set([
      ...tokenizeRecipeText(recipe.kind),
      ...KIND_ALIASES[recipe.kind],
      ...tokenizeRecipeText(recipe.genre),
    ]);
    const summaryTokens = new Set([
      ...tokenizeRecipeText(recipe.summary[lang]),
      ...recipe.highlights.flatMap((h) => tokenizeRecipeText(h[lang])),
    ]);
    const otherLangTokens = new Set([
      ...tokenizeRecipeText(recipe.title[otherLang]),
      ...tokenizeRecipeText(recipe.summary[otherLang]),
    ]);
    const fullText = normalize(
      `${recipe.title[lang]} ${recipe.summary[lang]} ${recipe.genre} ${recipe.kind}`,
    );

    let raw = 0;
    for (const token of queryTokens) {
      if (titleTokens.has(token)) raw += 1;
      else if (kindGenreTokens.has(token)) raw += 0.85;
      else if (summaryTokens.has(token)) raw += 0.65;
      else if (otherLangTokens.has(token)) raw += 0.45;
      else if (token.length >= 3 && fullText.includes(token)) raw += 0.25;
    }

    const normalizedScore = Math.min(1, raw / queryTokens.length);
    const featuredBoost = normalizedScore > 0 && recipe.featured ? 0.03 : 0;
    scores[recipe.id] = Number(
      Math.min(1, normalizedScore + featuredBoost).toFixed(4),
    );
  }

  return scores;
}

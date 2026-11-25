import {
  type Recipe,
  RecipeSchema,
  targetsForRecipe,
} from "@mellodifai/shared";
import { getPublishedRecipes, type LoadedRecipe } from "./recipes";

// Test-only fixture of 24 song recipes built from the real 12 published recipes and validated
// through the same RecipeSchema. Used only by unit tests and lab e2e judges that require more
// than 12 cards (the canvas DOM cap <= 20 at 1440 and dense 5/4/2 grid columns).

const VARIANT_SUFFIXES = [
  { slug: "alt-take", it: "variante studio", en: "studio variant" },
  { slug: "live-cut", it: "versione live", en: "live edition" },
] as const;

function makeFixtureUuid(index: number): string {
  const tail = String(index + 1).padStart(12, "0");
  return `22000001-4c05-4c05-9c05-${tail}`;
}

export function buildRecipeTestFixture(count = 24): LoadedRecipe[] {
  const real = getPublishedRecipes();
  if (real.length === 0) {
    throw new Error("Expected published recipes to build test fixture");
  }
  const out: LoadedRecipe[] = [];

  for (let i = 0; i < count; i += 1) {
    const base = real[i % real.length];
    if (!base) continue;

    if (i < real.length) {
      out.push(base);
      continue;
    }

    const cycle = Math.floor(i / real.length) - 1;
    const variant =
      VARIANT_SUFFIXES[cycle % VARIANT_SUFFIXES.length] ?? VARIANT_SUFFIXES[0];
    const extraNum = cycle >= VARIANT_SUFFIXES.length ? `-${cycle + 1}` : "";
    const slug = `${base.slug}-${variant.slug}${extraNum}`.slice(0, 40);
    const titleEn = `${base.title.en} ${i + 1}`.slice(0, 40);
    const titleIt = `${base.title.it} ${i + 1}`.slice(0, 40);
    const summaryEn = `${base.summary.en.slice(0, 108).trimEnd()} (${variant.en}).`;
    const summaryIt = `${base.summary.it.slice(0, 105).trimEnd()} (${variant.it}).`;

    const { mediaUrls: _u, targets: _t, ...rawBase } = base;
    const candidate: Recipe = RecipeSchema.parse({
      ...rawBase,
      id: makeFixtureUuid(i),
      slug,
      title: { it: titleIt, en: titleEn },
      summary: { it: summaryIt, en: summaryEn },
      featured: false,
    });

    out.push({
      ...candidate,
      mediaUrls: { ...base.mediaUrls },
      targets: targetsForRecipe(candidate),
    });
  }

  return out;
}

let cachedFixture24: LoadedRecipe[] | null = null;

export function getRecipeTestFixture(): LoadedRecipe[] {
  if (!cachedFixture24) {
    cachedFixture24 = buildRecipeTestFixture(24);
  }
  return cachedFixture24;
}

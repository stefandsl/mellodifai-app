// Build-time validation for content/recipes/*/recipe.json and the site asset manifest.
// Runs before `next build` in apps/web/package.json so a broken recipe fails the build
// instead of returning 500 from dynamic route handlers at runtime.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type LoadRecipesOptions, loadRecipes } from "../lib/site/recipes";

export function validateRecipesAtBuild(options: LoadRecipesOptions = {}): {
  total: number;
  published: number;
} {
  const recipes = loadRecipes({
    includeDrafts: true,
    checkManifest: true,
    ...options,
  });
  const published = recipes.filter((r) => r.status === "published").length;
  return { total: recipes.length, published };
}

function optionsFromEnvAndArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): LoadRecipesOptions {
  const options: LoadRecipesOptions = {};
  if (env.MDF_RECIPES_CONTENT_DIR) {
    options.contentDir = env.MDF_RECIPES_CONTENT_DIR;
  }
  if (env.MDF_RECIPES_MEDIA_DIR) {
    options.mediaDir = env.MDF_RECIPES_MEDIA_DIR;
  }
  if (env.MDF_RECIPES_MANIFEST) {
    options.manifestPath = env.MDF_RECIPES_MANIFEST;
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--content-dir" && next) {
      options.contentDir = next;
      i += 1;
    } else if (arg === "--media-dir" && next) {
      options.mediaDir = next;
      i += 1;
    } else if (arg === "--manifest" && next) {
      options.manifestPath = next;
      i += 1;
    } else if (arg === "--no-manifest") {
      options.checkManifest = false;
    }
  }
  return options;
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    const result = validateRecipesAtBuild(
      optionsFromEnvAndArgs(process.argv.slice(2), process.env),
    );
    console.log(
      `Validated ${result.total} song recipes (${result.published} published)`,
    );
  } catch (err) {
    console.error(
      `Recipe validation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}

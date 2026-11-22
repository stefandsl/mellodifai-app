import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  RECIPE_PREVIEW_MAX_BYTES,
  type Recipe,
  type RecipeLocale,
  RecipeSchema,
  type RecipeTarget,
  targetsForRecipe,
} from "@mellodifai/shared";
import { z } from "zod";

export const AssetManifestEntrySchema = z.object({
  path: z.string().min(1),
  origin: z.string().min(3),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  bytes: z.number().int().positive(),
});

export const AssetsManifestSchema = z.object({
  schemaVersion: z.literal(1),
  assets: z.array(AssetManifestEntrySchema),
});

export type AssetManifestEntry = z.infer<typeof AssetManifestEntrySchema>;
export type AssetsManifest = z.infer<typeof AssetsManifestSchema>;

export type LoadedRecipe = Recipe & {
  mediaUrls: {
    cover: string;
    preview: string;
    example: string;
  };
  targets: RecipeTarget[];
};

export type LoadRecipesOptions = {
  contentDir?: string;
  mediaDir?: string;
  manifestPath?: string;
  includeDrafts?: boolean;
  checkManifest?: boolean;
};

function findRepoRoot(): string {
  const candidates = [
    resolve(process.cwd()),
    resolve(process.cwd(), "../.."),
    resolve(import.meta.dirname, "../../../.."),
  ];
  for (const dir of candidates) {
    if (
      existsSync(join(dir, "content", "recipes")) &&
      existsSync(join(dir, "apps", "web", "public", "site"))
    ) {
      return dir;
    }
  }
  return resolve(import.meta.dirname, "../../../..");
}

export function defaultRecipePaths() {
  const root = findRepoRoot();
  return {
    root,
    contentDir: join(root, "content", "recipes"),
    mediaDir: join(root, "apps", "web", "public", "site", "recipes"),
    manifestPath: join(
      root,
      "apps",
      "web",
      "public",
      "site",
      "assets.manifest.json",
    ),
  };
}

export function loadAssetsManifest(
  manifestPath = defaultRecipePaths().manifestPath,
): AssetsManifest {
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing assets manifest at ${manifestPath}`);
  }
  const raw: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  return AssetsManifestSchema.parse(raw);
}

export function loadRecipes(options: LoadRecipesOptions = {}): LoadedRecipe[] {
  const defaults = defaultRecipePaths();
  const contentDir = options.contentDir ?? defaults.contentDir;
  const mediaDir = options.mediaDir ?? defaults.mediaDir;
  const manifestPath = options.manifestPath ?? defaults.manifestPath;
  const includeDrafts = options.includeDrafts ?? false;
  const checkManifest = options.checkManifest ?? true;

  if (!existsSync(contentDir)) {
    throw new Error(`Recipes content directory not found: ${contentDir}`);
  }

  let manifestPaths: Set<string> | null = null;
  if (checkManifest) {
    const manifest = loadAssetsManifest(manifestPath);
    manifestPaths = new Set(manifest.assets.map((entry) => entry.path));
  }

  const dirs = readdirSync(contentDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const seenIds = new Set<string>();
  const seenSlugs = new Set<string>();
  const loaded: LoadedRecipe[] = [];

  for (const dirName of dirs) {
    const jsonPath = join(contentDir, dirName, "recipe.json");
    if (!existsSync(jsonPath)) {
      throw new Error(`Recipe folder "${dirName}" is missing recipe.json`);
    }

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(jsonPath, "utf8"));
    } catch (err) {
      throw new Error(
        `Invalid JSON in ${jsonPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const parsed = RecipeSchema.safeParse(raw);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new Error(`Invalid recipe "${dirName}": ${detail}`);
    }

    const recipe = parsed.data;
    if (recipe.slug !== dirName) {
      throw new Error(
        `Recipe folder "${dirName}" does not match slug "${recipe.slug}"`,
      );
    }
    if (seenIds.has(recipe.id)) {
      throw new Error(`Duplicate recipe id "${recipe.id}" in "${recipe.slug}"`);
    }
    if (seenSlugs.has(recipe.slug)) {
      throw new Error(`Duplicate recipe slug "${recipe.slug}"`);
    }
    seenIds.add(recipe.id);
    seenSlugs.add(recipe.slug);

    for (const key of ["cover", "preview", "example"] as const) {
      const fileName = recipe.media[key];
      const filePath = join(mediaDir, recipe.slug, fileName);
      if (!existsSync(filePath)) {
        throw new Error(
          `Recipe "${recipe.slug}" is missing media.${key} file "${fileName}" at ${filePath}`,
        );
      }
      const stat = statSync(filePath);
      if (stat.size <= 0) {
        throw new Error(
          `Recipe "${recipe.slug}" has empty media.${key} file "${fileName}"`,
        );
      }
      if (key === "preview" && stat.size > RECIPE_PREVIEW_MAX_BYTES) {
        throw new Error(
          `Recipe "${recipe.slug}" preview "${fileName}" exceeds ${RECIPE_PREVIEW_MAX_BYTES} bytes (${stat.size})`,
        );
      }
      const manifestRel = `recipes/${recipe.slug}/${fileName}`;
      if (manifestPaths && !manifestPaths.has(manifestRel)) {
        throw new Error(
          `Recipe "${recipe.slug}" media "${manifestRel}" is missing from assets.manifest.json`,
        );
      }
    }

    if (!includeDrafts && recipe.status !== "published") {
      continue;
    }

    loaded.push({
      ...recipe,
      mediaUrls: {
        cover: `/site/recipes/${recipe.slug}/${recipe.media.cover}`,
        preview: `/site/recipes/${recipe.slug}/${recipe.media.preview}`,
        example: `/site/recipes/${recipe.slug}/${recipe.media.example}`,
      },
      targets: targetsForRecipe(recipe),
    });
  }

  return loaded.sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return a.slug.localeCompare(b.slug);
  });
}

let cachedPublished: LoadedRecipe[] | null = null;

export function getPublishedRecipes(): LoadedRecipe[] {
  if (!cachedPublished) {
    cachedPublished = loadRecipes({ includeDrafts: false });
  }
  return cachedPublished;
}

export function resetRecipesCache(): void {
  cachedPublished = null;
}

export function getRecipeBySlug(slug: string): LoadedRecipe | null {
  return getPublishedRecipes().find((r) => r.slug === slug) ?? null;
}

export function getMoreRecipes(slug: string, limit = 12): LoadedRecipe[] {
  const all = getPublishedRecipes();
  const current = all.find((r) => r.slug === slug);
  const others = all.filter((r) => r.slug !== slug);
  if (!current) return others.slice(0, limit);
  const sameKind = others.filter((r) => r.kind === current.kind);
  const differentKind = others.filter((r) => r.kind !== current.kind);
  return [...sameKind, ...differentKind].slice(0, limit);
}

export function renderRecipesMarkdown(
  recipes: readonly LoadedRecipe[],
  lang: RecipeLocale = "en",
): string {
  const lines: string[] = [
    "---",
    `title: ${lang === "it" ? "Ricette musicali MellodifAI" : "MellodifAI Song Recipes"}`,
    `lang: ${lang}`,
    `count: ${recipes.length}`,
    "---",
    "",
    lang === "it"
      ? "# Ricette musicali MellodifAI"
      : "# MellodifAI Song Recipes",
    "",
    lang === "it"
      ? "Catalogo pubblico delle ricette per remix, cover, pantomime e satira musicale."
      : "Public catalog of song recipes for remixes, covers, pantomimes and musical satire.",
    "",
  ];

  for (const recipe of recipes) {
    lines.push(`## ${recipe.title[lang]}`);
    lines.push("");
    lines.push(`- Slug: \`${recipe.slug}\``);
    lines.push(`- Kind: ${recipe.kind}`);
    lines.push(`- Genre: ${recipe.genre}`);
    lines.push(
      `- Output: ${recipe.output}${recipe.format ? ` (${recipe.format})` : ""}`,
    );
    lines.push(`- Languages: ${recipe.languages.join(", ")}`);
    lines.push(`- URL: /recipes/${recipe.slug}`);
    lines.push(`- Editor example: /recipes/${recipe.slug}/try`);
    lines.push("");
    lines.push(recipe.summary[lang]);
    lines.push("");
    if (recipe.inputs.length > 0) {
      lines.push(lang === "it" ? "### Cosa porti" : "### What you bring");
      for (const input of recipe.inputs) {
        const opt = input.optional
          ? lang === "it"
            ? " (opzionale)"
            : " (optional)"
          : "";
        lines.push(`- ${input.label[lang]}${opt}`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildRecipeStartPayload,
  CookieCreateSongInput,
  CreateSongInput,
  RECIPE_KINDS,
} from "@mellodifai/shared";
import { afterAll, describe, expect, it } from "vitest";
import { RemakeStartInput } from "@/lib/ops/defs/inputs";
import { cleanRoom } from "@/lib/site/judge/clean-room";
import {
  getMoreRecipes,
  getPublishedRecipes,
  getRecipeBySlug,
  loadAssetsManifest,
  loadRecipes,
  renderRecipesMarkdown,
} from "@/lib/site/recipes";

const CAPTURE_DIR =
  process.env.SITE_TEXT_CAPTURE ??
  "E:/mellodifai/research/2026-11-20/cardboard/text-capture";

const TMP_ROOT = join(
  process.env.RUNNER_TEMP || process.env.TEMP || tmpdir(),
  "c14-tests",
);
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  mkdirSync(TMP_ROOT, { recursive: true });
  const dir = mkdtempSync(join(TMP_ROOT, `${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("real song recipes catalog (content/recipes)", () => {
  it("loads at least 12 valid published recipes covering all four kinds", () => {
    const recipes = getPublishedRecipes();
    expect(recipes.length).toBeGreaterThanOrEqual(12);
    for (const kind of RECIPE_KINDS) {
      expect(
        recipes.filter((r) => r.kind === kind).length,
        `expected at least 3 recipes of kind ${kind}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives every recipe Italian and English texts with zero em dashes", () => {
    const emDash = String.fromCodePoint(0x2014);
    for (const recipe of getPublishedRecipes()) {
      expect(recipe.title.it.length).toBeGreaterThanOrEqual(3);
      expect(recipe.title.en.length).toBeGreaterThanOrEqual(3);
      expect(recipe.summary.it.length).toBeGreaterThanOrEqual(40);
      expect(recipe.summary.en.length).toBeGreaterThanOrEqual(40);
      const serialized = JSON.stringify(recipe);
      expect(serialized.includes(emDash), `em dash in ${recipe.slug}`).toBe(
        false,
      );
      for (const input of recipe.inputs) {
        expect(input.label.it.length).toBeGreaterThanOrEqual(4);
        expect(input.label.en.length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("verifies every media file exists on disk and is indexed in assets.manifest.json", () => {
    const manifest = loadAssetsManifest();
    const manifestPaths = new Set(manifest.assets.map((a) => a.path));
    for (const recipe of getPublishedRecipes()) {
      for (const key of ["cover", "preview", "example"] as const) {
        const rel = `recipes/${recipe.slug}/${recipe.media[key]}`;
        expect(
          manifestPaths.has(rel),
          `missing ${rel} in assets.manifest.json`,
        ).toBe(true);
        expect(recipe.mediaUrls[key]).toBe(`/site/${rel}`);
      }
    }
  });

  it("looks up a recipe by slug and orders more-recipes with same kind first", () => {
    const all = getPublishedRecipes();
    const first = all[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(getRecipeBySlug(first.slug)?.id).toBe(first.id);
    expect(getRecipeBySlug("does-not-exist")).toBeNull();

    const more = getMoreRecipes(first.slug, 6);
    expect(more).toHaveLength(6);
    expect(more.some((r) => r.slug === first.slug)).toBe(false);
    expect(more[0]?.kind).toBe(first.kind);
  });

  it("builds a valid start payload for every recipe against the real zod ops schemas", () => {
    const takeId = "11111111-1111-4111-8111-111111111111";
    for (const recipe of getPublishedRecipes()) {
      const sampleValues: Record<string, unknown> = {};
      for (const input of recipe.inputs) {
        if (input.kind === "link") {
          sampleValues[input.id] =
            "https://www.youtube.com/watch?v=49rDdMbXd_w";
        } else if (input.kind === "audio") {
          sampleValues[input.id] = { takeId };
        } else if (input.kind === "lyrics") {
          sampleValues[input.id] = "First original line\nSecond original line";
        } else if (input.kind === "text") {
          sampleValues[input.id] = "Sample user note";
        } else if (input.kind === "select") {
          sampleValues[input.id] = input.default;
        }
      }
      const built = buildRecipeStartPayload(
        recipe,
        sampleValues,
        recipe.languages[0] ?? "en",
      );
      expect(built.ok, `${recipe.slug}: ${built.ok ? "" : built.error}`).toBe(
        true,
      );
      if (!built.ok) continue;
      if (built.op === "song_create") {
        expect(
          CookieCreateSongInput.safeParse(built.payload).success,
          `${recipe.slug} CookieCreateSongInput`,
        ).toBe(true);
        expect(
          CreateSongInput.safeParse(built.payload).success,
          `${recipe.slug} CreateSongInput`,
        ).toBe(true);
        if (recipe.preset.audioWeight !== undefined) {
          expect(
            built.payload.settings.source?.audioWeight,
            `${recipe.slug} audioWeight`,
          ).toBe(recipe.preset.audioWeight);
        }
      } else {
        expect(
          RemakeStartInput.safeParse(built.payload).success,
          `${recipe.slug} RemakeStartInput`,
        ).toBe(true);
      }
    }
  });

  it("maps late-night-lofi audioWeight (0.7) into settings.source", () => {
    const lofi = getRecipeBySlug("late-night-lofi");
    expect(lofi).not.toBeNull();
    if (!lofi) return;
    const built = buildRecipeStartPayload(
      lofi,
      { sourceAudio: { takeId: "11111111-1111-4111-8111-111111111111" } },
      "en",
    );
    expect(built.ok).toBe(true);
    if (built.ok && built.op === "song_create") {
      expect(built.payload.settings.source?.mode).toBe("cover");
      expect(built.payload.settings.source?.audioWeight).toBe(0.7);
    }
  });

  it("renders a clean markdown catalog for agents", () => {
    const md = renderRecipesMarkdown(getPublishedRecipes(), "en");
    expect(md).toContain("# MellodifAI Song Recipes");
    expect(md).toContain("/recipes/");
    expect(md.includes(String.fromCodePoint(0x2014))).toBe(false);
  });

  it.skipIf(!existsSync(CAPTURE_DIR))(
    "passes the clean-room judge against captured reference text",
    () => {
      const reference = readdirSync(CAPTURE_DIR).flatMap(
        (f) =>
          (
            JSON.parse(readFileSync(join(CAPTURE_DIR, f), "utf8")) as {
              strings: string[];
            }
          ).strings,
      );
      const ours: string[] = [];
      for (const recipe of getPublishedRecipes()) {
        ours.push(
          recipe.title.en,
          recipe.title.it,
          recipe.summary.en,
          recipe.summary.it,
        );
        for (const h of recipe.highlights) {
          ours.push(h.en, h.it);
        }
        if (recipe.body) ours.push(recipe.body.en, recipe.body.it);
        for (const input of recipe.inputs) {
          ours.push(input.label.en, input.label.it);
          if (input.hint) ours.push(input.hint.en, input.hint.it);
          if (input.placeholder) {
            ours.push(input.placeholder.en, input.placeholder.it);
          }
          if (input.kind === "select") {
            for (const opt of input.options) {
              ours.push(opt.label.en, opt.label.it);
            }
          }
        }
      }
      const result = cleanRoom({ ours, reference });
      expect(
        [...result.sharedRuns, ...result.equalStrings].map(
          (h) => `${h.ours} = ${h.reference}`,
        ),
      ).toEqual([]);
    },
  );
});

describe("loader validation failure modes", () => {
  it("fails when a referenced media file is missing", () => {
    const base = makeTempDir("missing-media");
    const contentDir = join(base, "content");
    const mediaDir = join(base, "media");
    const slug = "broken-media-recipe";
    mkdirSync(join(contentDir, slug), { recursive: true });
    mkdirSync(join(mediaDir, slug), { recursive: true });
    writeFileSync(
      join(mediaDir, slug, "cover.webp"),
      Buffer.from("RIFF0000WEBP"),
    );
    writeFileSync(join(mediaDir, slug, "example.mp4"), Buffer.from("ftyp"));
    // preview.mp4 intentionally omitted

    const valid = getPublishedRecipes()[0];
    expect(valid).toBeDefined();
    if (!valid) return;
    const { mediaUrls: _u, targets: _t, ...raw } = valid;
    writeFileSync(
      join(contentDir, slug, "recipe.json"),
      JSON.stringify({
        ...raw,
        slug,
        media: {
          cover: "cover.webp",
          preview: "preview.mp4",
          example: "example.mp4",
          startAt: 0,
        },
      }),
    );

    expect(() =>
      loadRecipes({ contentDir, mediaDir, checkManifest: false }),
    ).toThrow(/preview\.mp4/u);
  });

  it("fails when a recipe folder name does not match its slug", () => {
    const base = makeTempDir("slug-mismatch");
    const contentDir = join(base, "content");
    const mediaDir = join(base, "media");
    const valid = getPublishedRecipes()[0];
    expect(valid).toBeDefined();
    if (!valid) return;
    const { mediaUrls: _u, targets: _t, ...raw } = valid;
    mkdirSync(join(contentDir, "wrong-folder"), { recursive: true });
    writeFileSync(
      join(contentDir, "wrong-folder", "recipe.json"),
      JSON.stringify(raw),
    );
    expect(() =>
      loadRecipes({ contentDir, mediaDir, checkManifest: false }),
    ).toThrow(/slug/u);
  });

  it("filters draft recipes out when includeDrafts is false", () => {
    const base = makeTempDir("draft-filter");
    const contentDir = join(base, "content");
    const mediaDir = join(base, "media");
    const slug = "draft-only-recipe";
    const valid = getPublishedRecipes()[0];
    expect(valid).toBeDefined();
    if (!valid) return;
    const { mediaUrls: _u, targets: _t, ...raw } = valid;
    mkdirSync(join(contentDir, slug), { recursive: true });
    mkdirSync(join(mediaDir, slug), { recursive: true });
    writeFileSync(join(mediaDir, slug, raw.media.cover), Buffer.from("x"));
    writeFileSync(join(mediaDir, slug, raw.media.preview), Buffer.from("x"));
    writeFileSync(join(mediaDir, slug, raw.media.example), Buffer.from("x"));
    writeFileSync(
      join(contentDir, slug, "recipe.json"),
      JSON.stringify({ ...raw, slug, status: "draft" }),
    );

    expect(
      loadRecipes({
        contentDir,
        mediaDir,
        checkManifest: false,
        includeDrafts: false,
      }),
    ).toHaveLength(0);
    expect(
      loadRecipes({
        contentDir,
        mediaDir,
        checkManifest: false,
        includeDrafts: true,
      }),
    ).toHaveLength(1);
  });

  it("refuses a broken recipe.json in the build validation script", () => {
    const base = makeTempDir("broken-build-fixture");
    const contentDir = join(base, "content");
    const mediaDir = join(base, "media");
    const manifestPath = join(base, "assets.manifest.json");
    mkdirSync(join(contentDir, "broken-recipe"), { recursive: true });
    mkdirSync(mediaDir, { recursive: true });
    writeFileSync(
      manifestPath,
      JSON.stringify({ schemaVersion: 1, assets: [] }),
    );
    writeFileSync(
      join(contentDir, "broken-recipe", "recipe.json"),
      JSON.stringify({
        slug: "broken-recipe",
        kind: "not-a-valid-kind",
      }),
    );

    const webDir = resolve(import.meta.dirname, "../..");
    const pkg = JSON.parse(
      readFileSync(join(webDir, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.["validate:recipes"]).toBe(
      "tsx scripts/validate-recipes.ts",
    );
    expect(pkg.scripts?.build?.startsWith("pnpm run validate:recipes &&")).toBe(
      true,
    );

    const tsx = createRequire(resolve(webDir, "../../package.json")).resolve(
      "tsx/cli",
    );
    const run = spawnSync(
      process.execPath,
      [tsx, join(webDir, "scripts", "validate-recipes.ts")],
      {
        cwd: webDir,
        env: {
          ...process.env,
          MDF_RECIPES_CONTENT_DIR: contentDir,
          MDF_RECIPES_MEDIA_DIR: mediaDir,
          MDF_RECIPES_MANIFEST: manifestPath,
        },
        encoding: "utf8",
        windowsHide: true,
      },
    );

    expect(run.error).toBeUndefined();
    expect(run.status).not.toBe(0);
    const combined = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
    expect(combined).toMatch(/broken-recipe/u);
  });
});

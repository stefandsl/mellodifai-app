import { CookieCreateSongInput } from "../ops/inputs.js";
import { REMAKE_COUNTRIES, youtubeVideoId } from "../remake/workflow.js";
import type { SongSettings } from "../song-settings.js";
import type { Lang } from "../stages.js";
import { LANGS } from "../stages.js";
import type { Recipe, RecipeRewriteMode } from "./schema.js";

export type RecipeTrace = {
  slug: string;
  schemaVersion: number;
};

export type RecipeRemakeStartPayload = {
  url: string;
  lang: Lang;
  country: (typeof REMAKE_COUNTRIES)[number] | null;
};

export type RecipeStartResult =
  | {
      ok: true;
      op: "song_create";
      payload: ReturnType<typeof CookieCreateSongInput.parse>;
      recipe: RecipeTrace;
    }
  | {
      ok: true;
      op: "remake_start";
      payload: RecipeRemakeStartPayload;
      rewriteOptions: {
        mode: RecipeRewriteMode;
        target?: string;
        angle?: string;
      };
      recipe: RecipeTrace;
    }
  | {
      ok: false;
      error: string;
    };

function normalizeYoutubeUrl(raw: string): string | null {
  const text = raw.trim();
  const videoId = youtubeVideoId(text);
  if (!videoId) return null;
  if (/^[\w-]{11}$/u.test(text)) {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }
  return /^https?:\/\//iu.test(text) ? text : `https://${text}`;
}

export function buildRecipeStartPayload(
  recipe: Recipe,
  values: Record<string, unknown>,
  lang: Lang,
): RecipeStartResult {
  const knownIds = new Set(recipe.inputs.map((i) => i.id));
  for (const key of Object.keys(values)) {
    if (!knownIds.has(key)) {
      return { ok: false, error: `Unknown input "${key}"` };
    }
  }

  const bound = new Map<string, unknown>();
  for (const input of recipe.inputs) {
    let value = values[input.id];
    if (
      (value === undefined || value === null || value === "") &&
      input.kind === "select"
    ) {
      value = input.default;
    }

    const empty = value === undefined || value === null || value === "";
    if (empty) {
      if (!input.optional) {
        return { ok: false, error: `Missing required input "${input.id}"` };
      }
      continue;
    }

    if (
      input.kind === "link" ||
      input.kind === "text" ||
      input.kind === "lyrics"
    ) {
      if (typeof value !== "string") {
        return { ok: false, error: `Input "${input.id}" must be a string` };
      }
      const trimmed = value.trim();
      if (!trimmed) {
        if (!input.optional) {
          return { ok: false, error: `Missing required input "${input.id}"` };
        }
        continue;
      }
      if (input.maxLength != null && trimmed.length > input.maxLength) {
        return {
          ok: false,
          error: `Input "${input.id}" exceeds maxLength ${input.maxLength}`,
        };
      }
      bound.set(input.bindsTo, trimmed);
    } else if (input.kind === "select") {
      if (typeof value !== "string") {
        return { ok: false, error: `Input "${input.id}" must be a string` };
      }
      if (!input.options.some((o) => o.value === value)) {
        return {
          ok: false,
          error: `Value "${value}" is not an option for "${input.id}"`,
        };
      }
      bound.set(input.bindsTo, value);
    } else if (input.kind === "audio") {
      if (typeof value !== "object" || value === null) {
        return {
          ok: false,
          error: `Audio input "${input.id}" must specify takeId or upload`,
        };
      }
      bound.set(input.bindsTo, value);
    }
  }

  const trace: RecipeTrace = {
    slug: recipe.slug,
    schemaVersion: recipe.schemaVersion,
  };

  if (recipe.kind === "pantomime" || recipe.kind === "satire") {
    const rawUrl = bound.get("remake_start.url");
    if (typeof rawUrl !== "string") {
      return { ok: false, error: "Remake recipes require a source link" };
    }
    const url = normalizeYoutubeUrl(rawUrl);
    if (!url || url.length > 500) {
      return { ok: false, error: "A valid YouTube link or video id is needed" };
    }
    const rawCountry = bound.get("remake_start.country");
    const country =
      typeof rawCountry === "string" &&
      (REMAKE_COUNTRIES as readonly string[]).includes(rawCountry)
        ? (rawCountry as (typeof REMAKE_COUNTRIES)[number])
        : null;
    const target = bound.get("rewrite.target");
    const angle = bound.get("rewrite.angle");
    const mode: RecipeRewriteMode =
      recipe.preset.rewriteMode ??
      (recipe.kind === "satire" ? "satire" : "pantomime");
    return {
      ok: true,
      op: "remake_start",
      payload: { url, lang, country },
      rewriteOptions: {
        mode,
        ...(typeof target === "string" ? { target } : {}),
        ...(typeof angle === "string" ? { angle } : {}),
      },
      recipe: trace,
    };
  }

  const rawSource = bound.get("song_create.settings.source") as
    | {
        upload?: string;
        takeId?: string;
        versionId?: string;
        continueAt?: number;
        title?: string;
        duration?: number;
      }
    | undefined;

  const settings: Partial<SongSettings> = {
    ...(recipe.preset.bpm !== undefined ? { bpm: recipe.preset.bpm } : {}),
    ...(recipe.preset.keyscale !== undefined
      ? { keyscale: recipe.preset.keyscale }
      : {}),
    ...(recipe.preset.timeSignature !== undefined
      ? { timeSignature: recipe.preset.timeSignature }
      : {}),
    ...(recipe.preset.styleWeight !== undefined
      ? { styleWeight: recipe.preset.styleWeight }
      : {}),
    ...(recipe.preset.weirdness !== undefined
      ? { weirdness: recipe.preset.weirdness }
      : {}),
    ...(recipe.preset.duration !== undefined
      ? { duration: recipe.preset.duration }
      : {}),
    ...(recipe.preset.video !== undefined
      ? { video: recipe.preset.video }
      : {}),
  };

  if (typeof bound.get("song_create.settings.title") === "string") {
    settings.title = bound.get("song_create.settings.title") as string;
  }
  if (typeof bound.get("song_create.settings.exclude") === "string") {
    settings.exclude = bound.get("song_create.settings.exclude") as string;
  }
  if (typeof bound.get("song_create.settings.keyscale") === "string") {
    settings.keyscale = bound.get("song_create.settings.keyscale") as string;
  }
  if (typeof bound.get("song_create.settings.timeSignature") === "string") {
    settings.timeSignature = bound.get(
      "song_create.settings.timeSignature",
    ) as SongSettings["timeSignature"];
  }
  if (rawSource) {
    settings.source = {
      mode: recipe.preset.sourceMode ?? "cover",
      ...rawSource,
    };
  }

  const selectedLang = bound.get("song_create.languages");
  const languages: Lang[] =
    typeof selectedLang === "string" &&
    (LANGS as readonly string[]).includes(selectedLang)
      ? [selectedLang as Lang]
      : [lang];

  const userStyles = bound.get("song_create.styles");
  const styles = [recipe.preset.styles, userStyles]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .join(", ");

  const lyrics =
    typeof bound.get("song_create.lyrics") === "string"
      ? (bound.get("song_create.lyrics") as string)
      : "";
  const prompt =
    typeof bound.get("song_create.prompt") === "string"
      ? (bound.get("song_create.prompt") as string)
      : "";
  const vocalGender =
    bound.get("song_create.vocalGender") !== undefined
      ? (bound.get("song_create.vocalGender") as "m" | "f")
      : (recipe.preset.vocalGender ?? null);

  const parsed = CookieCreateSongInput.safeParse({
    mode: "advanced",
    prompt,
    lyrics,
    styles: styles || recipe.genre,
    languages,
    vocalGender,
    settings,
    count: 1,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }

  return {
    ok: true,
    op: "song_create",
    payload: parsed.data,
    recipe: trace,
  };
}

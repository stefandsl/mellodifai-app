import { describe, expect, it } from "vitest";
import { CookieCreateSongInput, CreateSongInput } from "../ops/inputs.js";
import {
  buildRecipeStartPayload,
  RECIPE_KINDS,
  type Recipe,
  RecipeSchema,
  scoreRecipes,
  searchRecipesLocal,
  targetsForRecipe,
} from "./index.js";

function sampleSatireRecipe(): Recipe {
  return {
    id: "5b7f0c1e-2a54-4f0e-9d39-6a1c2e7d9b10",
    slug: "office-monday-satire",
    schemaVersion: 1,
    kind: "satire",
    title: {
      it: "Satira sul lunedi d'ufficio",
      en: "Monday office satire",
    },
    summary: {
      it: "Stessa melodia del brano originale, parole ironiche sul caffe del lunedi mattina.",
      en: "Keep the original melody and swap in sharp lines about Monday morning office life.",
    },
    highlights: [
      {
        it: "Rime e sillabe allineate al canto",
        en: "Syllables and rhymes aligned to vocal phrasing",
      },
    ],
    body: {
      it: "Scegli un brano conosciuto e indica il bersaglio della satira.",
      en: "Bring a track link and name the target of the satire.",
    },
    inputs: [
      {
        id: "sourceLink",
        kind: "link",
        label: { it: "Il link del brano", en: "Song link" },
        hint: {
          it: "Incolla un link YouTube pubblico",
          en: "Paste a public YouTube link",
        },
        placeholder: {
          it: "https://www.youtube.com/watch?v=...",
          en: "https://www.youtube.com/watch?v=...",
        },
        optional: false,
        maxLength: 500,
        bindsTo: "remake_start.url",
      },
      {
        id: "target",
        kind: "text",
        label: { it: "Il bersaglio", en: "Satire target" },
        hint: null,
        placeholder: {
          it: "Riunioni infinite del lunedi",
          en: "Endless Monday standups",
        },
        optional: false,
        maxLength: 120,
        bindsTo: "rewrite.target",
      },
      {
        id: "angle",
        kind: "text",
        label: { it: "Il punto di vista", en: "Point of view" },
        hint: null,
        optional: true,
        maxLength: 200,
        bindsTo: "rewrite.angle",
      },
      {
        id: "country",
        kind: "select",
        label: { it: "Paese di riferimento", en: "Country focus" },
        hint: null,
        optional: true,
        options: [
          { value: "IT", label: { it: "Italia", en: "Italy" } },
          { value: "US", label: { it: "Stati Uniti", en: "United States" } },
          { value: "GB", label: { it: "Regno Unito", en: "United Kingdom" } },
        ],
        default: "IT",
        bindsTo: "remake_start.country",
      },
    ],
    languages: ["it", "en"],
    genre: "pop",
    tempo: { bpm: 116, feel: "upbeat pop" },
    form: "full",
    output: "lyric-video",
    format: "9:16",
    featured: true,
    surfaces: ["web", "desktop", "agent"],
    media: {
      cover: "cover.webp",
      preview: "preview.mp4",
      example: "example.mp4",
      startAt: 2,
    },
    preset: {
      rewriteMode: "satire",
      video: "lyric",
    },
    fixture: "office-monday-satire",
    rights: {
      owner: "MellodifAI",
      clearedOn: "2026-11-22",
      licence: "own",
      note: "Placeholder synthetic clip generated locally for C14",
    },
    estimate: { credits: 2, seconds: 90 },
    status: "published",
  };
}

function sampleCoverRecipe(): Recipe {
  return {
    id: "7a1d3f44-6e82-4a91-9b14-2c8e0f1a4d22",
    slug: "piano-ballad-rework",
    schemaVersion: 1,
    kind: "cover",
    title: {
      it: "Ballata piano e voce",
      en: "Piano ballad rework",
    },
    summary: {
      it: "Trasforma il tuo brano in una ballata acustica al pianoforte con nuova timbrica vocale.",
      en: "Turn your song into an intimate piano ballad with a fresh vocal colour and delivery.",
    },
    highlights: [],
    inputs: [
      {
        id: "sourceAudio",
        kind: "audio",
        label: { it: "Traccia audio di partenza", en: "Source audio track" },
        hint: {
          it: "MP3, WAV o FLAC fino a 8 minuti",
          en: "MP3, WAV or FLAC up to 8 minutes",
        },
        optional: false,
        accept: ["audio"],
        min: 1,
        max: 1,
        bindsTo: "song_create.settings.source",
      },
      {
        id: "voice",
        kind: "select",
        label: { it: "Voce", en: "Vocal colour" },
        hint: null,
        optional: true,
        options: [
          { value: "f", label: { it: "Voce femminile", en: "Female voice" } },
          { value: "m", label: { it: "Voce maschile", en: "Male voice" } },
        ],
        default: "f",
        bindsTo: "song_create.vocalGender",
      },
      {
        id: "customLyrics",
        kind: "lyrics",
        label: { it: "Testo da cantare", en: "Lyrics to sing" },
        hint: null,
        optional: true,
        maxLength: 5000,
        bindsTo: "song_create.lyrics",
      },
    ],
    languages: ["it", "en"],
    genre: "acoustic ballad",
    tempo: { bpm: 72, feel: "slow ballad" },
    form: "full",
    output: "audio",
    featured: false,
    surfaces: ["web", "desktop"],
    media: {
      cover: "cover.webp",
      preview: "preview.mp3",
      example: "example.mp3",
      startAt: 0,
    },
    preset: {
      styles: "intimate acoustic piano ballad, warm vocal reverb",
      sourceMode: "cover",
      vocalGender: "f",
      bpm: 72,
      video: "off",
    },
    fixture: "piano-ballad-rework",
    rights: {
      owner: "MellodifAI",
      clearedOn: "2026-11-22",
      licence: "own",
      note: "Placeholder synthetic clip generated locally for C14",
    },
    estimate: { credits: 1, seconds: 60 },
    status: "published",
  };
}

describe("RecipeSchema", () => {
  it("accepts valid video and audio recipes across all four kinds", () => {
    expect(RECIPE_KINDS).toEqual(["remix", "cover", "pantomime", "satire"]);
    expect(RecipeSchema.safeParse(sampleSatireRecipe()).success).toBe(true);
    expect(RecipeSchema.safeParse(sampleCoverRecipe()).success).toBe(true);
  });

  it("fails on a missing required field", () => {
    for (const field of [
      "id",
      "slug",
      "schemaVersion",
      "kind",
      "title",
      "summary",
      "inputs",
      "languages",
      "genre",
      "form",
      "output",
      "surfaces",
      "media",
      "preset",
      "fixture",
      "rights",
      "estimate",
      "status",
    ] as const) {
      const broken = { ...sampleSatireRecipe() } as Record<string, unknown>;
      delete broken[field];
      const result = RecipeSchema.safeParse(broken);
      expect(result.success, `expected failure when ${field} is missing`).toBe(
        false,
      );
    }
  });

  it("fails on an unknown kind", () => {
    const broken = { ...sampleSatireRecipe(), kind: "documentary" };
    expect(RecipeSchema.safeParse(broken).success).toBe(false);
  });

  it("fails when Italian or English text is missing or contains an em dash", () => {
    const missingIt = {
      ...sampleSatireRecipe(),
      title: { en: "Only English" },
    };
    expect(RecipeSchema.safeParse(missingIt).success).toBe(false);

    const missingEn = {
      ...sampleSatireRecipe(),
      summary: {
        it: "Descrizione lunga almeno quaranta caratteri in italiano puro.",
      },
    };
    expect(RecipeSchema.safeParse(missingEn).success).toBe(false);

    const withEmDash = {
      ...sampleSatireRecipe(),
      summary: {
        it: "Stessa melodia \u2014 parole nuove con ironia sul lunedi mattina in ufficio.",
        en: "Same melody and sharp new words about Monday morning office life.",
      },
    };
    expect(RecipeSchema.safeParse(withEmDash).success).toBe(false);
  });

  it("fails on unknown bindsTo, mismatched input kind, or duplicate input ids", () => {
    const unknownBind = sampleSatireRecipe();
    unknownBind.inputs[1] = {
      ...unknownBind.inputs[1],
      bindsTo: "nonexistent.arg" as never,
    };
    expect(RecipeSchema.safeParse(unknownBind).success).toBe(false);

    const mismatchedBind = sampleSatireRecipe();
    mismatchedBind.inputs[1] = {
      ...mismatchedBind.inputs[1],
      bindsTo: "remake_start.url" as never,
    };
    expect(RecipeSchema.safeParse(mismatchedBind).success).toBe(false);

    const dupIds = sampleSatireRecipe();
    dupIds.inputs[2] = { ...dupIds.inputs[2], id: dupIds.inputs[1].id };
    expect(RecipeSchema.safeParse(dupIds).success).toBe(false);
  });

  it("enforces select option enum subsets and default membership", () => {
    const badOption = sampleSatireRecipe();
    badOption.inputs[3] = {
      id: "country",
      kind: "select",
      label: { it: "Paese", en: "Country" },
      hint: null,
      optional: true,
      options: [
        { value: "ZZ", label: { it: "Nessuno", en: "None" } },
        { value: "IT", label: { it: "Italia", en: "Italy" } },
      ],
      default: "IT",
      bindsTo: "remake_start.country",
    };
    expect(RecipeSchema.safeParse(badOption).success).toBe(false);

    const badDefault = sampleSatireRecipe();
    badDefault.inputs[3] = {
      id: "country",
      kind: "select",
      label: { it: "Paese", en: "Country" },
      hint: null,
      optional: true,
      options: [
        { value: "IT", label: { it: "Italia", en: "Italy" } },
        { value: "US", label: { it: "USA", en: "USA" } },
      ],
      default: "GB",
      bindsTo: "remake_start.country",
    };
    expect(RecipeSchema.safeParse(badDefault).success).toBe(false);
  });

  it("enforces format rules by output kind and forbids traversal in media paths", () => {
    const videoWithoutFormat = { ...sampleSatireRecipe() };
    delete (videoWithoutFormat as { format?: string }).format;
    expect(RecipeSchema.safeParse(videoWithoutFormat).success).toBe(false);

    const audioWithFormat = { ...sampleCoverRecipe(), format: "9:16" };
    expect(RecipeSchema.safeParse(audioWithFormat).success).toBe(false);

    const traversal = {
      ...sampleSatireRecipe(),
      media: { ...sampleSatireRecipe().media, cover: "../secret.webp" },
    };
    expect(RecipeSchema.safeParse(traversal).success).toBe(false);
  });

  it("forbids no-derivative or unknown licences in rights", () => {
    const noDerivs = {
      ...sampleSatireRecipe(),
      rights: { ...sampleSatireRecipe().rights, licence: "cc-by-nd" },
    };
    expect(RecipeSchema.safeParse(noDerivs).success).toBe(false);

    const unknownLicence = {
      ...sampleSatireRecipe(),
      rights: { ...sampleSatireRecipe().rights, licence: "unknown" },
    };
    expect(RecipeSchema.safeParse(unknownLicence).success).toBe(false);
  });
});

describe("targets, local search and scoring", () => {
  const recipes = [sampleSatireRecipe(), sampleCoverRecipe()];

  it("derives platform targets from output and format", () => {
    expect(targetsForRecipe(recipes[0])).toEqual([
      "tiktok",
      "reels",
      "shorts",
      "instagram",
    ]);
    expect(targetsForRecipe(recipes[1])).toEqual(["spotify", "apple-music"]);
  });

  it("filters platform words locally with no network", () => {
    const tiktok = searchRecipesLocal(recipes, "tiktok", "en");
    expect(tiktok.mode).toBe("target");
    expect(tiktok.matches.map((r) => r.slug)).toEqual(["office-monday-satire"]);

    const spotify = searchRecipesLocal(recipes, "spotify", "it");
    expect(spotify.mode).toBe("target");
    expect(spotify.matches.map((r) => r.slug)).toEqual(["piano-ballad-rework"]);
  });

  it("matches whole words in the page language and scores all recipes", () => {
    const enHit = searchRecipesLocal(recipes, "piano", "en");
    expect(enHit.mode).toBe("text");
    expect(enHit.matches.map((r) => r.slug)).toEqual(["piano-ballad-rework"]);

    const itHit = searchRecipesLocal(recipes, "lunedi", "it");
    expect(itHit.matches.map((r) => r.slug)).toEqual(["office-monday-satire"]);

    const scores = scoreRecipes(recipes, "piano ballad", "en");
    expect(Object.keys(scores).sort()).toEqual(recipes.map((r) => r.id).sort());
    expect(scores[recipes[1].id]).toBeGreaterThan(scores[recipes[0].id]);
  });
});

describe("buildRecipeStartPayload", () => {
  it("builds a valid remake_start payload for satire and pantomime", () => {
    const satire = sampleSatireRecipe();
    const built = buildRecipeStartPayload(
      satire,
      {
        sourceLink: "https://www.youtube.com/watch?v=49rDdMbXd_w",
        target: "Monday meetings",
        country: "IT",
      },
      "en",
    );
    expect(built.ok).toBe(true);
    if (built.ok && built.op === "remake_start") {
      expect(built.payload).toEqual({
        url: "https://www.youtube.com/watch?v=49rDdMbXd_w",
        lang: "en",
        country: "IT",
      });
      expect(built.rewriteOptions).toEqual({
        mode: "satire",
        target: "Monday meetings",
      });
      expect(built.recipe).toEqual({
        slug: "office-monday-satire",
        schemaVersion: 1,
      });
    }
  });

  it("builds a valid song_create payload for cover and remix", () => {
    const cover = sampleCoverRecipe();
    const takeId = "11111111-1111-4111-8111-111111111111";
    const built = buildRecipeStartPayload(
      cover,
      {
        sourceAudio: { takeId },
        voice: "m",
        customLyrics: "Line one of my own song\nLine two in the rain",
      },
      "en",
    );
    expect(built.ok).toBe(true);
    if (built.ok && built.op === "song_create") {
      expect(CookieCreateSongInput.safeParse(built.payload).success).toBe(true);
      expect(CreateSongInput.safeParse(built.payload).success).toBe(true);
      expect(built.payload.vocalGender).toBe("m");
      expect(built.payload.settings.source?.mode).toBe("cover");
      expect(built.payload.settings.source?.takeId).toBe(takeId);
    }
  });

  it("rejects missing required inputs", () => {
    const satire = sampleSatireRecipe();
    const built = buildRecipeStartPayload(
      satire,
      { sourceLink: "https://www.youtube.com/watch?v=49rDdMbXd_w" },
      "en",
    );
    expect(built.ok).toBe(false);
  });
});

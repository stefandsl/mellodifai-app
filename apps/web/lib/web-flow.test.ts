import { LANGS, publicationCopy } from "@mellodifai/shared";
import { expect, it } from "vitest";
import { PublicationInput } from "../app/actions/schemas";
import { publicationDefaults } from "./publication-defaults";
import { upsertJob } from "./timeline";

it.each(LANGS)(
  "keeps publication titles within the validator limit in %s",
  (language) => {
    const suffix = ` | ${publicationCopy(language).suffix}`;
    const budget = 100 - suffix.length;
    for (const length of [1, budget, budget + 1, 80, 100]) {
      const title = "A".repeat(length);
      const metadata = publicationDefaults(title, "Lyrics", language, null);
      expect(metadata.title).toBe(length <= budget ? title + suffix : title);
      expect(metadata.title.length).toBeLessThanOrEqual(100);
      expect(
        PublicationInput.safeParse({
          renderId: "00000000-0000-4000-8000-000000000001",
          metadata,
        }).success,
      ).toBe(true);
    }
    const unicodeTitle = "🎵".repeat(50);
    expect(publicationDefaults(unicodeTitle, "", language, null).title).toBe(
      unicodeTitle,
    );
  },
);

it("uses the song language when the UI language differs", () => {
  const french = publicationDefaults("Le port", "Une lumière", "fr", null);
  expect(french.title).toBe("Le port | Vidéo avec paroles");
  expect(french.description).toContain(
    "Créé avec des outils d’intelligence artificielle.",
  );
  expect(french.description).not.toContain("Creato con");
  expect(french.tags).toBe("Le port, vidéo avec paroles, fr");
  expect(
    publicationDefaults("Song", "Words", "en", null).description,
  ).toContain("Created with AI tools.");
});

it("prefills metadata and filters chapter starts less than ten seconds apart", () => {
  expect(
    publicationDefaults(
      "My song",
      "[Verse]\nA light across the bay\nWe sing tonight",
      "en",
      [
        { title: "Intro", start: 0 },
        { title: "Verse", start: 4 },
        { title: "Chorus", start: 65 },
      ],
    ),
  ).toEqual({
    title: "My song | Lyric video",
    description:
      "My song\n\nA light across the bay\nWe sing tonight\n\nCreated with AI tools.",
    tags: "My song, lyric video, en",
    chapters: "0:00 Intro\n1:05 Chorus",
  });
  expect(publicationDefaults("Song", "", "it", null).chapters).toBe("");
});
it("updates jobs in chronological position without duplicating rows", () => {
  const a = { id: "a", created_at: "2026-01-01", status: "queued" };
  const b = { id: "b", created_at: "2026-01-02", status: "queued" };
  expect(upsertJob([a, b], { ...a, status: "done" })).toEqual([
    { ...a, status: "done" },
    b,
  ]);
});

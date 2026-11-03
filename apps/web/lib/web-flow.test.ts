import { expect, it } from "vitest";
import { publicationDefaults } from "./publication-defaults";
import { upsertJob } from "./timeline";

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

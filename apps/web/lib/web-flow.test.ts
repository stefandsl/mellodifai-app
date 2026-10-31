import { expect, it } from "vitest";
import { publicationDefaults } from "./publication-defaults";
import { upsertJob } from "./timeline";

it("prefills metadata and filters chapter starts less than ten seconds apart", () => {
  expect(
    publicationDefaults(
      "My song",
      "A brief",
      "en",
      [
        { title: "Intro", start: 0 },
        { title: "Verse", start: 4 },
        { title: "Chorus", start: 65 },
      ],
      "en",
    ),
  ).toEqual({
    title: "My song | Lyric video",
    description: "A brief\n\nCreated with mellodifai.",
    tags: "My, song, en, lyric video",
    chapters: "0:00 Intro\n1:05 Chorus",
  });
  expect(publicationDefaults("Song", "", "it", null, "it").chapters).toBe("");
});
it("updates jobs in chronological position without duplicating rows", () => {
  const a = { id: "a", created_at: "2026-01-01", status: "queued" };
  const b = { id: "b", created_at: "2026-01-02", status: "queued" };
  expect(upsertJob([a, b], { ...a, status: "done" })).toEqual([
    { ...a, status: "done" },
    b,
  ]);
});

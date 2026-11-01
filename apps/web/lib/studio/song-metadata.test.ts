import { describe, expect, it } from "vitest";
import { songMetadata } from "./song-metadata";

describe("songMetadata", () => {
  const base = {
    title: "Lunedì",
    style: "synth pop, dreamy, female vocals",
    cover: "https://s/cover.png",
    audio: "https://s/a.mp3",
    path: "/projects/p1?lang=it",
    siteName: "MellodifAI",
  };

  it("sets the title, and an Open Graph song with its cover and audio", () => {
    const meta = songMetadata(base);
    expect(meta.title).toBe("Lunedì");
    expect(meta.description).toBe("synth pop, dreamy, female vocals");
    expect(meta.openGraph).toMatchObject({
      type: "music.song",
      title: "Lunedì",
      siteName: "MellodifAI",
      url: "/projects/p1?lang=it",
      images: [{ url: "https://s/cover.png", alt: "Lunedì" }],
      audio: [{ url: "https://s/a.mp3", type: "audio/mpeg" }],
    });
    expect(meta.twitter).toMatchObject({
      card: "summary_large_image",
      title: "Lunedì",
      images: ["https://s/cover.png"],
    });
  });

  it("uses the small card and no image when the song has no cover", () => {
    const meta = songMetadata({ ...base, cover: null });
    expect(meta.openGraph).not.toHaveProperty("images");
    expect(meta.twitter).toMatchObject({ card: "summary" });
    expect(meta.twitter).not.toHaveProperty("images");
  });

  it("leaves out the audio when there is none", () => {
    expect(songMetadata({ ...base, audio: null }).openGraph).not.toHaveProperty(
      "audio",
    );
  });

  it("keeps the description short and never empty-handed", () => {
    expect(
      songMetadata({ ...base, style: "x".repeat(500) }).description?.length,
    ).toBeLessThanOrEqual(200);
    expect(songMetadata({ ...base, style: "" }).description).toBe(
      "Lunedì - MellodifAI",
    );
  });
});

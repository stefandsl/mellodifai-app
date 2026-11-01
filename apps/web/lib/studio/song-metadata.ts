import type { Metadata } from "next";

// The title, description and link preview (Open Graph song, Twitter card) of a song's page.
export function songMetadata(song: {
  title: string;
  style: string;
  cover: string | null;
  audio: string | null;
  path: string;
  siteName: string;
}): Metadata {
  const description =
    song.style.trim().slice(0, 200) || `${song.title} - ${song.siteName}`;
  return {
    title: song.title,
    description,
    openGraph: {
      type: "music.song",
      title: song.title,
      description,
      siteName: song.siteName,
      url: song.path,
      ...(song.cover ? { images: [{ url: song.cover, alt: song.title }] } : {}),
      ...(song.audio
        ? { audio: [{ url: song.audio, type: "audio/mpeg" }] }
        : {}),
    },
    twitter: {
      card: song.cover ? "summary_large_image" : "summary",
      title: song.title,
      description,
      ...(song.cover ? { images: [song.cover] } : {}),
    },
  };
}

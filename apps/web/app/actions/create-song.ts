"use server";
import { runAction } from "@/lib/run-action";
import { CreateSongInput } from "./schemas";

// First non-tag lyric line, used as the topic when the form has no prompt or title.
function firstLyricLine(lyrics: string): string {
  return (
    lyrics
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !/^\[.*\]$/u.test(line)) ?? ""
  );
}

export async function createSong(input: unknown) {
  return runAction(async (db) => {
    const v = CreateSongInput.parse(input);
    const simple = v.mode === "simple";
    const prompt = simple
      ? v.prompt
      : v.prompt ||
        v.settings.title ||
        firstLyricLine(v.lyrics) ||
        v.styles.slice(0, 250);
    const { data, error } = await db.rpc("create_song", {
      p_prompt: prompt,
      p_lyrics: simple ? "" : v.lyrics,
      p_languages: [...new Set(v.languages)],
      p_style: simple ? "" : v.styles,
      p_vocal_gender: v.vocalGender,
      p_settings: v.settings,
    });
    if (error) throw error;
    return { projectId: data as string };
  });
}

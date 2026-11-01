"use server";
import { SEED_LIMIT } from "@mellodifai/shared";
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
    const ids: string[] = [];
    for (let i = 0; i < v.count; i += 1) {
      // A fixed seed gives take 1 the seed and take 2 the next one, so each further song of the
      // same click starts two higher and no two songs share a seed.
      const settings =
        v.settings.seed === undefined
          ? v.settings
          : {
              ...v.settings,
              seed: Math.min(SEED_LIMIT, v.settings.seed + 2 * i),
            };
      const { data, error } = await db.rpc("create_song", {
        p_prompt: prompt,
        p_lyrics: simple ? "" : v.lyrics,
        p_languages: [...new Set(v.languages)],
        p_style: simple ? "" : v.styles,
        p_vocal_gender: v.vocalGender,
        p_settings: settings,
      });
      if (error) {
        // Songs already made stay: say how many, so the panel can tell the person.
        if (ids.length === 0) throw error;
        console.error("create_song failed after", ids.length, "songs");
        break;
      }
      ids.push(data as string);
    }
    return { projectId: ids[0], count: ids.length };
  });
}

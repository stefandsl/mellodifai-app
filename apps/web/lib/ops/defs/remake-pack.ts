import {
  type LyricPack,
  LyricPackSchema,
  type SongSettings,
} from "@mellodifai/shared";

// What accepting a remake hands to the database: the lyric pack of the reviewed text and the
// project's song settings. The cookie action and the token operation both compose it here, so
// an agent's accept makes the same song the create panel would.
export function remakeLyricPack(input: {
  title: string;
  style: string;
  lyricsText: string;
  settings: SongSettings;
  vocalGender: "m" | "f" | null;
}): { pack: LyricPack; settings: SongSettings; vocalGender: "m" | "f" | null } {
  const settings: SongSettings = { ...input.settings, title: input.title };
  // A remake never starts from audio: the reference is the YouTube source, analysed only.
  delete settings.source;
  const pack = LyricPackSchema.parse({
    title: input.title,
    lyrics: input.lyricsText,
    style: input.style,
    exclude: input.settings.exclude ?? "",
    settings: {
      model: input.settings.model,
      ...(input.vocalGender ? { vocalGender: input.vocalGender } : {}),
      styleWeight: input.settings.styleWeight ?? 0.7,
      weirdness: input.settings.weirdness ?? 0.35,
      variety: input.settings.variety ?? 1,
      duration: input.settings.duration ?? null,
    },
    displayMap: {},
    l10n: {},
  });
  return { pack, settings, vocalGender: input.vocalGender };
}

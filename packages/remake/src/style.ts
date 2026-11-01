// Style tags for the music generator, derived from the analysis. They describe sound,
// never who made it: artist, uploader and title words are filtered out, and so is any
// comparison ("like X", "in the style of X").
import type { Analysis, MusicAnalysis } from "./schemas.js";

const COMPARISON =
  /\b(?:like|style of|inspired by|sounds? like|in the vein of|a la|à la|vibes? of)\b/iu;

export function sanitizeTags(
  tags: string[],
  protectedNames: string[],
): string[] {
  const banned = protectedNames
    .flatMap((name) => [name, ...name.split(/[\s,&/()-]+/u)])
    .map((n) => n.toLowerCase().trim())
    .filter(
      (n) =>
        n.length >= 3 &&
        !/^(?:the|and|feat|official|music|video|lyric|lyrics)$/u.test(n),
    );
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.toLowerCase().replace(/\s+/gu, " ").trim();
    if (!tag || tag.length > 40 || COMPARISON.test(tag)) continue;
    const words = tag.split(" ");
    if (
      banned.some((b) =>
        b.includes(" ") ? tag.includes(b) : words.includes(b),
      )
    )
      continue;
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

const VOCAL_TAGS: Record<MusicAnalysis["vocal"]["type"], string | null> = {
  male: "male vocals",
  female: "female vocals",
  mixed: "male and female vocals",
  rap: "rap vocals",
  none: "instrumental",
  unknown: null,
};

export function deriveStyleTags(
  music: MusicAnalysis,
  overall: Analysis["overall"],
  protectedNames: string[],
): string[] {
  const choruses = music.sections.filter((s) => s.kind === "chorus");
  const verses = music.sections.filter((s) => s.kind === "verse");
  const mean = (xs: { energy: number }[]) =>
    xs.length ? xs.reduce((sum, x) => sum + x.energy, 0) / xs.length : 0;
  const lift =
    choruses.length > 0 &&
    verses.length > 0 &&
    mean(choruses) - mean(verses) >= 0.2;
  const tags = [
    ...overall.genre.slice(0, 2),
    ...overall.mood.slice(0, 2),
    `${Math.round(music.bpm)} bpm`,
    `${music.key.tonic} ${music.key.mode}`,
    music.timeSignature.beatsPerBar === 4
      ? null
      : `${music.timeSignature.beatsPerBar}/4 time`,
    VOCAL_TAGS[music.vocal.type],
    ...music.instrumentation.inferred.slice(0, 3),
    lift ? "big chorus lift" : null,
  ].filter((t): t is string => Boolean(t));
  return sanitizeTags(tags, protectedNames).slice(0, 12);
}

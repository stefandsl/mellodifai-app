import { type LyricTiming, timedLyrics, words } from "@mellodifai/shared";

export function sectionLabel(text: string, lang: "it" | "en"): string {
  const label = text.trim().replace(/^\[|\]$/gu, "");
  if (lang === "en") return label;
  return label.replace(
    /^(Pre-Chorus|Chorus|Verse|Bridge|Outro)(?=\s|$)/iu,
    (kind) =>
      ({
        "pre-chorus": "Pre-ritornello",
        chorus: "Ritornello",
        verse: "Strofa",
        bridge: "Ponte",
        outro: "Finale",
      })[kind.toLowerCase()] ?? kind,
  );
}

export function karaokeLines(lyrics: string, timing: LyricTiming | null) {
  const lines = timedLyrics(lyrics, timing);
  return lines.map((line) => ({
    ...line,
    words:
      line.sung &&
      line.words &&
      line.words.length === (line.text.match(/\S+/gu)?.length ?? 0) &&
      line.words.every(
        (word, index) =>
          words(word.word).join(" ") ===
          words(line.text.match(/\S+/gu)?.[index] ?? "").join(" "),
      )
        ? line.words
        : null,
  }));
}

export function activeLine(
  lines: ReturnType<typeof karaokeLines>,
  time: number,
): number {
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      line?.start !== null &&
      line?.start !== undefined &&
      line.end !== null &&
      line.end !== undefined &&
      time >= line.start &&
      time < line.end &&
      (active < 0 || line.start >= (lines[active]?.start ?? 0))
    )
      active = i;
  }
  return active;
}

export function activeWord(
  words: { start: number; end: number }[],
  time: number,
): number {
  let active = -1;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (
      word &&
      time >= word.start &&
      time < word.end &&
      (active < 0 || word.start >= (words[active]?.start ?? 0))
    )
      active = i;
  }
  return active;
}

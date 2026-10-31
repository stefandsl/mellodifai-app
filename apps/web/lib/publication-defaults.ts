import { t } from "@mellodifai/shared";

function defaultTags(title: string, language: string, lyricTag: string) {
  const unique = (words: string[]) => [
    ...new Map(words.map((word) => [word.toLocaleLowerCase(), word])).values(),
  ];
  const acronyms = [...title.matchAll(/[([]([^\])]+)[)\]]/gu)]
    .flatMap((match) => match[1].match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => word === word.toLocaleUpperCase());
  const words =
    title.replace(/[([][^\])]*[)\]]/gu, " ").match(/[\p{L}\p{N}]+/gu) ?? [];
  // Keep the recognizable full title phrase (including short connecting words),
  // but never emit a standalone one/two-letter word unless it is an acronym.
  const seen = new Set<string>();
  const phrase = words
    .filter((word) => {
      const key = word.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" ");
  const suffix = unique([lyricTag, language]);
  const candidates = unique([
    ...(phrase.length > 2 ? [phrase] : []),
    ...acronyms,
  ]);
  const selected: string[] = [];
  for (const candidate of candidates) {
    if (
      suffix.some(
        (tag) => tag.toLocaleLowerCase() === candidate.toLocaleLowerCase(),
      )
    )
      continue;
    const value = [...selected, candidate, ...suffix].join(", ");
    // Reserve separators and YouTube's extra quotation characters for spaced tags.
    if (
      value.length +
        [...selected, candidate, ...suffix].filter((tag) => tag.includes(" "))
          .length *
          2 <=
      500
    )
      selected.push(candidate);
  }
  return [...selected, ...suffix].join(", ");
}
export function publicationDefaults(
  title: string,
  brief: string,
  language: string,
  sections: unknown,
  locale: "it" | "en",
) {
  const starts: { title: string; start: number }[] = Array.isArray(sections)
    ? sections
        .filter(
          (s): s is { title: string; start: number } =>
            s &&
            typeof s.title === "string" &&
            typeof s.start === "number" &&
            Number.isFinite(s.start) &&
            s.start >= 0,
        )
        .sort((a, b) => a.start - b.start)
    : [];
  const chapters: string[] = [];
  let last = -10;
  for (const [index, section] of starts.entries()) {
    const start = index === 0 ? 0 : Math.floor(section.start);
    if (start - last < 10) continue;
    chapters.push(
      `${Math.floor(start / 60)}:${String(start % 60).padStart(2, "0")} ${section.title}`,
    );
    last = start;
  }
  return {
    title: `${title} | ${t(locale, "publish.suffix")}`,
    description: [brief, t(locale, "publish.credits")]
      .filter(Boolean)
      .join("\n\n"),
    tags: defaultTags(title, language, t(locale, "publish.tag")),
    chapters: chapters.join("\n"),
  };
}

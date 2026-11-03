import { publicationCopy } from "./i18n.js";

export function songMood(
  projectMood?: string | null,
  settingsMood?: string | null,
  style?: string | null,
) {
  return (
    [projectMood, settingsMood, style].find((value) => value?.trim())?.trim() ??
    ""
  );
}

function localizedMood(mood: string, language: string) {
  const input = mood.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const kinds = [
    /luminos|bright|upbeat|uplift|solare/u,
    /calm|quiet|tranquill|seren|soft/u,
    /urgent|intens|tense|energ|rabb/u,
    /wistful|nostalg|malincon|melanchol/u,
    /hopeful|speranz|optimis/u,
    /dark|scur|sombr|trist|sad/u,
  ];
  const words: Record<string, string[]> = {
    it: ["luminoso", "calmo", "energico", "malinconico", "speranzoso", "cupo"],
    en: ["bright", "calm", "urgent", "wistful", "hopeful", "dark"],
    fr: [
      "lumineux",
      "calme",
      "énergique",
      "mélancolique",
      "plein d’espoir",
      "sombre",
    ],
    de: [
      "hell",
      "ruhig",
      "energiegeladen",
      "melancholisch",
      "hoffnungsvoll",
      "düster",
    ],
    es: [
      "luminoso",
      "sereno",
      "enérgico",
      "melancólico",
      "esperanzador",
      "oscuro",
    ],
    pt: [
      "luminoso",
      "calmo",
      "enérgico",
      "melancólico",
      "esperançoso",
      "sombrio",
    ],
    ro: [
      "luminos",
      "calm",
      "energic",
      "melancolic",
      "plin de speranță",
      "sumbru",
    ],
    ru: [
      "светлый",
      "спокойный",
      "энергичный",
      "меланхоличный",
      "полный надежды",
      "мрачный",
    ],
    ja: [
      "明るい",
      "穏やか",
      "エネルギッシュ",
      "物悲しい",
      "希望に満ちた",
      "暗い",
    ],
    zh: ["明亮", "平静", "充满活力", "忧郁", "充满希望", "深沉"],
    ko: ["밝은", "차분한", "활기찬", "애잔한", "희망찬", "어두운"],
  };
  const index = kinds.findIndex((pattern) => pattern.test(input));
  // shortcut: unfamiliar free-form moods stay out of public copy until translated.
  return index < 0 ? "" : ((words[language] ?? words.en ?? [])[index] ?? "");
}

function defaultTags(
  title: string,
  language: string,
  lyricTag: string,
  mood: string,
) {
  const unique = (words: string[]) => [
    ...new Map(words.map((word) => [word.toLocaleLowerCase(), word])).values(),
  ];
  const acronyms = [...title.matchAll(/[([]([^\])]+)[)\]]/gu)]
    .flatMap((match) => (match[1] ?? "").match(/[\p{L}\p{N}]+/gu) ?? [])
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
  const suffix = unique([
    ...(mood.trim() ? [mood.trim()] : []),
    lyricTag,
    language,
  ]);
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
  lyrics: string,
  language: string,
  sections: unknown,
  mood = "",
) {
  const copy = publicationCopy(language);
  const moodText = localizedMood(mood, language);
  const titled = `${title} | ${copy.suffix}`;
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
    // Keep the complete song title when the optional suffix cannot fit.
    title: titled.length <= 100 ? titled : title,
    description: [
      title,
      lyrics
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line && !/^\[.*\]$/u.test(line))
        .slice(0, 4)
        .join("\n")
        .slice(0, 4500),
      moodText,
      copy.credits,
    ]
      .filter(Boolean)
      .join("\n\n"),
    tags: defaultTags(title, language, copy.tag, moodText),
    chapters: chapters.join("\n"),
  };
}

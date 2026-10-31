import { t } from "@mellodifai/shared";
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
    tags: [
      ...new Set([...title.split(/\s+/u), language, t(locale, "publish.tag")]),
    ].join(", "),
    chapters: chapters.join("\n"),
  };
}

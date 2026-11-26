// Shared types and helpers for the prerendered /changelog page (C09).

export type MarkdownInline =
  | { type: "text"; text: string }
  | { type: "strong"; children: MarkdownInline[] }
  | { type: "em"; children: MarkdownInline[] }
  | { type: "code"; text: string }
  | { type: "link"; label: string; href: string };

export type MarkdownBlock =
  | { type: "heading"; level: 2 | 3; inlines: MarkdownInline[] }
  | { type: "paragraph"; inlines: MarkdownInline[] }
  | { type: "list"; ordered: boolean; items: MarkdownInline[][] }
  | { type: "code"; text: string; lang?: string };

export type ChangelogEntry = {
  tag: string;
  id: string;
  date: string;
  isoDate: string;
  title: string | null;
  summary: string | null;
  blocks: MarkdownBlock[];
  hasNotes: boolean;
};

/**
 * Format an ISO date string (YYYY-MM-DD or full ISO timestamp) for display in EN or IT.
 * Uses UTC so server prerendering produces identical dates regardless of build host timezone.
 */
export function formatChangelogDate(
  isoDate: string,
  lang: "en" | "it",
  style: "long" | "short" = "long",
): string {
  const datePart = isoDate.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(datePart);
  if (!match) return datePart;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month, day));
  if (Number.isNaN(utc.getTime())) return datePart;
  return new Intl.DateTimeFormat(lang === "it" ? "it-IT" : "en-US", {
    timeZone: "UTC",
    year: style === "long" ? "numeric" : undefined,
    month: "short",
    day: "numeric",
  }).format(utc);
}

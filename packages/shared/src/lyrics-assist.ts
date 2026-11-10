// The AI buttons of the create panel's lyrics editor (task 27): "Scrivi con AI" writes lyrics
// from the title, a brief and the styles; "Rigenera" writes the whole text or one section again;
// "Migliora" keeps the meaning and improves singability and rhyme. Each request is a
// lyrics_assist job run by the worker's lyric pipeline and jury (migration 20261102000026).
import { z } from "zod";
import { LANGS } from "./stages.js";

export const LYRICS_ASSIST_MODES = ["write", "regenerate", "improve"] as const;
export type LyricsAssistMode = (typeof LYRICS_ASSIST_MODES)[number];

export const LYRICS_ASSIST_LIMITS = {
  title: 100,
  brief: 500,
  style: 1000,
  lyrics: 5000,
} as const;

// A section of the lyrics as character offsets: from its [Tag] line to the next tag or the end.
export const LyricsRangeSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .refine((r) => r.end > r.start, "empty range");
export type LyricsRange = z.infer<typeof LyricsRangeSchema>;

export const LyricsAssistInputSchema = z
  .object({
    mode: z.enum(LYRICS_ASSIST_MODES),
    lang: z.enum(LANGS),
    title: z.string().max(LYRICS_ASSIST_LIMITS.title).default(""),
    brief: z.string().max(LYRICS_ASSIST_LIMITS.brief).default(""),
    style: z.string().max(LYRICS_ASSIST_LIMITS.style).default(""),
    lyrics: z.string().max(LYRICS_ASSIST_LIMITS.lyrics).default(""),
    // Regenerate only: the section to write again; null means the whole text.
    section: LyricsRangeSchema.nullable().default(null),
    vocalGender: z.enum(["m", "f"]).nullable().default(null),
  })
  .superRefine((input, ctx) => {
    if (
      input.mode === "write" &&
      !(input.title.trim() || input.brief.trim() || input.style.trim())
    )
      ctx.addIssue({
        code: "custom",
        path: ["brief"],
        message: "a title, a brief or a style is needed",
      });
    if (input.mode !== "write" && !input.lyrics.trim())
      ctx.addIssue({
        code: "custom",
        path: ["lyrics"],
        message: "lyrics are needed",
      });
    if (input.section && input.section.end > input.lyrics.length)
      ctx.addIssue({
        code: "custom",
        path: ["section"],
        message: "section outside the lyrics",
      });
  });
export type LyricsAssistInput = z.infer<typeof LyricsAssistInputSchema>;

export const LyricsAssistResultSchema = z.object({
  // The whole lyrics after the change (for a section, the other sections are kept verbatim).
  lyrics: z.string().min(1),
  title: z.string().nullable(),
  jury: z.object({
    available: z.boolean(),
    passed: z.boolean(),
    scores: z.record(z.string(), z.number()),
    issues: z.array(z.string()),
    // OpenRouter's privacy filter altered what a judge read (see lyric-jury.ts).
    redacted: z.boolean(),
  }),
  writer: z.string(),
  ms: z.number().nonnegative(),
});
export type LyricsAssistResult = z.infer<typeof LyricsAssistResultSchema>;

const TAG_LINE = /^\s*\[[^\]\n]+\]\s*$/u;

type Block = LyricsRange & { label: string };

// The [Tag] blocks of a text, in order; text before the first tag is not a section.
export function lyricSectionsOf(lyrics: string): Block[] {
  const blocks: Block[] = [];
  let offset = 0;
  for (const line of lyrics.split("\n")) {
    if (TAG_LINE.test(line)) {
      const last = blocks.at(-1);
      if (last) last.end = offset;
      blocks.push({
        start: offset,
        end: lyrics.length,
        label: line.trim().slice(1, -1).trim(),
      });
    }
    offset += line.length + 1;
  }
  return blocks.filter((b) => b.end > b.start);
}

// The section the caret (or the start of a selection) is in, or null outside any section.
export function sectionAt(lyrics: string, caret: number): Block | null {
  return (
    lyricSectionsOf(lyrics).find((b) => caret >= b.start && caret <= b.end) ??
    null
  );
}

// Puts new text in place of one section and keeps the line breaks around it.
export function spliceSection(
  lyrics: string,
  range: LyricsRange,
  replacement: string,
): string {
  const tail = lyrics.slice(range.end);
  const body = replacement.replace(/\s+$/u, "");
  return `${lyrics.slice(0, range.start)}${body}${tail ? (tail.startsWith("\n") ? "" : "\n\n") : ""}${tail}`;
}

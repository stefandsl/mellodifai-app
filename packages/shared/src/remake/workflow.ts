// "Rifai da YouTube" as the studio runs it (task 27): the remake row's stages, the error codes a
// person can act on, the analysis summary the create panel shows and the rules for accepting
// the rewritten lyrics. The SQL functions of migration 20261102000026 hold the same rules.
import { z } from "zod";
import type { RemakeAnalysis, RemakeLyrics } from "./analysis.js";

// kie takes source audio up to 8 minutes; a remake keeps the same limit.
export const REMAKE_MAX_SECONDS = 480;

export const REMAKE_STAGES = [
  "ingest",
  "analyse",
  "rewrite",
  "review",
  "accepted",
  "failed",
  "cancelled",
] as const;
export type RemakeStage = (typeof REMAKE_STAGES)[number];
// Stages in which a worker job of the remake is (or should be) running.
export const REMAKE_BUSY_STAGES: readonly RemakeStage[] = [
  "ingest",
  "analyse",
  "rewrite",
];

export const REMAKE_ERROR_CODES = [
  "invalid_url",
  "private",
  "age_restricted",
  "too_long",
  "unavailable",
  "no_lyrics",
  "privacy_filter",
  "cost_cap",
  "failed",
] as const;
export type RemakeErrorCode = (typeof REMAKE_ERROR_CODES)[number];

// The YouTube video id of a link (watch, youtu.be, shorts, embed, live) or of a bare id.
export function youtubeVideoId(input: string): string | null {
  const text = input.trim();
  if (/^[\w-]{11}$/u.test(text)) return text;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//iu.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname
    .toLowerCase()
    .replace(/^(?:www\.|m\.|music\.)/u, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id =
      url.searchParams.get("v") ??
      /^\/(?:shorts|embed|live|v)\/([^/?#]+)/u.exec(url.pathname)?.[1] ??
      null;
  }
  return id && /^[\w-]{11}$/u.test(id) ? id : null;
}

export const REMAKE_COUNTRIES = [
  "IT",
  "CH",
  "US",
  "GB",
  "IE",
  "CA",
  "AU",
  "ES",
  "MX",
  "AR",
  "CO",
  "FR",
  "BE",
  "DE",
  "AT",
  "PT",
  "BR",
  "RO",
  "MD",
  "RU",
  "JP",
  "CN",
  "TW",
  "KR",
] as const;

const seconds = z.number().nonnegative();

// What the create panel shows of an analysis (remakes.analysis): no lyrics, no media paths.
export const RemakeSummarySchema = z.object({
  title: z.string(),
  durationS: seconds,
  bpm: z.number().positive(),
  key: z.object({ tonic: z.string(), mode: z.string() }),
  beatsPerBar: z.number().int().positive(),
  sourceLanguage: z.string(),
  vocal: z.object({ type: z.string(), delivery: z.string() }),
  genre: z.array(z.string()),
  mood: z.array(z.string()),
  summary: z.string(),
  styleTags: z.array(z.string()),
  sections: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      kind: z.string(),
      start: seconds,
      end: seconds,
      lines: z.number().int().nonnegative(),
    }),
  ),
  costUsd: z.number().nonnegative(),
});
export type RemakeSummary = z.infer<typeof RemakeSummarySchema>;

export function summarizeAnalysis(analysis: RemakeAnalysis): RemakeSummary {
  const m = analysis.music;
  return {
    title: analysis.title,
    durationS: Math.round(m.durationS * 10) / 10,
    bpm: Math.round(m.bpm * 10) / 10,
    key: { tonic: m.key.tonic, mode: m.key.mode },
    beatsPerBar: m.timeSignature.beatsPerBar,
    sourceLanguage: analysis.sourceLanguage,
    vocal: { type: m.vocal.type, delivery: m.vocal.delivery },
    genre: analysis.overall.genre,
    mood: analysis.overall.mood,
    summary: analysis.overall.summary,
    styleTags: analysis.styleTags,
    sections: m.sections.map((s) => ({
      id: s.id,
      label: s.label,
      kind: s.kind,
      start: Math.round(s.start * 10) / 10,
      end: Math.round(s.end * 10) / 10,
      lines: analysis.lines.filter((l) => l.sectionId === s.id).length,
    })),
    costUsd: analysis.cost.usd,
  };
}

// The lyrics text the song is generated from: one [Label] line per section, then its lines.
// migration 20261102000026 (remake_lyrics_text) composes the same text in SQL.
export function remakeLyricsText(lyrics: Pick<RemakeLyrics, "sections">) {
  return lyrics.sections
    .map((s) =>
      [`[${s.label}]`, ...s.lines.map((l) => l.text.trim())].join("\n"),
    )
    .join("\n\n");
}

export type AcceptBlocker =
  | { kind: "line"; index: number }
  | { kind: "phrase"; detail: string }
  | { kind: "empty"; index: number };

// The originality gate (design 10.3) is the copyright line: it can never be skipped, also not
// for a line the person edited. The jury and the syllable fit are advice the person may overrule.
export function acceptBlockers(lyrics: RemakeLyrics): AcceptBlocker[] {
  const blockers: AcceptBlocker[] = [];
  for (const section of lyrics.sections)
    for (const line of section.lines) {
      if (!line.text.trim())
        blockers.push({ kind: "empty", index: line.index });
      else if (line.originality.flagged)
        blockers.push({ kind: "line", index: line.index });
    }
  if (!lyrics.originality.phrase.ok)
    blockers.push({ kind: "phrase", detail: lyrics.originality.phrase.detail });
  return blockers;
}

// The last jury round's scores, for the review (the lyrics may have been edited since).
export function latestJury(lyrics: RemakeLyrics) {
  const round = lyrics.jury.rounds.at(-1);
  return round
    ? {
        round: round.round,
        available: round.available,
        passed: round.passed,
        scores: round.scores,
        issues: round.issues,
        objections: round.devil.objections,
        redacted: round.issues.some((i) => /privacy filter/iu.test(i.problem)),
      }
    : null;
}

export const RemakeCostSplitSchema = z.object({
  analysisUsd: z.number().nonnegative().default(0),
  rewriteUsd: z.number().nonnegative().default(0),
  sectionsUsd: z.number().nonnegative().default(0),
  // Runs that failed after paying for some calls (the privacy filter, a cap).
  failedUsd: z.number().nonnegative().default(0),
});
export type RemakeCostSplit = z.infer<typeof RemakeCostSplitSchema>;

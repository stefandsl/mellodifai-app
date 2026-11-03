import { z } from "zod";

// "Riscrivi una parte" (T12): Suno's Replace Section. The owner selects a range of a take, the
// lyric lines sung in it light up, he rewrites them and an engine makes alternatives of that
// range; the one he keeps becomes a new take of the same song.

// Suno's limits: the legacy editor and its guides ask for a 10 to 30 second part, and kie's
// replace-section refuses less than 10 s or more than half of the track
// (docs.kie.ai/suno-api/replace-section, checked 2026-11-01). ACE-Step uses the same limits.
export const SECTION_LIMITS = {
  minSeconds: 10,
  maxSeconds: 30,
  maxShare: 0.5,
} as const;

// Context the alternatives are heard in: from 4 s before the part to 3 s after it.
export const AUDITION = { pre: 4, post: 3 } as const;

// ACE-Step rewrites a window with this much of the song around the part, so the new singing
// starts and ends in the original's groove; only the part itself goes into the song.
export const REWRITE_CONTEXT = 5;
// The two seams are crossfaded over this many seconds.
export const REWRITE_CROSSFADE = 0.3;
// How much ACE-Step may change the window (KSampler denoise): 0.5 sang new lyrics on the
// original melody and timing in the T12 feasibility run (E:/mellodifai/research/t12/ace).
export const ACE_REWRITE_DENOISE = 0.5;

export const REWRITE_ENGINES = ["kie", "ace-step"] as const;
export type RewriteEngine = (typeof REWRITE_ENGINES)[number];

// kie prices (kie.ai/suno-api, checked 2026-11-01).
export const KIE_CREDITS = {
  generate: 12,
  replace: 5,
  cover: 12,
  extend: 12,
} as const;

export type SectionProblem = "short" | "long" | "half" | "outside";

const round2 = (value: number) => Math.round(value * 100) / 100;

// Why a range cannot be rewritten, or null when it can.
export function sectionProblem(
  start: number,
  end: number,
  duration: number,
): SectionProblem | null {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end > duration + 0.01 ||
    end <= start
  )
    return "outside";
  const length = round2(end - start);
  if (length < SECTION_LIMITS.minSeconds) return "short";
  if (length > SECTION_LIMITS.maxSeconds) return "long";
  if (length > round2(duration * SECTION_LIMITS.maxShare)) return "half";
  return null;
}

// The longest part a take of this length allows.
export function maxSection(duration: number): number {
  return Math.min(
    SECTION_LIMITS.maxSeconds,
    Math.floor(duration * SECTION_LIMITS.maxShare * 100) / 100,
  );
}

// The window ACE-Step regenerates around a part.
export function rewriteWindow(
  start: number,
  end: number,
  duration: number,
  context: number = REWRITE_CONTEXT,
): { from: number; to: number } {
  return {
    from: round2(Math.max(0, start - context)),
    to: round2(Math.min(duration, end + context)),
  };
}

// Timed lyric lines of one take (takes.lyric_timing): the sung lines in order, each with the
// time it is sung. `source` says where the times came from.
export const LyricTimingSchema = z.object({
  source: z.enum(["timing", "whisper", "kie", "copied"]),
  lines: z.array(
    z.object({
      text: z.string(),
      start: z.number().nonnegative(),
      end: z.number().nonnegative(),
      words: z
        .array(
          z.object({
            word: z.string(),
            start: z.number().nonnegative(),
            end: z.number().nonnegative(),
          }),
        )
        .optional(),
    }),
  ),
});
export type LyricTiming = z.infer<typeof LyricTimingSchema>;

export function parseLyricTiming(raw: unknown): LyricTiming | null {
  const parsed = LyricTimingSchema.safeParse(raw);
  return parsed.success && parsed.data.lines.length > 0 ? parsed.data : null;
}

export type LyricLine = {
  // Index in the lyrics split on newlines.
  index: number;
  text: string;
  // A section tag such as [Chorus], or an empty line: shown, never sung.
  sung: boolean;
};

const TAG = /^\s*\[[^\]]*\]\s*$/u;
const DIRECTION = /^\s*\(.*\)\s*$/u;

export function lyricLines(lyrics: string): LyricLine[] {
  return lyrics.split(/\r\n|\n|\r/u).map((text, index) => ({
    index,
    text,
    sung: text.trim().length > 0 && !TAG.test(text) && !DIRECTION.test(text),
  }));
}

// Lowercase words without accents or punctuation, for comparing what was sung with the text.
export function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/'/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j] ?? 0;
      row[j] = Math.min(
        above + 1,
        (row[j - 1] ?? 0) + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return row[b.length] ?? 0;
}

function similar(a: string, b: string): boolean {
  if (a === b) return true;
  const longest = Math.max(a.length, b.length);
  if (longest < 3) return false;
  return 1 - editDistance(a, b) / longest >= 0.7;
}

export type TimedWord = { word: string; start: number; end: number };

// Times each sung line from the words a transcription heard (Groq Whisper, kie's aligned words):
// a global alignment of the lyric words with the heard words, then a line runs from its first
// matched word to its last. Lines nothing matched get the gap between their neighbours.
export function alignWordsToLines(
  lines: string[],
  heard: TimedWord[],
): ({ start: number; end: number } | null)[] {
  const tokens: { line: number; word: string }[] = [];
  lines.forEach((line, i) => {
    for (const word of words(line)) tokens.push({ line: i, word });
  });
  const said = heard.flatMap((item) =>
    words(item.word).map((word) => ({ ...item, word })),
  );
  const n = tokens.length;
  const m = said.length;
  const result: ({ start: number; end: number } | null)[] = lines.map(
    () => null,
  );
  if (n === 0 || m === 0) return result;
  const MATCH = 2;
  const GAP = -1;
  const MISMATCH = -1;
  // Scores and back pointers: 0 diagonal, 1 skip a lyric word, 2 skip a heard word.
  const width = m + 1;
  const score = new Float64Array((n + 1) * width);
  const from = new Uint8Array((n + 1) * width);
  for (let i = 1; i <= n; i++) {
    score[i * width] = i * GAP;
    from[i * width] = 1;
  }
  for (let j = 1; j <= m; j++) {
    score[j] = j * GAP;
    from[j] = 2;
  }
  for (let i = 1; i <= n; i++) {
    const word = tokens[i - 1]?.word ?? "";
    for (let j = 1; j <= m; j++) {
      const diagonal =
        (score[(i - 1) * width + j - 1] ?? 0) +
        (similar(word, said[j - 1]?.word ?? "") ? MATCH : MISMATCH);
      const up = (score[(i - 1) * width + j] ?? 0) + GAP;
      const left = (score[i * width + j - 1] ?? 0) + GAP;
      const best = Math.max(diagonal, up, left);
      score[i * width + j] = best;
      from[i * width + j] = best === diagonal ? 0 : best === up ? 1 : 2;
    }
  }
  const times: { start: number; end: number }[][] = lines.map(() => []);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const step = from[i * width + j];
    if (step === 0) {
      const token = tokens[i - 1];
      const item = said[j - 1];
      if (token && item && similar(token.word, item.word))
        times[token.line]?.push({ start: item.start, end: item.end });
      i -= 1;
      j -= 1;
    } else if (step === 1) i -= 1;
    else j -= 1;
  }
  times.forEach((found, line) => {
    // One stray match is too weak to time a long line.
    const needed = Math.min(2, words(lines[line] ?? "").length);
    if (found.length >= needed && found.length > 0)
      result[line] = {
        start: Math.min(...found.map((t) => t.start)),
        end: Math.max(...found.map((t) => t.end)),
      };
  });
  // Lines left untimed between two timed ones share the gap between them.
  for (let line = 0; line < result.length; line++) {
    if (result[line]) continue;
    let before = line - 1;
    while (before >= 0 && !result[before]) before -= 1;
    let after = line + 1;
    while (after < result.length && !result[after]) after += 1;
    const prev = before >= 0 ? result[before] : null;
    const next = after < result.length ? result[after] : null;
    if (!prev || !next || next.start <= prev.end) continue;
    const share = (next.start - prev.end) / (after - before - 1);
    result[line] = {
      start: round2(prev.end + share * (line - before - 1)),
      end: round2(prev.end + share * (line - before)),
    };
  }
  return result;
}

// The timing of a take laid over the lyrics on screen: each sung line of `lyrics` gets the time
// of the timed line it corresponds to. Same number of sung lines: by order; otherwise by text.
export function timedLyrics(
  lyrics: string,
  timing: LyricTiming | null,
): (LyricLine & { start: number | null; end: number | null })[] {
  const lines = lyricLines(lyrics);
  const sung = lines.filter((line) => line.sung);
  const times = new Map<number, { start: number; end: number }>();
  if (timing) {
    if (timing.lines.length === sung.length)
      sung.forEach((line, i) => {
        const timed = timing.lines[i];
        if (timed) times.set(line.index, timed);
      });
    else {
      // Align by words: each timed line becomes words spread across its time.
      const heard: TimedWord[] = timing.lines.flatMap((line) => {
        const parts = words(line.text);
        const step = parts.length ? (line.end - line.start) / parts.length : 0;
        return parts.map((word, k) => ({
          word,
          start: line.start + step * k,
          end: line.start + step * (k + 1),
        }));
      });
      alignWordsToLines(
        sung.map((line) => line.text),
        heard,
      ).forEach((time, i) => {
        const line = sung[i];
        if (time && line) times.set(line.index, time);
      });
    }
  }
  return lines.map((line) => {
    const time = times.get(line.index);
    return { ...line, start: time?.start ?? null, end: time?.end ?? null };
  });
}

// The sung lines heard inside a range: at least half of the line, or its middle, falls in it.
export function linesInRange(
  lines: {
    index: number;
    sung: boolean;
    start: number | null;
    end: number | null;
  }[],
  start: number,
  end: number,
): number[] {
  return lines
    .filter((line) => {
      if (!line.sung || line.start === null || line.end === null) return false;
      const length = Math.max(0.01, line.end - line.start);
      const overlap = Math.min(end, line.end) - Math.max(start, line.start);
      const middle = (line.start + line.end) / 2;
      return overlap / length >= 0.5 || (middle >= start && middle <= end);
    })
    .map((line) => line.index);
}

// The lines from the first chosen line to the last, as one block of text (tags inside kept).
export function sectionText(lyrics: string, indices: number[]): string {
  if (indices.length === 0) return "";
  const lines = lyrics.split(/\r\n|\n|\r/u);
  const first = Math.min(...indices);
  const last = Math.max(...indices);
  return lines.slice(first, last + 1).join("\n");
}

// The whole lyrics with the block from the first chosen line to the last replaced by `text`.
// No chosen line (no timing, nothing marked) puts nothing in place: the lyrics stay as they are.
export function replaceSection(
  lyrics: string,
  indices: number[],
  text: string,
): string {
  if (indices.length === 0) return lyrics;
  const lines = lyrics.split(/\r\n|\n|\r/u);
  const first = Math.min(...indices);
  const last = Math.max(...indices);
  const replacement = text.replace(/\r\n|\r/gu, "\n").replace(/\n+$/u, "");
  return [
    ...lines.slice(0, first),
    ...(replacement ? replacement.split("\n") : []),
    ...lines.slice(last + 1),
  ].join("\n");
}

// The timing of a kept alternative: the source take's, with the rewritten lines carrying their
// new words over the time the old lines had (the part keeps its place in the song).
export function rewrittenTiming(
  timing: LyricTiming | null,
  oldLyrics: string,
  newLyrics: string,
): LyricTiming | null {
  if (!timing) return null;
  const before = timedLyrics(oldLyrics, timing).filter((line) => line.sung);
  const after = lyricLines(newLyrics).filter((line) => line.sung);
  if (before.length !== after.length) {
    // The part has more or fewer lines now: spread the changed block over the old block's time.
    let head = 0;
    while (
      head < before.length &&
      head < after.length &&
      before[head]?.text === after[head]?.text
    )
      head += 1;
    let tail = 0;
    while (
      tail < before.length - head &&
      tail < after.length - head &&
      before[before.length - 1 - tail]?.text ===
        after[after.length - 1 - tail]?.text
    )
      tail += 1;
    const oldBlock = before.slice(head, before.length - tail);
    const newBlock = after.slice(head, after.length - tail);
    const blockStart = oldBlock.find((l) => l.start !== null)?.start ?? null;
    const blockEnd =
      [...oldBlock].reverse().find((l) => l.end !== null)?.end ?? null;
    const lines: LyricTiming["lines"] = [];
    for (const line of before.slice(0, head))
      if (line.start !== null && line.end !== null)
        lines.push({ text: line.text, start: line.start, end: line.end });
    if (blockStart !== null && blockEnd !== null && newBlock.length > 0) {
      const step = (blockEnd - blockStart) / newBlock.length;
      for (const [k, line] of newBlock.entries())
        lines.push({
          text: line.text,
          start: round2(blockStart + step * k),
          end: round2(blockStart + step * (k + 1)),
        });
    }
    for (const line of before.slice(before.length - tail))
      if (line.start !== null && line.end !== null)
        lines.push({ text: line.text, start: line.start, end: line.end });
    return lines.length ? { source: "copied", lines } : null;
  }
  const lines: LyricTiming["lines"] = [];
  before.forEach((line, i) => {
    if (line.start === null || line.end === null) return;
    lines.push({
      text: after[i]?.text ?? line.text,
      start: line.start,
      end: line.end,
    });
  });
  return lines.length ? { source: "copied", lines } : null;
}

// The lyrics ACE-Step sings over a window: the lines timed inside it, with the new text in place
// of the rewritten block. Without timing, only the new text.
export function windowLyrics(
  timing: LyricTiming | null,
  oldLyrics: string,
  window: { from: number; to: number },
  sectionLines: number[],
  newText: string,
): string {
  if (!timing || sectionLines.length === 0) return newText.trim();
  const timed = timedLyrics(oldLyrics, timing);
  const first = Math.min(...sectionLines);
  const last = Math.max(...sectionLines);
  const before = timed.filter(
    (line) =>
      line.sung &&
      line.index < first &&
      line.end !== null &&
      line.end > window.from,
  );
  const after = timed.filter(
    (line) =>
      line.sung &&
      line.index > last &&
      line.start !== null &&
      line.start < window.to,
  );
  return [
    ...before.map((line) => line.text),
    ...newText.split(/\r\n|\n|\r/u).filter((line) => line.trim().length > 0),
    ...after.map((line) => line.text),
  ].join("\n");
}

// A take's stored timing from the words a transcription heard: each sung line of the lyrics with
// the time it is heard; lines nothing matched are left out.
export function timingFromWords(
  lyrics: string,
  heard: TimedWord[],
  source: LyricTiming["source"],
): LyricTiming | null {
  const sung = lyricLines(lyrics).filter((line) => line.sung);
  const times = alignWordsToLines(
    sung.map((line) => line.text),
    heard,
  );
  const lines: LyricTiming["lines"] = [];
  sung.forEach((line, i) => {
    const time = times[i];
    if (time)
      lines.push({
        text: line.text,
        start: round2(time.start),
        end: round2(time.end),
      });
  });
  // Too little of the song was matched to trust the times.
  return lines.length >= Math.max(1, Math.ceil(sung.length / 3))
    ? { source, lines }
    : null;
}
